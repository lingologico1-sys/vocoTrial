"""
Word-by-word disagreement between MFA and ElevenLabs' own timestamps.

    python compare_elevenlabs.py assets/lesson.fr

READ verify_timing.py FIRST. This file was written believing ElevenLabs was ground
truth -- a synthesiser does not infer where a word fell, it decided, so it knows. That
reasoning is wrong and this tool's original verdict was backwards.

What gave it away was the shape of its own output. MFA came out 200-600ms "late", the
error grew steadily through a clip instead of scattering, and in one place ElevenLabs
had a word beginning before the previous word had ended. Systematic disagreement in one
direction is not one side being inaccurate; it is two sides measuring different things.
Asking the waveform settled it: on all three lesson recordings MFA closes the mouth over
86-89% of the real silence and ElevenLabs over 12-42%. Its character timestamps are a
loose alignment -- good for highlighting text as it plays, not for driving a mouth.

So this tool no longer reports an error, because it cannot: it has no truth to measure
against. It reports a difference, and it is useful for exactly one thing -- seeing
*where* the two part company, per word, which is how the drift above was spotted in the
first place. For the question of which one is right, use verify_timing.py.
"""

import json
import statistics
import sys
import unicodedata
from pathlib import Path


def words_from_elevenlabs(payload):
    """
    Word spans, rebuilt from ElevenLabs' character timings.

    Tolerant about shape because there are several: the with-timestamps endpoint wraps
    everything in a response object, and people save either that, the `alignment` inside
    it, or the `normalized_alignment` beside it. All three end in the same three arrays.

    `normalized_alignment` is preferred where both exist. It describes the text the model
    actually spoke -- numbers spelled out, abbreviations expanded -- which is the text MFA
    was given too, so the two are comparing the same words rather than the same source
    string.
    """
    for key in ("normalized_alignment", "alignment"):
        if isinstance(payload, dict) and isinstance(payload.get(key), dict):
            payload = payload[key]
            break

    chars = payload.get("characters")
    starts = payload.get("character_start_times_seconds")
    ends = payload.get("character_end_times_seconds")
    if not (chars and starts and ends):
        raise SystemExit(
            "could not find characters / character_start_times_seconds / "
            "character_end_times_seconds in that file"
        )

    words = []
    current, start, end = "", None, None
    for char, a, b in zip(chars, starts, ends):
        if char.isspace():
            if current:
                words.append({"word": current, "startMs": round(start * 1000),
                              "endMs": round(end * 1000)})
                current, start, end = "", None, None
            continue
        if not current:
            start = a
        current += char
        end = b
    if current:
        words.append({"word": current, "startMs": round(start * 1000),
                      "endMs": round(end * 1000)})
    return words


