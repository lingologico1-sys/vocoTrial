# lipsync

Forced alignment on Modal, turning audio plus the script that was read into viseme marks
for the drawn mouth in [../src/live](../src/live). English, French and Spanish.

**Why it lives inside vocoTrial.** It used to be its own repository, and the arrangement
had an unenforced contract running across the gap: `PHONE_TO_POLLY` in `visemes.py`
targets the exact keys of `POLLY_VISEMES` in `../src/live/polly.ts`, and nothing checked
that they agreed. The test suite carried a hand-written copy of that table and warned
about it in its own docstring. `polly.py` now parses the real one, so a row removed from
the TypeScript is a failing Python test rather than a closed mouth in a lesson months
later.

## What it produces, and what it deliberately does not

The output is **Polly viseme identifiers**, not drawn poses:

```json
{
  "source": "lesson-01.fr.mp3",
  "language": "fr",
  "model": "french_mfa",
  "durationMs": 4210,
  "oovCount": 0,
  "marks": [
    { "timeMs": 0,   "polly": "sil" },
    { "timeMs": 120, "polly": "p"   },
    { "timeMs": 190, "polly": "a"   }
  ]
}
```

The collapse onto the seven poses a facekit actually contains — `rest mbp fv ee uh aa oh`
— happens in the client, in `src/live/polly.ts`, through the `POLLY_VISEMES` table that
already exists there for Amazon Polly. That table is not a lookup anyone should rewrite:
it carries the reasoning for why the postalveolars round to `oh` instead of joining the
sibilants at `ee`, why /l/ goes to `ee` so a sound does not change shape with the voice
speaking it, and which four of Polly's distinctions were measured and dropped because a
flat patch has no way to show a tongue.

So this service stops one step short of the pose on purpose. One collapse in the
codebase, not two in different languages drifting apart.

There is always a mark at `timeMs: 0` and the last mark is always `sil`. Note the first
is *not* always `sil`: a clip whose opening sample is already speech opens with that
speech, because snapping the mouth shut for one frame before it would be wrong. What the
timeline guarantees is that it has no gap at the start and that it closes.

`marks` are **onsets**, not intervals. `MarkMouth` reads them through `markAt`, a binary
search for the mark in force at an instant, so an end time would be a second encoding of
the next mark's start that is free to disagree with it.

## Why these models

`english_mfa`, `french_mfa`, `spanish_mfa` — all on MFA's own cross-linguistic phone set.

Not `english_us_arpa`, and the reason is French rather than anything wrong with ARPA.
ARPAbet is an English alphabet; there is no ARPA French or Spanish model. An ARPA English
model would therefore have meant one bespoke mapping table per language, none reusable,
each free to disagree with the others about a sound for no reason a speaker did. On the
shared MFA set one table covers all three and the next language costs a handful of rows.

MFA is pinned to **2.0.6**. From 2.2 it migrates to PostgreSQL, and by 3.x alignment
wants a database initialised at build and started per container, plus a non-root user to
run `initdb` as. That is a lot of apparatus to carry for a batch job.

**The models are pinned to v2.0.0 and fetched by URL, not by `mfa model download`.** This
one cost an afternoon and is worth writing down. MFA 2.0.6's downloader has no `--version`
flag and resolves a name to whatever the repository currently calls latest, which is now
v3.1.0. A 3.1.0 model loads into 2.0.6 far enough to look healthy — features extract,
`gmm-align-compiled` reports `Done 1, errors on 0` with a sane log-likelihood — and then
dies on the last step, the one that actually produces phone times:

    ERROR (lattice-align-words) Empty word-boundary file

because the 3.x model sets `position_dependent_phones: False` while 2.0.6 still asks Kaldi
for word boundaries. The alignment was fine; only the output was empty. v2.0.0 is the
release contemporaneous with 2.0.x, and the model pages label it "Compatible MFA version:
v2.0.0".

## Setup

```bash
cd lipsync
python -m venv .venv
.venv/Scripts/python -m pip install modal fastapi imageio-ffmpeg pillow
.venv/Scripts/python -m modal setup
```

