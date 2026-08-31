"""
Tests for the phone mapping, asserted at the level that actually matters: the pose.

The table is read out of ../src/live/polly.ts rather than copied, which is the whole
reason the backend now lives inside vocoTrial. This file used to carry a hand-written
mirror and warn about it: "The mirror is a duplicate, and duplicates drift." It no longer
carries one, so the warning is gone and the drift is impossible -- delete an identifier
from POLLY_VISEMES and test_every_mapped_phone_reaches_a_real_pose fails here, in Python,
naming it. See polly.py.

Assertions are written on the drawn pose rather than the identifier it travels through.
A wrong identifier that still lands on the right pose is invisible to a viewer; a
right-looking identifier that lands on the wrong pose is the bug worth catching.

    python test_visemes.py        (or: python -m pytest test_visemes.py -q)
"""

import visemes
from polly import POLLY_VISEMES


def pose(phone):
    """The drawn pose a phone ends up wearing, all the way through."""
    return POLLY_VISEMES[visemes.to_polly(phone)]


def check(cases, label):
    bad = [(p, want, pose(p)) for p, want in cases if pose(p) != want]
    for phone, want, got in bad:
        print(f"  FAIL {label}: {phone!r} -> {got}, expected {want}")
    return bad


def test_every_mapped_phone_reaches_a_real_pose():
    """
    THE CROSS-LANGUAGE CONTRACT, and the reason these two now share a repository.

    Every identifier PHONE_TO_POLLY produces has to exist in the client's table, because
    the client is what turns it into a drawn mouth. Nothing enforced that while the two
    were separate repositories: removing a row from polly.ts broke a Python service that
    nothing in the TypeScript build had ever heard of, and the failure appeared as a
    closed mouth in a lesson rather than as a red test.

    Now it is this assertion, reading the real table.
    """
    unknown = {
        polly for polly in visemes.PHONE_TO_POLLY.values() if polly not in POLLY_VISEMES
    }
    assert not unknown, f"identifiers absent from POLLY_VISEMES: {sorted(unknown)}"


def test_french_front_rounded_vowels():
    """
    The case the audio driver provably cannot get right.

    visemes.ts spends most of its complexity -- RoundnessMode, FRONT_ROUNDED_LANGUAGES,
    a per-voice brightness reference -- trying to guess these from a spectrum, and its
    own comments concede it gets French "tu" wrong without the second measurement.
    Knowing the phoneme settles all three outright, which is the clearest evidence this
    driver earns its keep.
    """
    assert not check([
        ("y", "oh"),    # tu
        ("ø", "oh"),    # peu
        ("œ", "oh"),    # soeur
        ("ɥ", "oh"),    # huit
        ("ʁ", "uh"),    # uvular r -- Polly files this under k, per polly.ts
    ], "french")


def test_french_nasal_vowels_match_their_oral_counterparts():
    """A nasal vowel is the same lips; the velum is not visible from the front."""
    for nasal, oral in [("ɑ̃", "ɑ"), ("ɛ̃", "ɛ"), ("ɔ̃", "ɔ"), ("œ̃", "œ")]:
        assert pose(nasal) == pose(oral), f"{nasal} and {oral} should share a pose"


def test_spanish():
    assert not check([
        ("ɲ", "ee"),    # ano vs anyo
        ("x", "uh"),    # jamon
        ("ɾ", "uh"),    # pero  -- tap
        ("r", "uh"),    # perro -- trill; must not fall through
        ("ʝ", "ee"),    # yo
        ("β", "mbp"),   # intervocalic b, bilabial so the lips meet
        ("tʃ", "oh"),   # mucho
    ], "spanish")


def test_english_postalveolars_round():
    """
    polly.ts calls this the reason the file earns its keep.

    The analyser sorts sibilants by brightness and so cannot separate "sh" from "s".
    Both are bright; only one is protruded and rounded.
    """
    assert not check([
        ("ʃ", "oh"),    # shop
        ("ʒ", "oh"),    # vision
        ("tʃ", "oh"),   # chose
        ("dʒ", "oh"),   # judge
        ("s", "st"),    # and the plain sibilant is narrow, not spread
        ("z", "st"),
    ], "postalveolar")


def test_alveolars_are_narrow():
    """
    The pose `st` was added for, and the reason it was worth an image.

    `ee` was on screen for 41% of an English lesson and worn by half its marks -- a mouth
    that holds one shape through three or more phonemes, twenty-three times a minute. A
    quarter of all marks are these, and moving them off `ee` roughly halves its share.
    """
    assert not check([
        ("s", "st"),    # sue
        ("z", "st"),    # zed
        ("t", "st"),    # ted
        ("d", "st"),    # did
        ("n", "st"),    # not
    ], "alveolar")


