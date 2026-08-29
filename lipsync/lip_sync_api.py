"""
Forced alignment as a Modal service, producing viseme marks for vocoTrial.

Audio plus the script that was read gives phone-level timings; those become Polly
viseme identifiers, which the client collapses onto the seven drawn poses through the
POLLY_VISEMES table it already has. See visemes.py for why the collapse deliberately
happens over there and not here.

Two ways in. `bake` is the one that matters -- a local entrypoint that walks a folder of
audio and scripts and writes marks JSON beside each, run once at build time so nothing
at run time waits on an aligner. `generate_visemes` is a web endpoint for one-offs,
behind a shared secret.

MFA is pinned to 2.0.6 on purpose. From 2.2 onward it migrates to PostgreSQL, and by 3.x
alignment needs a database server initialised at build and started per container, plus a
non-root user to run initdb as. That is a lot of moving parts to carry for a batch job,
and 2.0.6 predates all of it.
"""

import json
import os
import subprocess
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import fastapi
import modal

# The three models, all on MFA's own cross-linguistic phone set.
#
# Not english_us_arpa, and the reason is French and Spanish rather than anything wrong
# with ARPA. ARPAbet is an English alphabet -- there is no ARPA French model -- so an
# ARPA English model plus french_mfa would mean two unrelated mapping tables, and adding
# Spanish a third. On the MFA set one table covers all three, and the next language costs
# a handful of rows. polly.ts makes exactly this argument about Polly's per-language
# tables: map the union, not the subset in front of you.
MODELS = {
    "en": "english_mfa",
    "fr": "french_mfa",
    "es": "spanish_mfa",
}

MFA_ROOT = "/mfa"

# Models are fetched by URL at a pinned version rather than through
# `mfa model download`, and that is not fussiness -- it is the fix for a real failure.
#
# MFA 2.0.6's downloader is not version aware. It has no --version flag at all, and it
# resolves a model name to whatever the repository currently calls latest, which today
# is v3.1.0. A 3.1.0 acoustic model loads into a 2.0.6 runtime far enough to look like
# it is working: feature extraction succeeds, and gmm-align-compiled reports "Done 1,
# errors on 0" with a healthy log-likelihood. It then dies at the very last step,
# extracting phone times, with
#
#     ERROR (lattice-align-words) Empty word-boundary file
#
# because the 3.x model declares position_dependent_phones: False and 2.0.6 still asks
# Kaldi for word boundaries. The alignment was fine; only the part we actually wanted
# came back empty. Pinning to v2.0.0 -- the release contemporaneous with 2.0.x, which
# the model pages list as "Compatible MFA version: v2.0.0" -- makes it work.
MODEL_VERSION = "2.0.0"
MODELS_BASE = "https://github.com/MontrealCorpusTools/mfa-models/releases/download"


def download_models():
    """Fetch the pinned acoustic models and dictionaries into MFA_ROOT."""
    import urllib.request

    for kind, suffix in (("acoustic", "zip"), ("dictionary", "dict")):
        target = Path(MFA_ROOT) / "pretrained_models" / kind
        target.mkdir(parents=True, exist_ok=True)
        for name in MODELS.values():
            url = f"{MODELS_BASE}/{kind}-{name}-v{MODEL_VERSION}/{name}.{suffix}"
            dest = target / f"{name}.{suffix}"
            urllib.request.urlretrieve(url, dest)
            size = dest.stat().st_size
            if size < 1024:
                raise RuntimeError(f"{url} returned only {size} bytes")
            print(f"{kind:10} {name:14} {size / 1e6:7.1f} MB")


