"""
Pull frames out of a screen recording at the moments the marks say something specific.

    python check_frames.py capture.mp4 assets/lesson.fr --grid        # find the offset
    python check_frames.py capture.mp4 assets/lesson.fr --offset 3.2  # then the real thing

WHY BOTHER, when the page already prints the pose it is wearing. Because that readout and
the mouth are fed from the same value, so agreeing proves nothing about the half that has
never been checked. Every test in this project stops at the marks: MFA's output parses
into VisemeMark, MarkMouth drives it correctly against a fake clock, all seven poses are
reachable. Not one of them looks at a drawn face. A pose table wired to the wrong artwork,
a kit missing a slot, an easing bug that never reaches its target -- all of that passes
everything written so far and is obvious in a single frame.

So this extracts the frames where the answer is unambiguous and leaves the judging to
someone who can see them.

THE OFFSET is the only fiddly part, and it cannot be avoided: a screen recording starts
when you press record and the audio starts when you press play, so frame time and audio
time differ by however long you took. `--grid` writes evenly spaced frames across the
first stretch so that gap can be read off -- find the frame where the mouth first moves,
subtract the time of the first speaking mark, and that is the offset.
"""

import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

from polly import POLLY_VISEMES


LOOKS = {
    "rest": "closed, relaxed, faintly upturned",
    "mbp": "lips pressed shut, thinner than rest",
    "fv": "upper teeth resting on the lower lip",
    "ee": "spread, a shallow slot with a band of teeth",
    "uh": "a small soft oval, jaw barely dropped",
    "aa": "wide open, jaw dropped, teeth along the top",
    "oh": "a small rounded O, lips pushed forward",
}

# What the page reads ahead by. MarkMouth is asked about the moment `lookahead` in the
# future, so the shape on screen at time t is the pose the marks give for t + this. Miss
# it and every frame is judged against the pose just before the one being drawn.
MARK_LOOKAHEAD_MS = 50


def marks_at(marks, ms):
    """The mark in force at a moment, by the same binary search markAt uses."""
    low, high, found = 0, len(marks) - 1, None
    while low <= high:
        mid = (low + high) >> 1
        if marks[mid]["timeMs"] <= ms:
            found = marks[mid]
            low = mid + 1
        else:
            high = mid - 1
    return found


def interesting(data, want=9):
    """
    Moments worth a frame: a distinctive pose, held long enough to be unambiguous.

    Held for at least 170ms because a shorter one is still being eased into when the
    frame lands, and a half-formed mouth proves nothing either way. Distinctive because
    `ee` and `uh` are the poses a wrong answer most easily hides in -- if the artwork
    were wired up wrongly, `oh`, `fv` and `mbp` are where it would show.
    """
    marks = data["marks"]
    words = data.get("words", [])
    picks, counts = [], {}

    for i, mark in enumerate(marks):
        nxt = marks[i + 1]["timeMs"] if i + 1 < len(marks) else data["durationMs"]
        hold = nxt - mark["timeMs"]
        pose = POLLY_VISEMES[mark["polly"]]
        previous = POLLY_VISEMES[marks[i - 1]["polly"]] if i else None

        if hold < 170 or pose == previous:
            continue
        if pose in ("ee", "uh"):
            continue
        if counts.get(pose, 0) >= 2:
            continue

        word = next(
            (w["word"] for w in words if w["startMs"] <= mark["timeMs"] < w["endMs"]),
            "(pause)",
        )
        # A third of the way in: past the easing, clear of the next transition.
        picks.append((mark["timeMs"] + hold // 3, pose, word, hold))
        counts[pose] = counts.get(pose, 0) + 1

    return sorted(picks)[:want]


def grab(video, seconds, out):
    """One frame, by seeking before the input so ffmpeg does not decode the whole file."""
    subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-ss", f"{seconds:.3f}",
         "-i", str(video), "-frames:v", "1", "-q:v", "2", str(out)],
        capture_output=True, check=False,
    )
    return out.exists()


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__.strip().splitlines()[2].strip())

    video = Path(sys.argv[1])
    data = json.loads(Path(f"{sys.argv[2]}.marks.json").read_text(encoding="utf-8"))
    args = sys.argv[3:]
    out_dir = video.parent / f"{video.stem}-frames"
    out_dir.mkdir(exist_ok=True)

    if not video.exists():
        raise SystemExit(f"no {video}")

    if "--grid" in args:
        # Evenly spaced over the first stretch, to read the offset off by eye.
        first = next(
            (m for m in data["marks"] if m["polly"] != "sil"), data["marks"][0]
        )
        print(f"First speaking mark is at {first['timeMs'] / 1000:.2f}s of audio "
              f"({POLLY_VISEMES[first['polly']]}).")
        print("Find the frame below where the mouth first moves, then:")
        print("  offset = that frame's time - "
              f"{first['timeMs'] / 1000:.2f}\n")
        for i in range(16):
            at = i * 0.5
            path = out_dir / f"grid-{at:05.2f}s.jpg"
            if grab(video, at, path):
                print(f"  {path.name}")
        print(f"\nwritten to {out_dir}")
        return

    offset = 0.0
    if "--offset" in args:
        offset = float(args[args.index("--offset") + 1])

    picks = interesting(data)
    print(f"{video.name}  offset {offset:+.2f}s\n")
    print(f"{'frame':<26} {'audio':>8}  {'pose':<5} what it should look like")
    for audio_ms, pose, word, hold in picks:
        # The page reads ahead, so the shape on screen at a moment belongs to the mark
        # slightly after it. Subtracting here puts the frame where that shape is drawn.
        at = (audio_ms - MARK_LOOKAHEAD_MS) / 1000 + offset
        if at < 0:
            continue
        name = f"{pose}-{audio_ms / 1000:06.2f}s-{word[:12]}.jpg"
        if grab(video, at, out_dir / name):
            print(f"{name:<26} {audio_ms / 1000:>7.2f}s  {pose:<5} {LOOKS[pose]}")

    print(f"\nwritten to {out_dir}")
    print("Each filename says the pose that frame must show. A frame that disagrees is")
    print("the first evidence in this project that the drawing and the marks differ.")


if __name__ == "__main__":
    main()
