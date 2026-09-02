# The phono face frame

LingoLecto's **Phono** is a listening exercise: a student hears a character
speak, answers questions by ear, and only afterwards sees the text. The audio,
the passage, the questions, the scrub bar and the keyboard all belong to
LingoLecto. The face belongs to vocoTrial.

This file is the contract between them, written down for the reason
[lesson-codes.md](lesson-codes.md) is written down: it is not one app's to
change. vocoTrial serves `/face-embed`; LingoLecto embeds it in an iframe and
tells it what the audio is doing. Neither can invent a message the other does
not read.

## Why the split falls here

The renderer is `SpeakingFace`, `Face`, `visemes` and `headMotion` — about 5,400
lines of React. LingoLecto is plain HTML with an inline `<script>` and no build
step. Porting the mouth into it would fork the renderer, and every future
improvement would have to be made twice.

Serving it from here instead means **a redeploy of vocoTrial reaches every Phono
already published**, in every classroom, with nothing to change at the other end.
That is the whole reason the boundary is an iframe rather than a copied file.

Two things ride on that and are easy to lose:

- **`reposed()` runs on marks arriving by message**, not only on marks fetched
  from `/api/share/take`. A package baked before `s` and `t` collapsed into `st`
  carries the old answer, and the current table is applied on the way in. This is
  the mechanism by which an old lesson picks up a new opinion about a pose.
  LingoLecto stores marks verbatim and never looks inside them, so this frame is
  the only place that can happen.
- **`migrate()` runs on the kit**, for the same reason `fetchSharedFace` calls
  it: a kit saved under format 1 is brought forward rather than left to draw
  wrong.

What does **not** flow through is generation. A new `[laughs]` variant or a
better aligner changes what a *newly generated take* contains; the take a Phono
was built from was frozen when it was saved, exactly as `/watch`'s is. Picking up
a regenerated line means re-generating, re-sharing and re-importing — the audio
changed, so the timings changed, so it is a real re-publish.

## What the frame is

`/face-embed`, in `OPEN_PAGES` — outside the site password, like `/watch`.

It is **less exposed than `/watch`**, which is why the argument against a second
open page does not bite here: it carries no credential, makes no API call and
reads no bucket. Everything it draws comes from the page embedding it. A stranger
who opens the bare path gets a resting face and nothing else.

It has **no audio element**, deliberately. Two elements playing one recording is
two clocks to keep together and one of them audible twice. The host owns the
sound, the frame owns the picture, and the clock is all that passes between them.
It follows that no audio-unlock gesture is needed here: the host's own play
button is the gesture.

## The protocol

Version `1`. Every message carries `v`, and a message with any other `v` is
ignored in silence — it was not for us.

### Host → frame

| Message | When |
|---|---|
| `{v:1, type:'track', marks, expressions, kitUrl}` | after every `ready` |
| `{v:1, type:'clock', playing, time, rate}` | play, pause, seek, rate change, and every 250 ms while playing |

- `marks` — the package's `marks`, verbatim. **Required, and must be a non-empty
  array.**
- `expressions` — the package's `expressions`, verbatim. May be absent or empty;
  a line where nothing blinks or nods legitimately has none.
- `kitUrl` — an absolute URL to a stored face kit as JSON, or null for the
  deployment's bundled face. Fetched by the frame, not posted through, because a
  kit is about 3 MB of base64 PNG.
- `time` — seconds into the recording. `rate` — playback rate, default 1.

### Frame → host

| Message | Meaning |
|---|---|
| `{v:1, type:'ready'}` | the bundle has parsed; send the track |
| `{v:1, type:'loaded'}` | the track was accepted |
| `{v:1, type:'error', reason}` | `no_marks`, `kit_origin`, or `kit_fetch` |

**The frame announces itself; the host answers.** The host cannot know when the
frame's bundle finished parsing, so a handshake that starts at the frame is what
stops a track sent too early from being lost. The host must re-send its track on
**every** `ready` it sees — React's StrictMode double-mounts in development, so
two `ready` messages for one frame is normal and not a bug.

**Errors do not blank the face.** A track with no usable marks is refused and the
previous one stands, because MarkMouth given nothing rests forever, and a resting
face is indistinguishable from a clip of silence and from a mouth that is
working. A kit that will not load leaves the bundled face in place, which
`share/face.ts` already settles the same way.

## Origins

`ALLOWED_HOSTS` in `src/watch/FaceEmbed.tsx` is checked in **both** directions —
who may drive the frame, and where a kit may be fetched from. They are the same
trust: a page allowed to tell the mouth what to say is a page allowed to say what
it wears. A `kitUrl` pointing anywhere else answers `error: kit_origin` and is
not fetched.

localhost on any port is accepted, for `wrangler pages dev` running beside
LingoLecto's own dev server. That branch cannot fire in production, where
reaching this deployment requires a Host that Cloudflare routes here — the same
argument `functions/api/_middleware.ts` makes about its own localhost case.

## The clock, and why extrapolation is safe

The frame holds the host's last sync and reads the wall clock between them:

```ts
clock = () => playing ? time + (performance.now() - at) / 1000 * rate : time;
```

A host reporting four times a second is not something the mouth can wait for, so
it estimates in between. That is safe for exactly the reason `markAt` is a binary
search rather than a cursor (`polly.ts:163-179`): the answer is correct for any
time in any order, so a sync arriving late, early or out of order replaces an
estimate rather than confusing a running position. Drift between syncs is bounded
by 250 ms of clock error, well under the 50 ms `MARK_LOOKAHEAD_MS` the mouth
already runs ahead by.

The frame animates on its own `requestAnimationFrame`, so a busy host cannot
stutter the mouth.

## What is verified, and what is not

A harness driving the frame from a second origin with a synthetic track confirms:

- different times give different mouths, and returning to a time restores it;
- a time reached by playing matches the same time reached by seeking;
- seeking backwards and forwards again is stable;
- the expression channel reads the same instant as the mouth (eyes shut inside
  their span and open either side of it);
- the mouth keeps advancing with no further syncs;
- a wrong-version message is ignored, and a malformed track is refused loudly
  rather than blanking the face.

**Idle motion is deliberately not reproducible.** Blinks, brow lifts and the idle
smile run on `headMotion`'s own timers, not the audio clock, so the face is not
frame-for-frame identical at the same time twice. Only the mouth and the
expression channel are the clock's, and only those should ever be asserted on.