def assert_table_covers_dictionaries():
    """
    Fail the image build if any installed phone has no mapping.

    The MFA phone set documentation is openly incomplete -- it says so itself, "under
    heavy construction ... many languages are missing or have incomplete entries", and
    it has no French section at all. So the inventory is not transcribed from the docs
    and then hoped over. It is read out of the dictionaries that actually shipped, and
    a phone with nowhere to go stops the build.

    This is the Python answer to the guarantee polly.ts gets for free from
    `Record<PollyViseme, Viseme>`: adding a phone somewhere must not silently become a
    closed mouth somewhere else. It is also precisely the check the original version of
    this service would have failed -- its map was missing six English phonemes, so every
    "L", "W" and "Y" would have snapped the mouth shut mid-word.
    """
    import visemes

    missing = {}
    fallbacks = {}
    seen = 0

    root = Path(MFA_ROOT) / "pretrained_models" / "dictionary"
    dicts = sorted(root.glob("*.dict")) + sorted(root.glob("*.txt"))
    if not dicts:
        raise RuntimeError(f"no dictionaries found under {root}")

    for path in dicts:
        phones = set()
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                parts = line.split()
                if len(parts) < 2:
                    continue
                # Word first, then in probabilistic dictionaries some float columns,
                # then the phones. Dropping anything that parses as a number is a
                # cheaper test than knowing which dictionaries have which columns.
                for token in parts[1:]:
                    try:
                        float(token)
                    except ValueError:
                        phones.add(token)
        seen += len(phones)
        unmapped = sorted(p for p in phones if not visemes.is_mapped(p))
        if unmapped:
            missing[path.name] = unmapped
        guessed = sorted(p for p in phones if visemes.resolves_by_fallback(p))
        if guessed:
            fallbacks[path.name] = guessed

    if missing:
        lines = [f"  {name}: {' '.join(phones)}" for name, phones in missing.items()]
        raise RuntimeError(
            "PHONE_TO_POLLY does not cover every installed phone.\n"
            + "\n".join(lines)
            + "\n\nAdd them to visemes.py. Do not let them fall through to `sil` -- an "
            "unmapped phone is a mouth that closes in the middle of a word."
        )

    if fallbacks:
        # Not fatal -- the fallback is a real rule and often the right answer. But it is
        # a guess, and a guess nobody has looked at is how `əw` came to draw as schwa.
        print("phones resolving only by the first-character fallback, for review:")
        for name, phones in fallbacks.items():
            print(f"  {name}: {' '.join(phones)}")

    print(f"phone table covers {seen} phones across {len(dicts)} dictionaries")


mfa_image = (
    modal.Image.micromamba(python_version="3.10")
    .micromamba_install(
        "montreal-forced-aligner=2.0.6",
        "ffmpeg",
        channels=["conda-forge"],
    )
    # Before the downloads, not after. MFA 2.x otherwise puts pretrained models under
    # ~/Documents/MFA, which is not where the runtime container will look for them, and
    # the failure surfaces as a baffling "model not found" on the first alignment
    # rather than as anything wrong at build time.
    .env({"MFA_ROOT_DIR": MFA_ROOT})
    .run_function(download_models)
    .pip_install("tgt", "fastapi[standard]")
    # copy=True because a build step runs after this. Modal's default is to mount local
    # sources at container start, which keeps edits from invalidating the image -- but
    # the assertion below has to import visemes at build time, so the file has to be
    # genuinely in the image by then. The cost is that editing visemes.py rebuilds from
    # this layer; the models are cached below it, so that is seconds rather than minutes.
    .add_local_python_source("visemes", copy=True)
    # Build steps belong on the image. The @app.build() decorator this started out
    # using is deprecated in Modal 1.x.
    .run_function(assert_table_covers_dictionaries)
)

app = modal.App(name="mfa-lipsync-api", image=mfa_image)

with mfa_image.imports():
    import tgt

    import visemes


class AlignmentError(Exception):
    """Alignment failed in a way worth showing whoever asked for it."""


def _tier_named(textgrid, suffix):
    """
    A tier by the end of its name, whatever MFA prefixed it with.

    Single-speaker corpora get tiers plainly named "words" and "phones"; multi-speaker
    ones get "<speaker> - words". Matching on the suffix covers both without caring
    which we were handed.
    """
    for tier in textgrid.tiers:
        if tier.name.strip().lower().endswith(suffix):
            return tier
    return None


def _phone_tier(textgrid):
    """
    The phones tier, whatever MFA decided to call it.

    Single-speaker corpora get a tier plainly named "phones"; multi-speaker ones get
    "<speaker> - phones". Matching on the suffix covers both without caring which we
    were handed.
    """
    tier = _tier_named(textgrid, "phones")
    if tier is None:
        names = ", ".join(t.name for t in textgrid.tiers) or "none"
        raise AlignmentError(f"no phones tier in the TextGrid (tiers: {names})")
    return tier