def test_l_does_not_split_by_language():
    """
    THE CONSTRAINT THAT DECIDED WHERE /l/ WENT, and it is not about /l/ looking right.

    Polly routes /l/ two ways: viseme `l` from English, viseme `t` from French, Polish,
    Mandarin, Cantonese, Korean, Russian and Arabic. While both meant `ee` that cost
    nothing. Moving `t` to `st` and leaving `l` behind would have split one phoneme across
    two poses according to which language table Polly happened to use -- the same sound
    wearing two mouths for a reason no listener could point at.

    So this asserts the property rather than the destination: wherever the two go, they go
    together. visemeTable.ts states the same rule in prose.
    """
    assert POLLY_VISEMES["l"] == POLLY_VISEMES["t"], (
        f'/l/ splits by language: `l` -> {POLLY_VISEMES["l"]}, `t` -> {POLLY_VISEMES["t"]}'
    )


def test_dentals_are_narrow_too():
    """
    th gets no pose of its own, but it does get the right one of the poses there are.

    It sat on `ee` at first, kept there by an argument about the artwork -- `st` draws two
    rows of teeth nearly meeting, a tongue tip between them is the one shape it must never
    show, and a visible tongue on every /s/ is a lisp. All true, and all about what may be
    *drawn*, not about where a phone should be *routed*. No tongue is drawn either way.

    Asked as a routing question, ð/θ is dental -- teeth together, jaw nearly shut, lips
    neutral -- which is what `st` is. `ee` is spread wide with a dark strip, its opposite,
    so a face saying "the" or "with" was opening into a wide spread mouth.

    The cost, asserted below so it is not discovered by surprise: /s/ and /θ/ now share a
    pose, and "thin" and "sin" look alike. Right and ambiguous beats distinct and wrong
    for a face someone is watching to learn how a sound is made.
    """
    assert not check([("θ", "st"), ("ð", "st")], "dental")
    assert pose("θ") == pose("s"), "the merge this accepts"


def test_the_six_the_original_map_dropped():
    """
    AO, AY, HH, L, W and Y were absent from the map this service started as, so each
    fell through to `sil` -- a mouth snapping shut in the middle of a word. Their MFA
    equivalents must all reach a speaking pose.
    """
    for phone in ["ɔ", "aj", "h", "l", "w", "j"]:
        assert pose(phone) != "rest", f"{phone} falls through to a closed mouth"


def test_dialect_phones_the_build_assertion_caught():
    """
    Eight phones the hand-written table missed, found by the image build.

    All from the Indian and UK dialects folded into english_mfa, and none of them
    anything a table written by thinking about American English would reach for. That
    is the argument for deriving the inventory from the shipped dictionaries rather
    than from a phone chart: the chart is a guess about what a model contains, and this
    is what it actually contained.
    """
    assert not check([
        ("ʈ", "st"),     # retroflex t, Indian English
        ("ɖ", "st"),     # retroflex d
        ("ʈʲ", "st"),    # and with modifiers normalise already strips
        ("ʈʷ", "st"),
        ("ɫ", "st"),     # dark l, "full" -- precomposed, so normalise cannot reach it
        ("ʋ", "fv"),     # labiodental approximant: teeth still meet lip
        ("ɜ", "uh"),     # NURSE vowel, non-rhotic "bird"
        ("ɜː", "uh"),
    ], "dialect")


def test_nurse_vowel_splits_on_rhoticity():
    """
    The hooked and unhooked forms are different mouths and must not merge.

    r-coloured means the tongue bunches, which polly.ts files under `r`; the plain
    vowel leaves it where it is. Both land on `uh` today by way of different
    identifiers, so this asserts the identifiers rather than the pose -- if POLLY_VISEMES
    ever separates them, this is the test that notices.
    """
    assert visemes.to_polly("ɝ") == "r"
    assert visemes.to_polly("ɚ") == "r"
    assert visemes.to_polly("ɜ") == "@"


def test_ash_is_open_rather_than_spread():
    """
    /æ/ is near-open, and it used to be drawn as a shallow slot.

    `E` is the one identifier Polly gives a single phone, so this is the rare row that
    can be moved without dragging anything else with it. It sat with the spread poses,
    where `ee` caps the whole opening at the thickness of the upper lip -- a face saying
    "cat" barely parting its lips. The jaw is the more visible cue, so it goes to `aa`
    and gives up the spread to get it.

    Asserted against `e` as well as by name, because the split from /ɛ/ is the
    point: the two share a height in nothing but the old table.
    """
    assert pose("æ") == "aa"
    assert pose("æ") != pose("ɛ")


