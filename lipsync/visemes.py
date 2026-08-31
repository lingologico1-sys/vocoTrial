"""
Turning MFA phone alignments into the marks vocoTrial's mouth already knows how to wear.

The collapse from phones to drawn poses is NOT here. It lives in the client, in
src/live/visemeTable.ts, as POLLY_VISEMES -- twenty Amazon Polly viseme identifiers onto
the eight speech poses a facekit actually contains, with the reasoning for each written
out at length. (It used to live in polly.ts, which is where this file's comments all
named it and where a reader still looks; polly.ts re-exports it, so both names find the
same table, but only one of them is where the words are.) That table is load-bearing and
hard-won: it is why the postalveolars round to `oh` instead of joining the sibilants at
`ee`, and why /l/ goes wherever /t/ goes -- `st` now, `ee` when this was written -- so
that the same sound does not change shape depending on which language table produced it.

So this module stops one step short. It maps MFA phones onto Polly's *identifiers* and
lets the existing table finish the job. One collapse in the codebase rather than two in
different languages, quietly drifting apart.

The phone set is MFA's own, shared across english_mfa / french_mfa / spanish_mfa, which
is the whole reason those models were chosen over english_us_arpa. ARPAbet is English
only, so an ARPA English model would have forced a second bespoke table the moment
French arrived, and a third for Spanish -- none of them reusable, and all of them free
to disagree with each other about a sound for no reason a speaker did.
"""

import unicodedata

# Modifiers carrying no information a flat mouth patch can show.
#
# Aspiration and length are the obvious ones: /p/ and /pʰ/ are the same lips, /i/ and
# /iː/ the same lips held longer, and a still image has no way to be held longer.
#
# The nasal tilde is the one worth defending, because dropping it looks careless on a
# French model. It is not. A nasal vowel differs from its oral counterpart in where the
# air goes, not in what the lips do -- French nasal A has the same mouth as oral A, and
# the velum doing the actual work is not visible from the front at any resolution.
_STRIP = dict.fromkeys(
    ord(c)
    for c in (
        "ʰ"  # modifier h, aspirated
        "ː"  # triangular colon, long
        "ˑ"  # half-long
        "̃"  # combining tilde, nasalised
        "̠"  # combining minus below, retracted (the t-retracted esh spelling)
        "̪"  # combining bridge below, dental
        "̥"  # combining ring below, voiceless
        "̞"  # combining down tack, lowered
        "̈"  # combining diaeresis, centralised
        "̯"  # combining inverted breve below, non-syllabic
        "̩"  # combining vertical line below, syllabic -- a syllabic /m/ is still
             # a pair of closed lips, and English writes m̩ n̩ ɫ̩ for the reduced
             # endings of "rhythm", "button", "little"
        "ʲ"  # modifier j, palatalised
        "ʷ"  # modifier w, labialised -- THE ONE ENTRY HERE THAT DISCARDS SOMETHING
             # VISIBLE. Every other modifier in this list is a tongue, a voice or a
             # length; labialisation is rounded lips, which is the one thing a flat
             # patch is good at. It is stripped anyway because nothing reaches it: no
             # phone in the three pinned dictionaries carries it, so the exposure is
             # zero marks, and un-stripping it would leave tʷ and ʈʷ unmapped and fail
             # assert_table_covers_dictionaries at image build time. If a dictionary
             # ever brings labialised phones, this line comes out and they get rows.
        "ˠ"  # modifier gamma, velarised
        "͡"  # combining double inverted breve, tie bar
        "͜"  # combining double breve below, tie bar
        "ˈ"  # primary stress
        "ˌ"  # secondary stress
        "."       # syllable boundary
    )
)


def normalise(phone):
    """A phone reduced to the distinctions a drawn mouth can actually carry."""
    return unicodedata.normalize("NFD", phone.strip()).translate(_STRIP)


# What MFA calls silence, in all three dictionaries plus the odd corners of TextGrid
# output. An empty interval is silence too -- MFA leaves gaps unlabelled rather than
# filling them.
SILENCE = {"", "sil", "sp", "spn", "<eps>", "silence"}

# How long a hole in the phone tier has to be before the mouth closes for it, in seconds.
#
# There is a threshold rather than "any gap at all" because not every hole is a pause.
# A stop closure leaves one -- the tier for "shop with" has 90ms of nothing between the
# /p/ and the /w/ -- and so does ordinary boundary slop of a frame or two. Closing on
# those is harmless where it happens after /p/, whose lips are already shut, and a
# flicker where it happens anywhere else.
#
# 50ms sits above a frame of alignment noise and below any pause a listener would hear
# as one. It is deliberately not tuned to make a particular recording look good: the
# quantity it approximates is "long enough that a held shape reads as frozen", and
# MarkMouth eases over 35ms, so anything longer than that is already visible.
GAP = 0.05