# scaledown_window keeps a container alive between requests, and the number is chosen
# for a person rather than for a machine. The page now calls this through a Cloudflare
# function while someone waits, and a cold start is 30-60s of MFA loading Kaldi and the
# acoustic model -- long enough that the honest reading of the screen is "it broke".
# Five minutes covers the way this is actually used, which is a burst of takes while
# tuning a voice, and costs nothing outside one, since an idle container scales to zero
# on its own after it.
@app.function(timeout=900, cpu=4.0, memory=8192, scaledown_window=300)
def align(job):
    """
    One clip aligned, as viseme marks.

    :param job: {"name": str, "language": "en"|"fr"|"es", "audio": bytes, "script": str}
    """
    name = job["name"]
    language = job["language"]
    model = MODELS.get(language)
    if model is None:
        raise AlignmentError(
            f"{name}: unknown language {language!r}, expected one of {sorted(MODELS)}"
        )

    started = time.time()

    with TemporaryDirectory() as tmp:
        corpus = Path(tmp) / "corpus"
        aligned = Path(tmp) / "aligned"
        corpus.mkdir()
        aligned.mkdir()

        raw = corpus / "input"
        wav = corpus / "speech.wav"
        raw.write_bytes(job["audio"])

        # Transcode unconditionally rather than sniffing the container first. MFA wants
        # 16 kHz mono PCM, and handing it anything else fails in ways that look like a
        # bad alignment rather than like a bad file -- so the cheap pass is worth it
        # even on audio that was already correct.
        probe = subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw), "-ar", "16000", "-ac", "1",
             "-c:a", "pcm_s16le", str(wav)],
            capture_output=True,
        )
        if probe.returncode != 0 or not wav.exists():
            raise AlignmentError(
                f"{name}: could not decode the audio\n{probe.stderr.decode(errors='replace')[-2000:]}"
            )

        # Strip a byte-order mark before MFA ever sees it. A BOM is invisible in every
        # editor and turns the first word of the script into a word the dictionary has
        # never heard of, which aligns as `spn` and draws as a closed mouth for the
        # whole of it. Windows makes this easy to do by accident -- PowerShell's
        # `-Encoding utf8` writes one -- and the symptom, a face that will not open its
        # mouth until the second word, looks nothing like an encoding problem.
        script = job["script"].lstrip("﻿")
        (corpus / "speech.txt").write_text(script, encoding="utf-8")

        # The retry beam is left at MFA's default unless a caller asks otherwise, and
        # that is a deliberate refusal to be generous. A wider beam makes a difficult
        # utterance succeed instead of failing -- but "succeed" here can mean an
        # alignment the aligner had to strain to find, which is a plausible-looking
        # timeline rather than a right one. A hard failure is a signal; a loose fit is
        # a silently bad mouth. Callers that know their audio is hard (synthetic
        # speech, heavy noise) can widen it and own that trade.
        beam = job.get("beam")
        retryBeam = job.get("retryBeam")
        command = ["mfa", "align", "--clean", str(corpus), model, model, str(aligned)]
        if beam:
            command += ["--beam", str(beam)]
        if retryBeam:
            command += ["--retry_beam", str(retryBeam)]

        result = subprocess.run(command, capture_output=True)

        grids = sorted(aligned.rglob("*.TextGrid"))
        if not grids:
            # MFA exits 0 on some corpus-level rejections, so the missing TextGrid is a
            # better failure signal than the return code. Report both.
            raise AlignmentError(
                f"{name}: alignment produced no TextGrid (exit {result.returncode})\n"
                + result.stderr.decode(errors="replace")[-2000:]
            )

        grid = tgt.io.read_textgrid(str(grids[0]))
        tier = _phone_tier(grid)
        intervals = [(i.start_time, i.end_time, i.text) for i in tier]
        marks, oov = visemes.to_marks(intervals)

        # The words tier travels with the marks, and it is not decoration. It is the
        # only thing in the output that can be checked against a source outside MFA --
        # a TTS engine that stamped its own word timings, say -- so it is what turns
        # "the alignment looks plausible" into a number. Cheap to carry: a dozen or so
        # entries beside a few hundred marks.
        words_tier = _tier_named(grid, "words")
        words = [
            {
                "word": w.text,
                "startMs": round(w.start_time * 1000),
                "endMs": round(w.end_time * 1000),
            }
            for w in (words_tier or [])
            if w.text.strip()
        ]

        duration_ms = round(max((i[1] for i in intervals), default=0.0) * 1000)

        return {
            "source": name,
            "language": language,
            "model": model,
            "durationMs": duration_ms,
            "oovCount": oov,
            "phoneCount": len(intervals),
            "words": words,
            "alignedInSeconds": round(time.time() - started, 1),
            "marks": marks,
        }


# ---------------------------------------------------------------------------
# The build-time bake, which is the entrypoint that matters.
# ---------------------------------------------------------------------------

AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm"}


def _language_for(path, default):
    """
    Which model a file is aligned against.

    From the filename, or from a batch-wide default, and otherwise it is an error. Never
    inferred from the audio: a clip aligned against the wrong language still produces a
    full set of confident, plausible-looking marks that happen to be nonsense, which is
    much worse than refusing.
    """
    parts = {p.lower() for p in path.name.split(".")}
    for code in MODELS:
        if code in parts:
            return code
    return default