def test_normalisation():
    """Aspiration, length and tie bars carry nothing a flat patch can show."""
    assert pose("pʰ") == pose("p")
    assert pose("tʰ") == pose("t")
    assert pose("iː") == pose("i")
    assert pose("ʉː") == pose("ʉ")
    assert pose("t̠ʃ") == pose("tʃ")


def test_diphthongs_take_the_first_element():
    """The rule polly.ts records: aI and aU to `a`, eI to `e`, oU to `o`, OI to `O`."""
    assert not check([
        ("aɪ", "aa"), ("aj", "aa"),
        ("aʊ", "aa"), ("aw", "aa"),
        ("eɪ", "ee"), ("ej", "ee"),
        ("oʊ", "oh"), ("ow", "oh"),
        ("ɔɪ", "oh"), ("ɔj", "oh"),
    ], "diphthong")


def test_silence():
    for token in ["", "sil", "sp", "spn", "  "]:
        assert pose(token) == "rest", f"{token!r} should be a closed mouth"


def test_marks_are_well_formed():
    """
    The structural contract MarkMouth depends on.

    Onsets only, ordered, opening and closing at rest, and never two identical
    identifiers in a row.

    Note what is NOT asserted: that adjacent marks differ in *pose*. They often will
    not -- /s/, /l/ and /i/ below are three identifiers that all draw as `ee` -- and
    collapsing that far would mean putting POLLY_VISEMES in the backend, which is the
    duplication the whole design avoids. MarkMouth is unbothered either way.
    """
    intervals = [
        (0.00, 0.10, "sil"),
        (0.10, 0.18, "s"),
        (0.18, 0.26, "l"),      # a different identifier, the same drawn pose
        (0.26, 0.34, "i"),
        (0.34, 0.42, "p"),
        (0.42, 0.46, "p"),      # a genuine repeat: this one must collapse
        (0.46, 0.54, "s"),
        (0.54, 0.60, "sil"),
    ]
    marks, oov = visemes.to_marks(intervals)

    assert oov == 0
    assert marks[0] == {"timeMs": 0, "polly": "sil"}
    assert marks[-1]["polly"] == "sil"

    times = [m["timeMs"] for m in marks]
    assert times == sorted(times), "marks must be in time order"

    polls = [m["polly"] for m in marks]
    assert all(a != b for a, b in zip(polls, polls[1:])), f"adjacent duplicates: {polls}"
    assert polls == ["sil", "s", "l", "i", "p", "s", "sil"], polls

    # The doubled /p/ collapsed: eight intervals, seven marks.
    assert len(marks) == 7


def test_marks_keep_the_phone_that_selected_them():
    """
    The field that makes PHONE_TO_POLLY revisable, and the collapse rule it needs.

    /s/ and /z/ are one identifier and two phones. Collapsed on the identifier alone
    they became a single `s` mark, which was fine while the mark said nothing about
    which phone it came from -- and became a false record the moment it did. So the pair
    is compared, and "buzz saw" keeps both.

    Silence is the exception in both directions: it carries no phone, and a run of MFA's
    three spellings of it still collapses to one mark.
    """
    marks, _ = visemes.to_marks([
        (0.00, 0.10, "sil"),
        (0.10, 0.16, "sp"),
        (0.16, 0.24, "z"),
        (0.24, 0.32, "s"),
        (0.32, 0.40, "s"),
    ])

    assert marks[0] == {"timeMs": 0, "polly": "sil"}, "silence carries no phone"
    assert [m["polly"] for m in marks] == ["sil", "s", "s", "sil"]
    assert [m.get("phone") for m in marks] == [None, "z", "s", None]

    # The genuine repeat still collapses: five intervals in, one /s/ mark for the two.
    assert len(marks) == 4


def test_marks_close_on_a_clip_that_ends_mid_vowel():
    """Without a trailing sil the last phone is held forever."""
    marks, _ = visemes.to_marks([(0.0, 0.2, "sil"), (0.2, 0.5, "ɑ")])
    assert marks[-1] == {"timeMs": 500, "polly": "sil"}


def test_marks_open_at_zero_when_the_first_phone_does_not():
    marks, _ = visemes.to_marks([(0.04, 0.30, "p")])
    assert marks[0] == {"timeMs": 0, "polly": "sil"}
    assert marks[1] == {"timeMs": 40, "polly": "p", "phone": "p"}


