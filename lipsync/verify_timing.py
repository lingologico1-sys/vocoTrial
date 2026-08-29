"""
Which timeline actually matches the sound: MFA's, or the one the TTS handed over.

    python verify_timing.py assets/lesson.fr

WHY THIS EXISTS, and it exists because the tool beside it started from a false premise.
compare_elevenlabs.py was written to treat ElevenLabs' character timestamps as ground
truth, on the reasoning that a synthesiser does not infer where a word fell -- it decided,
so it knows. That reasoning is wrong, and the numbers it produced said so if you read
them: MFA was reported 200-600ms "late", the error grew steadily through the clip rather
than scattering, and in one place ElevenLabs had a word starting before the previous word
had finished. Systematic disagreement in one direction is not one side being inaccurate.
It is two sides measuring different things.

So neither is assumed. The audio is asked instead.

Silence is the one landmark a waveform gives up without a model: no dictionary, no
acoustic training, no alignment, just energy against a floor. If a timeline says the
speaker paused where the sound says they were talking, that timeline is wrong, and it is
wrong by an amount anyone can read off. Everything else in an alignment is harder to
check and nothing else needs to be -- a driver that puts the pauses in the right place
has the structure right, and one that does not is visibly broken however good its
phone labels are.

WHAT THE DETECTOR IS WORTH. 10ms frames and a floor at 2% of peak, which carries its own
error of a frame or two and a little more where a phrase trails off quietly. So a
disagreement of 20-50ms here means agreement; it is the 200ms ones that are real. It is a
blunt instrument deliberately: anything cleverer would be a model, and a model is the
thing under test.
"""

import array
import json
import math

import sys
import wave
from pathlib import Path

FRAME_MS = 10
FLOOR_RATIO = 0.02
MIN_SILENCE_MS = 150


def measured_silences(path):
    """Every quiet stretch longer than MIN_SILENCE_MS, straight off the samples."""
    with wave.open(str(path)) as w:
        channels, width, rate, frames = (
            w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        )
        raw = w.readframes(frames)

    if width != 2:
        raise SystemExit(f"{path.name}: expected 16-bit audio, got {width * 8}-bit")

    samples = array.array("h")
    samples.frombytes(raw)
    if channels > 1:
        samples = samples[::channels]

    step = int(rate * FRAME_MS / 1000)
    energy = [
        math.sqrt(sum(x * x for x in samples[i:i + step]) / step)
        for i in range(0, len(samples) - step, step)
    ]
    threshold = max(energy) * FLOOR_RATIO

    spans, start = [], None
    for i, value in enumerate(energy):
        if value < threshold and start is None:
            start = i
        elif value >= threshold and start is not None:
            if (i - start) * FRAME_MS >= MIN_SILENCE_MS:
                spans.append((start * FRAME_MS, i * FRAME_MS))
            start = None
    if start is not None and (len(energy) - start) * FRAME_MS >= MIN_SILENCE_MS:
        spans.append((start * FRAME_MS, len(energy) * FRAME_MS))

    return spans, len(energy) * FRAME_MS


def eleven_gaps(payload, min_ms=MIN_SILENCE_MS):
    """
    Where ElevenLabs' own timings imply a pause.

    Between the end of one word and the start of the next. The same quantity MFA states
    outright, derived rather than declared, so the two can be scored the same way.
    """
    for key in ("normalized_alignment", "alignment"):
        if isinstance(payload, dict) and isinstance(payload.get(key), dict):
            payload = payload[key]
            break

    chars = payload["characters"]
    starts = payload["character_start_times_seconds"]
    ends = payload["character_end_times_seconds"]

    words, current, a, b = [], "", None, None
    for char, s, e in zip(chars, starts, ends):
        if char.isspace():
            if current:
                words.append((round(a * 1000), round(b * 1000)))
                current, a, b = "", None, None
            continue
        if not current:
            a = s
        current += char
        b = e
    if current:
        words.append((round(a * 1000), round(b * 1000)))

    return [
        (words[i][1], words[i + 1][0])
        for i in range(len(words) - 1)
        if words[i + 1][0] - words[i][1] >= min_ms
    ]