@app.local_entrypoint()
def bake(inputs: str, outputs: str = "", lang: str = "", force: bool = False):
    """
    Align every audio file in a folder that has a script beside it.

    Pairs <stem>.<ext> with <stem>.txt and writes <stem>.marks.json. Language comes from
    a .en. / .fr. / .es. infix in the filename, else from --lang.

        modal run lip_sync_api.py --inputs ./assets --lang en
    """
    in_dir = Path(inputs).expanduser().resolve()
    out_dir = Path(outputs).expanduser().resolve() if outputs else in_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs, targets, skipped, problems = [], [], [], []

    for audio in sorted(in_dir.iterdir()):
        if audio.suffix.lower() not in AUDIO_SUFFIXES:
            continue

        script = audio.with_suffix(".txt")
        if not script.exists():
            problems.append(f"{audio.name}: no {script.name} beside it")
            continue

        language = _language_for(audio, lang)
        if language not in MODELS:
            problems.append(
                f"{audio.name}: no language. Add a .en. / .fr. / .es. infix or pass --lang"
            )
            continue

        target = out_dir / (audio.stem + ".marks.json")
        if not force and target.exists():
            fresh = target.stat().st_mtime
            if fresh > audio.stat().st_mtime and fresh > script.stat().st_mtime:
                skipped.append(audio.name)
                continue

        jobs.append({
            "name": audio.name,
            "language": language,
            "audio": audio.read_bytes(),
            # utf-8-sig so a BOM-prefixed script is read correctly at the source as well
            # as defended against in align().
            "script": script.read_text(encoding="utf-8-sig"),
        })
        targets.append(target)

    if skipped:
        print(f"{len(skipped)} already up to date")
    if not jobs:
        print("nothing to align")
        for problem in problems:
            print(f"  ! {problem}")
        return

    print(f"aligning {len(jobs)}...")
    written = 0

    # return_exceptions so one bad clip reports itself at the end rather than taking the
    # rest of the batch down with it -- a bake of a hundred files should not be an
    # all-or-nothing proposition.
    for target, result in zip(targets, align.map(jobs, return_exceptions=True)):
        if isinstance(result, Exception):
            problems.append(f"{target.stem}: {result}")
            continue
        target.write_text(json.dumps(result, indent=2), encoding="utf-8")
        written += 1
        note = f"  {result['source']}  {result['durationMs']}ms  {len(result['marks'])} marks"
        if result["oovCount"]:
            note += f"  ({result['oovCount']} OOV)"
        print(note)

    print(f"\nwrote {written} to {out_dir}")
    if problems:
        print(f"\n{len(problems)} failed:")
        for problem in problems:
            print(f"  ! {problem}")


# ---------------------------------------------------------------------------
# The web endpoint, for one-offs.
# ---------------------------------------------------------------------------


@app.function(
    timeout=900,
    cpu=4.0,
    memory=8192,
    scaledown_window=300,
    secrets=[modal.Secret.from_name("lipsync-api-key", required_keys=["API_KEY"])],
)
@modal.fastapi_endpoint(method="POST")
async def generate_visemes(
    audio: fastapi.UploadFile,
    script: str = fastapi.Form(...),
    language: str = fastapi.Form("en"),
    x_api_key: str = fastapi.Header(default=""),
):
    """
    POST audio + script + language, get marks back.

    Declared as explicit form parameters rather than by taking the raw Request. It is
    self-documenting -- FastAPI derives the 422 for a malformed body itself -- and it
    sidesteps the trap the first version fell into: an unannotated `request` argument is
    not injected, it is read as a *query* parameter, so every well-formed POST came back
    422 complaining about a missing query field.

    Errors come back as real status codes. The version this replaced returned 200 with
    an {"error": ...} body, which any client checking response.ok would read as success
    and then render as a silent, motionless face.
    """
    if x_api_key != os.environ["API_KEY"]:
        raise fastapi.HTTPException(status_code=401, detail="bad or missing X-API-Key")

    language = language.lower()
    if language not in MODELS:
        raise fastapi.HTTPException(
            status_code=400, detail=f"language must be one of {sorted(MODELS)}"
        )

    try:
        return align.local({
            "name": audio.filename or "upload",
            "language": language,
            "audio": await audio.read(),
            "script": script,
        })
    except AlignmentError as error:
        raise fastapi.HTTPException(status_code=422, detail=str(error))