def key(word):
    """
    A word reduced to what the two sides can be expected to agree on.

    MFA lowercases and strips punctuation into its own tier; ElevenLabs keeps the
    original string including the full stop. Comparing raw would report "lights." and
    "lights" as different words and then align the whole rest of the sentence wrongly,
    which would look like a catastrophic timing error rather than a punctuation mark.
    """
    stripped = "".join(
        c for c in unicodedata.normalize("NFD", word.lower())
        if c.isalnum() or c == "'"
    )
    return stripped


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__.strip().splitlines()[2].strip())

    stem = Path(sys.argv[1])
    marks_path = stem.with_suffix("") if stem.suffix == ".json" else stem
    marks_file = Path(f"{marks_path}.marks.json")
    # Several plausible names, including the bare one. `<stem>.json` is last so it
    # cannot shadow a more explicit file, and it can never collide with this project's
    # own output, which is always `<stem>.marks.json`.
    eleven_file = next(
        (c for c in [
            Path(f"{marks_path}.eleven.json"),
            Path(f"{marks_path}.elevenlabs.json"),
            Path(f"{marks_path}.timestamps.json"),
            Path(f"{marks_path}.json"),
        ] if c.exists()),
        None,
    )
    if not marks_file.exists():
        raise SystemExit(f"no {marks_file} -- run the bake first")
    if eleven_file is None:
        raise SystemExit(
            f"no ElevenLabs timings beside {marks_file}. Save them as "
            f"{marks_path}.eleven.json"
        )

    mfa = json.loads(marks_file.read_text(encoding="utf-8"))
    payload = json.loads(eleven_file.read_text(encoding="utf-8-sig"))
    eleven = words_from_elevenlabs(payload)

    # Refuse a pair that describes different audio. This is not hypothetical: the first
    # English pair to arrive had the timestamps of a different, much shorter clip saved
    # under the lesson's name. Compared blindly it would have reported a catastrophic
    # timing error and the honest reading would have been "the file is wrong", which is
    # a thing the tool should say rather than leave someone to infer from the numbers.
    spoken = eleven[-1]["endMs"]
    if abs(spoken - mfa["durationMs"]) > max(1500, mfa["durationMs"] * 0.1):
        raise SystemExit(
            "these two describe different audio:\n"
            f"  {marks_file.name} covers {mfa['durationMs'] / 1000:.1f}s\n"
            f"  {eleven_file.name} ends at {spoken / 1000:.1f}s\n"
            "Check that the timestamps belong to this recording."
        )
    mine = mfa.get("words") or []

    if not mine:
        raise SystemExit("the marks file carries no words tier -- re-bake, it is new")

    print(f"MFA        {len(mine)} words, {mfa['durationMs']}ms, {mfa['oovCount']} OOV")
    print(f"ElevenLabs {len(eleven)} words, {eleven[-1]['endMs']}ms")
    print()

    # Match in order and only where the words agree. A mismatch means the two are
    # describing different text, and every number after it would be meaningless.
    pairs = []
    i = j = 0
    skipped = []
    while i < len(mine) and j < len(eleven):
        if key(mine[i]["word"]) == key(eleven[j]["word"]):
            pairs.append((mine[i], eleven[j]))
            i += 1
            j += 1
        else:
            skipped.append((mine[i]["word"], eleven[j]["word"]))
            i += 1
            j += 1

    if skipped:
        print(f"{len(skipped)} words did not match by name and were skipped:")
        for a, b in skipped[:5]:
            print(f"  mfa={a!r} eleven={b!r}")
        print()

    print(f"{'word':<12} {'MFA start':>10} {'11L start':>10} {'diff':>7}   "
          f"{'MFA end':>8} {'11L end':>8} {'diff':>7}")
    starts, ends = [], []
    for a, b in pairs:
        ds = a["startMs"] - b["startMs"]
        de = a["endMs"] - b["endMs"]
        starts.append(abs(ds))
        ends.append(abs(de))
        flag = "  <-- " if max(abs(ds), abs(de)) > 35 else ""
        print(f"{a['word']:<12} {a['startMs']:>10} {b['startMs']:>10} {ds:>+7}   "
              f"{a['endMs']:>8} {b['endMs']:>8} {de:>+7}{flag}")

    both = starts + ends
    print()
    print(f"boundaries compared : {len(both)}")
    print(f"mean absolute error : {statistics.mean(both):.1f} ms")
    print(f"median              : {statistics.median(both):.1f} ms")
    print(f"90th percentile     : {sorted(both)[int(len(both) * 0.9)]:.1f} ms")
    print(f"worst               : {max(both):.1f} ms")
    print()

    # SHAPE_TAU in visemes.ts. Not a quality bar someone picked -- the point past which
    # the drawing cannot represent the difference anyway.
    inside = sum(1 for x in both if x <= 35)
    print(f"within the mouth's 35ms easing constant: {inside}/{len(both)} "
          f"({inside / len(both) * 100:.0f}%)")
    print()
    print("This is a DIFFERENCE, not an error -- neither column is truth. A large,")
    print("one-directional, growing gap means the two disagree about what they are")
    print("measuring rather than one being sloppy. Run verify_timing.py to find out")
    print("which of them the audio actually agrees with.")


if __name__ == "__main__":
    main()