`imageio-ffmpeg` and `pillow` are only for `check_frames.py`, which pulls frames out of a
screen recording; the service itself needs neither.

`fastapi` is needed locally only so the endpoint's parameter annotations resolve at deploy
time; nothing local ever serves a request.

On Windows, invoke Modal as `python -m modal` rather than `modal` — the `.exe` shim fails
to locate itself from some shells. If output dies on a `'charmap' codec` error, the
console codepage cannot render Modal's box-drawing characters; prefix with
`PYTHONIOENCODING=utf-8 PYTHONUTF8=1`.

The web endpoint reads an `API_KEY` from a Modal secret:

```bash
python -m modal secret create lipsync-api-key API_KEY=<something long and random>
```

## Authoring on /lipsync (the main path)

Type a line, pick a voice and a face, press Generate. ElevenLabs synthesises it and
returns its own character timings; those bytes go straight to the aligner here; the marks
come back and the face says it. Save keeps the package in R2.

**Why it is one request.** The four things a talking face needs — the text, the audio, the
synthesiser's timings and the aligner's marks — used to be four files carried between two
tools by hand, and the pairing went wrong twice in one afternoon. It is a silent failure:
a transcript that does not match its audio still aligns, and still returns confident
marks. Nothing downstream can detect it, because nothing is inconsistent — the marks are
a correct alignment of the wrong text. Generating and aligning in one request removes the
possibility instead of guarding against it. See `functions/api/lipsync/generate.ts`.

### Audio tags

v3 only, and sorted by what they do to an aligner rather than by how they read:

| kind | examples | effect |
|---|---|---|
| directive | `[happy]` `[whispering]` `[slowly]` | none — no audio of their own. Free. |
| pause | `[pause]` `[long pause]` | silence, which MFA leaves as a gap and `to_marks` turns into `sil`. Helps. |
| reaction | `[laughs]` `[sighs]` `[gasps]` | **audio with no words.** The hazard. |

A reaction makes sound the transcript cannot account for, so MFA stretches the
surrounding words across it and the mouth is wrong on both sides as well as during. The
fix uses ElevenLabs' own character timings, which cover the tag's brackets: the span is
known exactly, so it is marked with a pose chosen for the reaction and the measured words
either side are left alone. See `src/lipsync/tags.ts`.

It is a heuristic — a laugh is not one pose held — but the span is measured rather than
guessed, and the alternative is words smeared across a laugh.

#### Laugh library

`[laughs]` and `[giggles]` can be lifted out and replaced with an authored clip. Importing
always keeps the trimmed PCM WAV and makes a mono `mp3_44100_128` original-performance
derivative in the browser. That original is shared by every voice in its male or female
pool. The author may additionally ask ElevenLabs speech-to-speech to re-perform it for one
exact, matching-gender voice; cross-gender conversion is refused.

When both versions exist, the converted version is the default for that voice and the row
can switch back to the original after auditioning both. Old exact-voice renders continue to
work. Old retained sources remain unclassified until the author assigns a gender and makes
their original derivative.

### What it needs configured

- R2 bucket **`vocotrial-lipsync`**, bound `LIPSYNC` in `wrangler.toml`. Pages validates
  bindings at build time, so a missing bucket fails the deploy rather than the request.
- **`ELEVENLABS_API_KEY`**, and **`LIPSYNC_URL`** / **`LIPSYNC_API_KEY`** for the aligner's
  own `X-API-Key` gate. In `.dev.vars` to run locally, in the Pages dashboard for the
  deployed site — and in the Preview environment too, or preview branches fail with
  `no_key`.

## Baking marks from files

Put each audio file next to a `.txt` of what is said in it, and name the language into
the file:

```
assets/
  lesson-01.fr.mp3
  lesson-01.fr.txt
  greeting.es.wav
  greeting.es.txt
```

```bash
python -m modal run lip_sync_api.py --inputs ./assets
```

