"""
Run the lesson scripts through the pipeline on synthetic audio, before recording them.

    modal run preflight.py

The point is not alignment quality -- espeak cannot speak to that. It is to find, at no
cost, the things that would waste a real recording: a word the dictionary does not have,
a transcript MFA parses differently than intended, a script that will not align at all.
An out-of-vocabulary word aligns as silence, so a script with one in it produces a face
that shuts its mouth mid-sentence no matter how good the voice reading it was.
"""

from pathlib import Path

import modal

from lip_sync_api import MFA_ROOT, MODELS, align, app
from tts import speak, test_image


@app.function(image=test_image, timeout=300)
def unknown_words(language: str, text: str):
    """
    Which words of the script the dictionary has never heard of.

    The count alone is nearly useless -- knowing a script has two OOV words does not
    tell you whether to fix a typo or reword a sentence. Naming them does, and the
    dictionary is right there in the image.

    Matched the way MFA matches: lowercased, with the punctuation it strips removed.
    Approximate rather than exact -- MFA has its own normalisation for clitics and
    compounds -- so this can name a word that would in fact have aligned. Over-reporting
    is the right direction for a check whose whole job is to be run before someone
    spends an afternoon recording.
    """
    import unicodedata
    from pathlib import Path

    known = set()
    path = Path(MFA_ROOT) / "pretrained_models" / "dictionary" / f"{MODELS[language]}.dict"
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            head = line.split()
            if head:
                known.add(head[0].lower())

    def clean(word):
        return "".join(
            c for c in unicodedata.normalize("NFC", word.lower())
            if c.isalnum() or c in "'-"
        ).strip("'-")

    missing = []
    for raw in text.split():
        word = clean(raw)
        if word and word not in known:
            # A hyphenated compound may be listed only as its parts.
            if "-" in word and all(part in known for part in word.split("-") if part):
                continue
            missing.append(word)
    return sorted(set(missing))


@app.local_entrypoint()
def main():
    # Imported here rather than at module scope on purpose. Modal imports this
    # module inside the container to run the remote functions above, and polly.py
    # reads ../src/live/polly.ts, which is not shipped there -- nothing running
    # remotely needs to know what a phone draws. Only this entrypoint does, and
    # this entrypoint runs locally.
    from polly import POLLY_VISEMES

    problems = []

    for code in ("en", "fr", "es"):
        script = Path("assets") / f"lesson.{code}.txt"
        if not script.exists():
            continue
        text = script.read_text(encoding="utf-8-sig")

        print(f"\n=== {code} / {MODELS[code]} ===")
        print(f"    {len(text.split())} words, {text.count(chr(10) + chr(10)) + 1} paragraphs")

        audio = speak.remote(code, text)
        try:
            r = align.remote({
                "name": f"lesson.{code}.wav", "language": code,
                "audio": audio, "script": text,
                # espeak again, so the wide beam again. See test_languages.py.
                "beam": 100, "retryBeam": 400,
            })
        except Exception as error:
            print(f"    FAILED: {str(error).splitlines()[0]}")
            problems.append(f"{code}: did not align at all")
            continue

        poses = [POLLY_VISEMES[m["polly"]] for m in r["marks"]]
        print(f"    {r['phoneCount']} phones, {len(r['words'])} words aligned, "
              f"{len(r['marks'])} marks, {r['oovCount']} OOV")
        print(f"    poses used: {' '.join(sorted(set(poses)))}")

        if r["oovCount"]:
            # Which words? That is the whole reason to run this.
            names = unknown_words.remote(code, text)
            print(f"    !! {r['oovCount']} out-of-vocabulary -- each draws as a closed mouth")
            print(f"       {', '.join(names) if names else '(could not name them)'}")
            problems.append(f"{code}: OOV -- {', '.join(names)}")

        expected = len(text.split())
        if abs(len(r["words"]) - expected) > expected * 0.15:
            problems.append(
                f"{code}: MFA aligned {len(r['words'])} words but the script has "
                f"{expected} -- the transcript is not being read as intended"
            )

        if len(set(poses)) < 7:
            missing = {"rest", "mbp", "fv", "ee", "uh", "aa", "oh"} - set(poses)
            print(f"    note: never reaches {' '.join(sorted(missing))}")

    print("\n" + "=" * 60)
    if problems:
        print("fix before recording:")
        for p in problems:
            print(f"  ! {p}")
    else:
        print("all three scripts align cleanly, no OOV, multi-line transcripts read fine")
