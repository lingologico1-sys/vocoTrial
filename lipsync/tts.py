"""
Synthetic speech and the pose table, shared by the test entrypoints.

Only espeak lives here now; the viseme table moved to polly.py, which reads it out
of the TypeScript instead of keeping a copy.

Its own module for two reasons. Modal allows one local entrypoint per name per app, so
a test file that imports another test file to reuse a helper collides on `main` -- and
`@app.function` only works at module scope, so the helper cannot be handed out by a
factory either. Registering it here once, on the app both tests already import, is what
satisfies both constraints.
"""

from lip_sync_api import app, mfa_image

# espeak-ng is a layer of its own so the aligner image stays exactly what ships. apt
# rather than conda-forge, which has no espeak-ng -- the micromamba base is Debian.
# The test modules ride on this image and not on the one that ships. mfa_image is
# what `modal deploy` publishes; anything added here is visible only to the test
# entrypoints, which is where test code belongs.
test_image = mfa_image.apt_install("espeak-ng").add_local_python_source(
    "tts", "visemes", "lip_sync_api"
)



@app.function(image=test_image, timeout=900, cpu=4.0, memory=8192)
def speak(language: str, text: str) -> bytes:
    """A clip of the given text, in the given language, from espeak-ng."""
    import subprocess
    from pathlib import Path
    from tempfile import TemporaryDirectory

    with TemporaryDirectory() as tmp:
        wav = Path(tmp) / "speech.wav"
        # Slower than default: espeak at speed crushes short vowels to a couple of
        # frames, and an aligner given two frames of a vowel puts the boundary
        # somewhere defensible but arbitrary.
        subprocess.run(
            ["espeak-ng", "-v", language, "-s", "130", "-w", str(wav), text],
            check=True, capture_output=True,
        )
        return wav.read_bytes()