# MFA phone -> Polly viseme identifier.
#
# Grouped by the identifier rather than by language, and that is the point: nothing here
# is conditioned on which model produced the phone. A table complete over the union is
# complete for each language inside it, so adding Italian later costs a few rows rather
# than a new file. The comment above POLLY_VISEMES in visemeTable.ts makes the same
# argument about Polly's own per-language tables.
PHONE_TO_POLLY = {
    # -- p: bilabials. The one consonant a drawn mouth shows plainly. -------------
    "p": "p",
    "b": "p",
    "m": "p",
    "β": "p",    # beta, Spanish intervocalic /b/. Bilabial, so the lips meet.
    "ɱ": "p",    # labiodental nasal, an allophone before /f/

    # -- f: the labiodental, and the slot `fv` was carried for. ------------------
    "f": "f",
    "v": "f",
    "ʋ": "f",    # v with hook, the labiodental approximant. Indian English "very",
                 # and Dutch. Teeth still meet lip, so it wears the same pose.

    # -- T: dental fricatives. Castilian "cinco" as well as English "think". -----
    "θ": "T",    # theta
    "ð": "T",    # eth

    # -- t: alveolars. Tongue behind the teeth, which is to say hidden. ----------
    "t": "t",
    "d": "t",
    "n": "t",
    "ʈ": "t",    # t with retroflex hook, Indian English. The tongue curls further
    "ɖ": "t",    # d with retroflex hook, likewise -- and further back is still hidden
    "ɳ": "t",    # n with retroflex hook, for the same reason

    # -- l: laterals. -----------------------------------------------------------
    "l": "l",
    "ɫ": "l",    # l with middle tilde, the dark or velarised l of English "full".
                 # A single precomposed character rather than l plus a diacritic, so
                 # normalise cannot reach it and it needs its own row.
    "ɭ": "l",    # l with retroflex hook
    "ʎ": "l",    # turned y, Spanish "ll" in the lleista accents

    # -- s: plain sibilants. ----------------------------------------------------
    "s": "s",
    "z": "s",

    # -- S: postalveolars. Rounded and protruded, which is why visemeTable.ts sends
    #       them to `oh` rather than letting them join the sibilants above. This is the
    #       distinction the audio analyser provably cannot make, and the clearest
    #       single reason this driver is worth building.
    "ʃ": "S",          # esh
    "ʒ": "S",          # ezh
    "tʃ": "S",         # t-esh affricate
    "dʒ": "S",         # d-ezh affricate

    # -- J: alveolo-palatals and palatals. Lips spread or neutral, unlike esh. ---
    "ç": "J",          # c-cedilla
    "ɲ": "J",          # n-left-hook, Spanish enye and French "gn"
    "ɕ": "J",          # curly-tail c
    "ʑ": "J",          # curly-tail z
    "tɕ": "J",
    "dʑ": "J",
    "ʝ": "J",          # curly-tail j, Spanish "y" in "yo"

    # -- k: velars, uvulars, glottals. Everything whose distinguishing feature is
    #       a tongue pulled back out of sight. visemeTable.ts records that Polly files
    #       the French uvular R under k as well.
    "k": "k",
    "g": "k",
    "ɡ": "k",    # script g, which is what MFA actually writes
    "ŋ": "k",    # eng
    "h": "k",
    "ɦ": "k",    # h with hook
    "x": "k",         # Spanish "j" in "jamon"
    "χ": "k",    # chi
    "ɣ": "k",    # gamma, Spanish intervocalic /g/
    "ʔ": "k",    # glottal stop
    "c": "k",         # palatal stop in MFA's English set
    "ɟ": "k",    # dotless j with stroke

    # -- r: rhotics. Includes the Spanish tap/trill pair, which differ in duration
    #       rather than in anything the lips do.
    "ɹ": "r",    # turned r, English
    "ɻ": "r",    # turned r with hook
    "ʁ": "r",    # inverted small capital R, French uvular
    "r": "r",         # trill, "perro"
    "ɾ": "r",    # fish-hook r, tap, "pero"
    "ɚ": "r",    # schwa with hook
    "ɝ": "r",    # reversed open e with hook

    # -- i: close front, and the palatal glide Polly files here rather than at k. -
    "i": "i",
    "ɪ": "i",    # small capital I
    "ɨ": "i",    # i with stroke
    "j": "i",         # "yes"

    # -- e: mid front. ----------------------------------------------------------
    "e": "e",
    "ɛ": "e",    # open e

    # -- E: open front unrounded. -----------------------------------------------
    "æ": "E",    # ash

    # -- a: open and unrounded. -------------------------------------------------
    "a": "a",
    "ɑ": "a",    # script a
    "ɐ": "a",    # turned a
    "ʌ": "a",    # turned v

    # -- @: schwa, and its non-rhotic cousin. "Barely open, relaxed." -----------
    "ə": "@",
    "ɜ": "@",    # reversed open e, the NURSE vowel of non-rhotic English "bird".
                 # Distinct from the hooked version above, which is r-coloured and
                 # belongs with the rhotics: here the tongue stays put, so the mouth
                 # is simply the neutral half-open one.

    # -- o: close-mid rounded, including the French vowel of "peu", which Polly
    #       resolves outright where the audio driver has to guess at it.
    "o": "o",
    "ø": "o",    # o with stroke

    # -- O: open-mid rounded. ---------------------------------------------------
    "ɔ": "O",    # open o
    "ɒ": "O",    # turned script a -- open BACK rounded, so O and not a
    "œ": "O",    # oe ligature, "soeur"
    "ɶ": "O",    # small capital OE

    # -- u: close rounded, including the French vowel of "tu" and the labiovelar
    #       glides. visemeTable.ts notes Polly sends /w/ here rather than to k.
    "u": "u",
    "ʊ": "u",    # upsilon
    "ʉ": "u",    # u bar
    "y": "u",         # "tu"
    "ʏ": "u",    # small capital Y
    "ɯ": "u",    # turned m
    "w": "u",
    "ɥ": "u",    # turned h, French "huit"
    "ʍ": "u",    # turned w
}