def test_marks_open_with_speech_when_the_clip_does():
    """
    The complement of the test above, and the one that stops it being over-read.

    A leading `sil` is inserted only when the first phone starts after zero. A clip that
    is already speaking at its first sample opens with that speech instead, because the
    alternative -- a closed mouth for one frame before it -- is a flinch, not silence.

    So the guarantee is a mark AT zero, never a `rest` mark at zero. This was asserted
    the stronger way first and caught by aligning synthetic speech, which begins
    abruptly where a recording of a person almost never does.
    """
    marks, _ = visemes.to_marks([(0.0, 0.2, "p"), (0.2, 0.5, "ɑ")])
    assert marks[0] == {"timeMs": 0, "polly": "p", "phone": "p"}
    assert marks[-1]["polly"] == "sil"


def test_gaps_in_the_tier_close_the_mouth():
    """
    The bug a real recording found, and synthetic speech could not.

    MFA writes no `sil` intervals -- it leaves quiet stretches unlabelled, so a pause is
    a hole in the tier. Reading only interval starts left the previous phone in force
    across it, and a two-sentence clip held a spread, teeth-showing mouth for the whole
    460ms between the sentences. espeak and SAPI run sentences together with no real
    pause, so nothing generated in a container was ever going to catch this.
    """
    intervals = [
        (2.420, 2.560, "aj"),
        (2.560, 2.690, "t"),
        (2.690, 3.080, "s"),
        # 460ms of nothing: the pause between two sentences.
        (3.540, 3.650, "w"),
        (3.650, 3.740, "iː"),
    ]
    marks, _ = visemes.to_marks(intervals)
    at = {m["timeMs"]: m["polly"] for m in marks}
    assert at.get(3080) == "sil", f"no silence at the start of the pause: {marks}"
    assert at.get(3540) == "u", "speech does not resume when the next phone does"


def test_short_gaps_do_not_flicker():
    """
    A stop closure is a hole too, and must not be mistaken for a pause.

    The tier for "shop with" leaves 90ms between the /p/ and the /w/ -- but 90ms is over
    the threshold and does close, which is right there because /p/ is already shut. What
    must not close is the frame or two of boundary slop below it.
    """
    marks, _ = visemes.to_marks([(0.0, 0.20, "ɑ"), (0.22, 0.40, "t")])
    # The trailing sil is the close every clip gets; what matters is that no silence
    # was inserted *between* the two phones for a 20ms hole.
    assert [m["polly"] for m in marks] == ["a", "t", "sil"], marks


def test_the_goat_vowel_is_rounded():
    """
    `əw` is how MFA spells /oʊ/ in several English varieties, and it drew as schwa.

    The first-character fallback resolved it and the coverage check counted it as
    mapped, so nothing failed -- "chose" simply came out with a neutral mouth. All of
    the rounding in that diphthong is in the offglide, which is the half the fallback
    discards. Silently wrong beat uncovered, which is why the build now reports what
    the fallback is carrying.
    """
    assert pose("əw") == "oh"
    assert pose("əʊ") == "oh"
    assert not visemes.resolves_by_fallback("əw")


def test_precomposed_characters_match_their_own_rows():
    """
    `ç` is one character in the table and two after NFD, so it never matched itself.

    normalise decomposes its input; the table was written precomposed. The lookup is
    now built through normalise as well, so both sides agree. Before that, a palatal
    was drawn as a velar in all three languages -- and it was in the table the whole
    time, which is what made it invisible.
    """
    assert pose("ç") == "ee"
    assert pose("ɟʝ") == "ee"
    for phone in ["ç", "ɟʝ", "ts", "əw", "m̩", "n̩", "ɫ̩"]:
        assert not visemes.resolves_by_fallback(phone), f"{phone} still only a guess"


def test_syllabic_consonants():
    """A syllabic /m/ is still a pair of closed lips. "rhythm", "button", "little"."""
    assert pose("m̩") == pose("m")
    assert pose("n̩") == pose("n")
    assert pose("ɫ̩") == pose("ɫ")


def test_oov_is_counted():
    _, oov = visemes.to_marks([(0.0, 0.2, "sil"), (0.2, 0.4, "spn"), (0.4, 0.5, "sil")])
    assert oov == 1


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"ok    {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {name}: {error}")
    print(f"\n{failures} failed" if failures else "\nall passed")
    raise SystemExit(1 if failures else 0)
