"""
POLLY_VISEMES, read from the TypeScript that owns it.

WHY THIS PARSES A .ts FILE, which looks like a strange thing for Python to do. Because
the alternative was a copy, and the copy was already rotting. Every file here that needed
the twenty-onto-seven collapse used to carry its own transcription of it, and
test_visemes.py said so in its docstring: "The mirror is a duplicate, and duplicates
drift." That was written as a caveat. It was really a bug waiting for someone to delete a
row from src/live/polly.ts and find out months later that a service in a different
repository had been quietly disagreeing.

While the two lived in separate repositories there was nothing to be done about it. Now
that they do not, the table has exactly one home -- the TypeScript, where the reasoning
for each row is written out at length -- and this reads it. A row removed there is an
import error here rather than a wrong mouth somewhere.

IT IS DELIBERATELY STRICT. A parse that quietly returned a partial table would be worse
than the mirror it replaced, because a mirror at least fails visibly when someone edits
it. So a missing file, an unfindable block, or a pose outside the seven the artwork
actually has all raise on import.

NOT SHIPPED TO THE CONTAINER. The Modal image carries visemes.py and lip_sync_api.py;
neither imports this, because nothing running remotely needs to know what a phone *draws*
-- that is the client's half of the arrangement. Only the local test entrypoints read it.
"""

import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent / "src" / "live" / "polly.ts"

# The seven the artwork has. facekit/slots.ts keys its slots on this exact union, so a
# pose outside it is a pose no kit was ever generated for.
POSES = {"rest", "mbp", "fv", "ee", "uh", "aa", "oh"}

_BLOCK = re.compile(
    r"export const POLLY_VISEMES\s*:\s*Record<[^>]+>\s*=\s*\{(.*?)^\};",
    re.DOTALL | re.MULTILINE,
)
# `sil: 'rest',` and `'@': 'uh',` -- the identifier is quoted only when it has to be.
_ENTRY = re.compile(r"^\s*'?([^\s':,]+)'?\s*:\s*'([a-z]+)'\s*,", re.MULTILINE)


def load(source=SOURCE):
    """The table as the client defines it, or an exception saying why not."""
    if not source.exists():
        raise RuntimeError(
            f"cannot find {source}. This module reads the viseme table out of the "
            "client rather than keeping a copy; see the note at the top of the file."
        )

    text = source.read_text(encoding="utf-8")
    block = _BLOCK.search(text)
    if not block:
        raise RuntimeError(
            f"found {source.name} but not the POLLY_VISEMES block in it. If the "
            "declaration was reformatted, fix the pattern here rather than pasting a "
            "copy of the table back into Python."
        )

    # Comments carry example rows in prose; strip them before reading entries.
    body = re.sub(r"/\*.*?\*/", "", block.group(1), flags=re.DOTALL)
    body = re.sub(r"//.*$", "", body, flags=re.MULTILINE)

    table = {key: pose for key, pose in _ENTRY.findall(body)}
    if not table:
        raise RuntimeError(f"POLLY_VISEMES in {source.name} parsed to nothing")

    strange = {p for p in table.values()} - POSES
    if strange:
        raise RuntimeError(
            f"{source.name} maps to poses the artwork does not have: {sorted(strange)}"
        )
    return table


POLLY_VISEMES = load()
ALL_POSES = set(POLLY_VISEMES.values())
