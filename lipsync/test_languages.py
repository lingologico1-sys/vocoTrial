"""
End-to-end alignment for all three languages, on audio generated in the container.

    modal run test_languages.py

WHY SYNTHETIC AUDIO IS A FAIR TEST HERE, and it is worth being clear about because it
looks like a shortcut. In forced alignment the phone *sequence* is not recognised from
the audio -- it is looked up in the dictionary from the words in the script. The
acoustics only decide where each of those phones falls in time. So a robotic voice
gives a genuinely wrong-sounding rendition with genuinely correct phone identities,
which is exactly the half this suite is checking: that French /y/ reaches a rounded
mouth and Spanish tap and trill both reach an open one.

What it therefore does NOT test is alignment quality. espeak-ng sounds nothing like the
speech these models were trained on, so the boundaries will be looser than on real
audio. Timing needs a human voice to judge, and this suite deliberately does not claim
to have judged it -- it asserts ordering and coverage, never that a phone landed within
some number of milliseconds of where an ear would put it.
"""

from lip_sync_api import MODELS, app, align
from tts import speak

# Sentences chosen for the sounds each language's mapping is most likely to get wrong,
# and for nothing else -- they are not meant to be idiomatic.
CASES = {
    # /y/ in "tu", /ø/ in "peu", /œ/ in "soeur": the front rounded vowels. visemes.ts
    # builds an entire second measurement, and a list of ten languages to enable it
    # for, trying to infer these from a spectrum -- and concedes in its own comments
    # that the centroid alone gets "tu" wrong. Here they are simply read off.
    "fr": (
        "Tu peux voir le peu de bonheur de ta soeur.",
        {"y": "oh", "ø": "oh", "œ": "oh"},
    ),
    # Spanish's own awkward pairs: the palatal nasal, the velar fricative, and the
    # tap/trill contrast that differs in duration rather than in anything the lips do.
    "es": (
        "El niño pequeño comió jamón en el parque con su perro.",
        {"ɲ": "ee", "x": "uh", "ɾ": "uh", "r": "uh"},
    ),
    # The sibilant split polly.ts calls the reason the mark driver earns its keep, plus
    # the labiodental that the audio driver can never reach at all.
    "en": (
        "She chose a shop with five yellow lights.",
        {"ʃ": "oh", "f": "fv", "l": "ee"},
    ),
}



@app.local_entrypoint()
def main():
    # Imported here rather than at module scope on purpose. Modal imports this
    # module inside the container to run the remote functions above, and polly.py
    # reads ../src/live/polly.ts, which is not shipped there -- nothing running
    # remotely needs to know what a phone draws. Only this entrypoint does, and
    # this entrypoint runs locally.
    from polly import POLLY_VISEMES

    failures = []

    for language, (text, expected) in CASES.items():
        model = MODELS[language]
        print(f"\n=== {language} / {model} ===")
        print(f"    {text}")

        audio = speak.remote(language, text)
        print(f"    espeak produced {len(audio) / 1024:.0f} KB")

        try:
            result = align.remote({
                "name": f"probe.{language}.wav",
                "language": language,
                "audio": audio,
                "script": text,
                # Wider than the service default, and only because the audio is
                # synthetic. espeak is far enough from the speech these models were
                # trained on that the default beam finds no path at all for Spanish.
                # Real audio should never need this -- if it does, that is a finding
                # about the recording rather than a setting to reach for.
                "beam": 100,
                "retryBeam": 400,
            })
        except Exception as error:
            # One language failing must not hide the other two.
            print(f"    FAILED: {str(error).splitlines()[0]}")
            failures.append(f"{language}: alignment failed")
            continue

        poses = [POLLY_VISEMES[m["polly"]] for m in result["marks"]]
        used = sorted(set(poses))
        print(f"    {result['phoneCount']} phones -> {len(result['marks'])} marks, "
              f"{result['oovCount']} OOV, {result['durationMs']}ms")
        print(f"    poses: {' '.join(used)}")

        # Structural, and the same contract the client relies on.
        #
        # A mark AT zero, not a `rest` mark at zero. markAt returns null before the
        # first entry and MarkMouth draws that as rest, so what the timeline must not
        # have is a gap at the start -- but a clip whose very first sample is already
        # speech should open with that speech, not snap shut for one frame first.
        # espeak produces exactly such a clip, which is how this assertion got written
        # too strictly and then corrected.
        if result["marks"][0]["timeMs"] != 0:
            failures.append(f"{language}: first mark is at {result['marks'][0]['timeMs']}ms, not 0")
        if poses[-1] != "rest":
            failures.append(f"{language}: does not close at rest")
        times = [m["timeMs"] for m in result["marks"]]
        if times != sorted(times):
            failures.append(f"{language}: marks out of order")
        if result["oovCount"]:
            failures.append(
                f"{language}: {result['oovCount']} OOV -- a word aligned as silence, so "
                f"the assertions below may be checking a mouth that never opened"
            )

        # The sounds this language was chosen for. Asserted on the pose rather than the
        # identifier: a wrong identifier that still draws correctly is invisible to a
        # viewer, and a right-looking one that draws wrong is the bug worth catching.
        import visemes as _v  # local import: the table is what is under test
        for phone, want in expected.items():
            got = POLLY_VISEMES[_v.to_polly(phone)]
            mark = "ok " if got == want else "BAD"
            print(f"      {mark} /{phone}/ -> {got} (want {want})")
            if got != want:
                failures.append(f"{language}: /{phone}/ draws as {got}, expected {want}")

        # And that the pose those sounds need actually occurs in the real timeline,
        # which the table check above cannot tell you -- a correct mapping of a phone
        # the aligner never emitted proves nothing.
        for want in set(expected.values()):
            if want not in poses:
                failures.append(
                    f"{language}: no {want} anywhere in the alignment, though the "
                    f"sentence was chosen to contain one"
                )

    print("\n" + "=" * 60)
    if failures:
        print(f"{len(failures)} FAILED:")
        for failure in failures:
            print(f"  ! {failure}")
        raise SystemExit(1)
    print("all three languages aligned, and every pose under test occurred")