# Diphthongs, which MFA writes as single two-character symbols.
#
# Polly has no diphthong visemes at all -- polly.ts records that it "maps diphthongs
# onto the plain vowel shapes: aI and aU to `a`, eI to `e`, oU to `o`, OI to `O`". So
# there is a right answer here rather than a judgement call, and it is the first
# element. Listed explicitly, though the fallback in to_polly would reach the same
# result for any spelling not anticipated here.
PHONE_TO_POLLY.update({
    "ej": "e", "eɪ": "e",
    "aj": "a", "aɪ": "a",
    "aw": "a", "aʊ": "a",
    "ow": "o", "oʊ": "o",
    "ɔj": "O", "ɔɪ": "O",
    "əɹ": "r",       # r-coloured schwa written as a sequence

    # The GOAT vowel as MFA spells it in several English varieties, and the reason
    # the first-character fallback is now reported at build time rather than trusted.
    # It resolved to schwa and drew a neutral mouth on "chose"; the rounding in this
    # diphthong is entirely in the offglide, which is exactly the half a rule that
    # reads the first character throws away.
    "əw": "o",
    "əʊ": "o",

    # Affricates written as two letters with no tie bar.
    "ts": "t",       # French "tsar", and the German-borrowed endings
    "dz": "t",
    "ɟʝ": "J",       # Spanish emphatic "yo" -- the same palatal place as ʝ, so the
                     # same spread lips, and not the velar `k` its first letter implies
})


# The table, keyed the way normalise() actually leaves a phone.
#
# Written above in precomposed form because that is how a person reads and edits it,
# and rebuilt here in decomposed form because that is what a lookup will be handed.
# Without this the two disagree exactly where it matters least visibly and most often:
# `ç` is one character in the table and two after NFD, so it never matched its own
# row and fell through to `c` -- a palatal drawn as a velar, in three languages.
_LOOKUP = {normalise(key): value for key, value in PHONE_TO_POLLY.items()}


def to_polly(phone):
    """
    One MFA phone as a Polly viseme identifier.

    The fallback is the diphthong rule generalised: a multi-character symbol this table
    has never seen is looked up by its first character, because in MFA's spellings the
    leading segment is the one the lips arrive at. That covers an affricate or glide
    spelling we did not anticipate without inventing a pose for it.

    An unknown single character returns `sil` rather than raising. A phone nobody mapped
    should have been caught by assert_table_covers_dictionaries at image build time, and
    if one somehow reaches here at run time the right failure is one closed mouth, not a
    dead bake -- the same judgement parseSpeechMarks makes about unrecognised marks.
    """
    p = normalise(phone)
    if p in SILENCE:
        return "sil"
    if p in _LOOKUP:
        return _LOOKUP[p]
    if len(p) > 1 and p[0] in _LOOKUP:
        return _LOOKUP[p[0]]
    return "sil"


def is_mapped(phone):
    """Whether a phone resolves to a pose by mapping rather than by falling through."""
    p = normalise(phone)
    if p in SILENCE:
        return True
    return p in _LOOKUP or (len(p) > 1 and p[0] in _LOOKUP)