Writes `lesson-01.fr.marks.json` beside each. Files whose marks are newer than both
inputs are skipped, so re-running is cheap; `--force` overrides. A batch-wide
`--lang en` covers files with no infix. One clip failing reports itself at the end
rather than taking the batch down.

Language is never guessed from the audio. A clip aligned against the wrong model
produces a full set of confident, plausible-looking marks that are nonsense, which is a
worse outcome than refusing to start.

## One-off endpoint

```bash
curl -X POST https://<your-app-url> \
  -H "X-API-Key: $LIPSYNC_KEY" \
  -F audio=@clip.wav \
  -F script="what is said in the clip" \
  -F language=fr
```

Errors come back as status codes — 401 unauthenticated, 400 malformed, 422 alignment
failed with MFA's stderr attached. Not 200 with an error body, which any client checking
`response.ok` reads as success and then renders as a motionless face.

Expect a slow first request after a quiet period; the image is large.

## Tests

```bash
.venv/Scripts/python test_visemes.py
```

Runs locally, no Modal account needed. Assertions are written on the drawn pose rather
than the identifier it travels through — "this French vowel must reach a rounded mouth"
rather than "this phone maps to the identifier I wrote down". A wrong identifier that
lands on the right pose is invisible to a viewer; a plausible one that lands on the wrong
pose is the bug worth catching.

### The two guards

`polly.py` reads `POLLY_VISEMES` out of `../src/live/polly.ts` instead of copying it, and
between it and the tests, four kinds of drift are caught:

| what changes in polly.ts | what catches it |
|---|---|
| an identifier is removed | `test_every_mapped_phone_reaches_a_real_pose` |
| an identifier changes meaning (`f: 'fv'` → `'ee'`) | the pose assertions |
| a pose appears that no kit has | `polly.py` raises on import |
| the declaration is reformatted past recognition | `polly.py` raises on import |

Nothing running on Modal imports `polly.py` — the container has no need to know what a
phone *draws*, which is the client's half of the arrangement. That is why the two test
entrypoints import it inside `main()` rather than at module scope.

### The coverage guarantee

`assert_table_covers_dictionaries` runs as an image build step and **fails the build** if
any phone in any installed dictionary has no mapping.

This is not belt and braces. The MFA phone-set documentation says of itself that it is
"under heavy construction — many languages are missing or have incomplete entries", and
it has no French section at all, so an inventory transcribed from the docs would be a
guess. Reading it out of the dictionaries that actually shipped makes completeness
structural, the way `Record<PollyViseme, Viseme>` does for `polly.ts`.

It is also the exact check the first draft of this service would have failed: its map was
missing `AO AY HH L W Y`, so every "L", "W" and "Y" would have fallen through to `sil`
and snapped the mouth shut mid-word.

## Watch out for

**Byte-order marks in script files.** A BOM is invisible in every editor and makes the
first word of the script something the dictionary has never seen, so it aligns as `spn`
and draws as a closed mouth for the whole word. PowerShell's `-Encoding utf8` writes one.
Scripts are read with `utf-8-sig` and `align` strips a leading BOM defensively, so this is
handled — but if a face refuses to open its mouth until the second word, this is why.
`assets/probe.en.txt` deliberately still carries a BOM as a regression fixture.

**A script that does not match the audio** still aligns. MFA fits the text it was given to
the audio it was given and reports no error, so a truncated script yields marks that stop
early rather than a failure. Check `durationMs` against the real clip length.

## Known edges

- **OOV words** align as `spn` and land on `rest` — a closed mouth mid-word. `oovCount`
  is in every output; watch it on real scripts before trusting a bake. French and Spanish
  dictionary coverage of proper nouns is thinner than English.
- **Realtime is out of scope.** Pre-baked marks cannot serve `src/realtime/`, where audio
  is generated mid-call and there is nothing to bake ahead of. The reactive and scheduled
  audio analysers remain the driver there.
- **Adjacent marks may share a pose.** /s/, /l/ and /i/ are three identifiers that all
  draw as `ee`. Collapsing that far would need `POLLY_VISEMES` in this repo, which is the
  duplication the design avoids; the cost is a couple of extra entries in a binary search.