def score(name, claimed, measured, total):
    """
    Does the timeline say silence while the speaker is silent?

    Coverage, not distance to the nearest mark, and the difference is not pedantry --
    the first version of this measured distance and produced a 1260ms "worst miss" that
    turned out to be a silence the timeline covered perfectly well. The mark simply
    started earlier than the measured span, because an out-of-vocabulary word beside it
    had merged into the same stretch of silence. Nothing was wrong with the mouth; the
    metric was asking the wrong question.

    So the question asked here is the one the face actually poses: for every millisecond
    the recording is quiet, is the mouth closed? And its converse, which matters nearly
    as much -- for every millisecond the timeline claims silence, is the recording
    really quiet? A driver that simply said `sil` throughout would score perfectly on
    the first and catastrophically on the second.
    """
    if not claimed:
        print(f"  {name:<12} claims no pauses at all")
        return None

    def covered(spans, a, b):
        """Milliseconds of [a, b) that any span in `spans` covers."""
        return sum(max(0, min(b, y) - max(a, x)) for x, y in spans)

    quiet = sum(b - a for a, b in measured)
    hit = sum(covered(claimed, a, b) for a, b in measured)

    talking = [(0, total)]
    claimed_total = sum(b - a for a, b in claimed)
    false_silence = claimed_total - sum(covered(measured, a, b) for a, b in claimed)

    recall = hit / quiet * 100 if quiet else 0.0
    waste = false_silence / claimed_total * 100 if claimed_total else 0.0

    print(f"  {name:<12} {len(claimed):>3} pauses   "
          f"mouth shut for {recall:>5.1f}% of real silence   "
          f"{waste:>5.1f}% of its silence is over speech")
    return recall


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python verify_timing.py assets/lesson.fr")

    stem = Path(sys.argv[1])
    wav = Path(f"{stem}.wav")
    marks_file = Path(f"{stem}.marks.json")
    if not wav.exists() or not marks_file.exists():
        raise SystemExit(f"need both {wav.name} and {marks_file.name}")

    measured, total = measured_silences(wav)
    mfa = json.loads(marks_file.read_text(encoding="utf-8"))

    print(f"{wav.name}  {total / 1000:.1f}s")
    print(f"  {len(measured)} silences over {MIN_SILENCE_MS}ms in the waveform")
    print()

    # MFA states silence outright. Consecutive sil marks would be collapsed already, so
    # each one is the start of a distinct quiet stretch.
    mfa_spans = []
    marks = mfa["marks"]
    for i, m in enumerate(marks):
        if m["polly"] == "sil":
            nxt = marks[i + 1]["timeMs"] if i + 1 < len(marks) else mfa["durationMs"]
            mfa_spans.append((m["timeMs"], nxt))

    print(f"  {'source':<12} {'pauses':>3}   agreement with the waveform")
    mfa_errors = score("MFA", mfa_spans, measured, total)

    eleven_file = next(
        (c for c in [Path(f"{stem}.eleven.json"), Path(f"{stem}.json")] if c.exists()),
        None,
    )
    eleven_errors = None
    if eleven_file:
        payload = json.loads(eleven_file.read_text(encoding="utf-8-sig"))
        eleven_errors = score("ElevenLabs", eleven_gaps(payload), measured, total)

    print()
    if mfa_errors is not None and eleven_errors is not None:
        better = "MFA" if mfa_errors >= eleven_errors else "ElevenLabs"
        print(f"VERDICT: {better} closes the mouth over more of the real silence "
              f"({max(mfa_errors, eleven_errors):.1f}% vs "
              f"{min(mfa_errors, eleven_errors):.1f}%).")
    elif mfa_errors is not None:
        print(f"MFA closes the mouth over {mfa_errors:.1f}% of the real silence.")
        print("No usable ElevenLabs timings beside this clip to compare against.")


if __name__ == "__main__":
    main()