def resolves_by_fallback(phone):
    """
    Whether a phone only resolves because of the first-character rule.

    Worth reporting separately at build time rather than counting as covered, and the
    reason is a bug this did not catch. MFA writes the GOAT vowel `əw` in some English
    varieties. The fallback dutifully resolved it to schwa, so the coverage check saw
    a mapped phone and said nothing -- but the rounding in that diphthong lives in the
    offglide, so "chose" came out with a neutral mouth instead of a rounded one.
    Silently wrong is worse than uncovered, because uncovered fails the build.

    So the fallback stays as a safety net for a spelling nobody anticipated, and the
    build now says which phones are leaning on it, so each gets a decision made.
    """
    p = normalise(phone)
    if p in SILENCE or p in _LOOKUP:
        return False
    return len(p) > 1 and p[0] in _LOOKUP


def to_marks(intervals):
    """
    A phone tier as viseme mark onsets.

    ONSETS, NOT INTERVALS, and the original spec for this service had it the other way
    round. MarkMouth reads the timeline through markAt, a binary search for the mark in
    force at a given instant -- so an end time is not merely unused, it is a second
    encoding of the next mark's start that is free to disagree with it.

    Runs are collapsed. MFA emits one interval per phone, so a doubled consonant or a
    phone split across two intervals would otherwise repeat an entry that says exactly
    what the one before it said.

    COLLAPSING COMPARES THE PHONE AS WELL AS THE IDENTIFIER, and it did not always. On
    the identifier alone, a /s/ followed by a /z/ became one `s` mark -- which was
    harmless while `polly` was the only thing a mark carried, and became a lie the
    moment `phone` joined it, because the surviving mark would name the first phone and
    silently stand for the second as well. Comparing the pair costs a handful of extra
    entries across a lesson, all of them at word boundaries, and buys a `phone` field
    that means what it says.

    Collapsing still stops short of the pose, deliberately. Adjacent marks often do
    share one -- /s/, /l/ and /i/ are three identifiers that all draw as `ee` -- and
    squeezing those out would need POLLY_VISEMES over here, which is the duplication
    this whole arrangement exists to avoid.

    `phone` IS PROVENANCE, and the reason it is worth the bytes is that PHONE_TO_POLLY
    is otherwise a one-way door. A change to POLLY_VISEMES replays against stored marks
    for free -- reposed() in visemeTable.ts does it on every load -- but a change to the
    table above could only ever be applied by running the aligner again, and a saved
    package has no audio path back to one. Keeping the phone means the two halves of the
    pipeline are equally revisable. Silence carries none: no phone produced it, which is
    the same reason a laugh carries no `polly`.

    :param intervals: (start_seconds, end_seconds, phone) triples, in time order.
    :returns: (marks, oov_count)
    """
    marks = []
    oov = 0
    last = None
    last_phone = None
    end = 0.0
    previous_stop = None

    for start, stop, text in intervals:
        if normalise(text) == "spn":
            oov += 1

        # A GAP IS A SILENCE, and this is the bug real audio found.
        #
        # MFA does not emit `sil` intervals -- it simply leaves the quiet parts
        # unlabelled, so a pause is a hole in the tier rather than an entry in it.
        # Reading only interval starts therefore leaves the previous phone in force
        # across the hole: on a two-sentence recording the /s/ ending the first
        # sentence stayed the current mark for 460ms, and the face held a spread,
        # teeth-showing mouth through the whole pause between them.
        #
        # Synthetic speech never showed it. espeak and SAPI run sentences together
        # with no real pause, so there was no hole to fall into.
        if previous_stop is not None and start - previous_stop > GAP:
            if last != "sil":
                marks.append({"timeMs": round(previous_stop * 1000), "polly": "sil"})
                last = "sil"
                last_phone = None
        previous_stop = stop

        polly = to_polly(text)
        # Silence is not articulated, so it carries no phone -- and holding that
        # invariant is also what keeps a run of `sil`, `sp` and `spn` collapsing into
        # the one mark it always did.
        phone = None if polly == "sil" else normalise(text)
        end = max(end, stop)
        if polly == last and phone == last_phone:
            continue
        mark = {"timeMs": round(start * 1000), "polly": polly}
        if phone is not None:
            mark["phone"] = phone
        marks.append(mark)
        last = polly
        last_phone = phone

    # Open at rest rather than holding the first phone early. Polly stamps a `sil` at
    # time zero on most utterances and MarkMouth falls back to 'rest' before the first
    # mark, so this is belt and braces -- but a clip whose first interval starts at 40ms
    # would otherwise have no mark at all covering those 40ms.
    if not marks or marks[0]["timeMs"] > 0:
        marks.insert(0, {"timeMs": 0, "polly": "sil"})
        if len(marks) > 1 and marks[1]["polly"] == "sil":
            del marks[1]

    # And close. Without a final `sil` the last phone is held for as long as anything
    # keeps reading the timeline, which for a mouth means a face that stops mid-vowel
    # and stays there.
    if marks[-1]["polly"] != "sil":
        marks.append({"timeMs": round(end * 1000), "polly": "sil"})

    return marks, oov
