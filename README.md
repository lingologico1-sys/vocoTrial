# vocoTrial

A live voice agent — you talk, the model talks back — running on Cloudflare
Pages, on **Gemini Live** over a relayed WebSocket.

> **OpenAI Realtime was removed.** It rode WebRTC straight from the browser
> against an ephemeral `ek_…` secret, and it worked; the app is Gemini-only for
> now by choice, not because that path broke. What went with it: the provider
> picker, `/api/session/*`, and seven settings that were OpenAI's alone —
> speaking rate, the two VAD detectors and their sub-fields, the input
> transcription model and its language hint, and noise reduction. `git log` is
> the reference if it comes back. **`OPENAI_API_KEY` is now read by nothing.**
> Face-kit image generation was its last consumer and has since gone Gemini-only
> too — see the foot of [src/facekit/imageModels.ts](src/facekit/imageModels.ts)
> — so the secret can be deleted from the dashboard whenever convenient.

## Three tiers, three kinds of page

Everything in this repo used to be one person's workshop. It is now split by who
a page is *for*, which is the distinction to keep in mind when adding anything:

Every page is listed on the start page at `/`, which is the front door and the
only route that is not a tool.

| Tier | Pages | Look |
| --- | --- | --- |
| **Administrator** | `/tutorbench`, `/facekit`, `/studio` | Dark, English, every knob exposed |
| **Teacher** | `/teach` | LingoLabo, English, one job |
| **Student** | `/eleve` | LingoLabo, French, no settings at all |

`/teach` is the middle tier, and as of this pass it is a whole one. A teacher
writes a Voco Session there and hands it to a class from the same page, under a
code. Publishing used to live in the studio, which meant handing out a lesson
required an administrator and a page covered in sliders; the studio now keeps
only the two things a teacher genuinely cannot supply — see [The house](#the-house).

**The tiers describe who a page is *for*, not who can reach it.** There is one
shared password and no roles, so a teacher can open the studio and a student
could open either. That is a known edge, listed below, and closing it is a user
store rather than a tweak.

`/teach` and `/eleve` both wear the LingoLabo look that ScriptoMondo and
LingoLecto wear, so the family reads as one product. They share the brand bar
itself — `src/lingo/BrandBar.tsx` — rather than two copies of the same eighty
lines of measured lockup. The workshop stays dark: it is for whoever built the
thing, and it is the only tier that is.

The one control a student has is which language *they* already speak, which
decides the language their word lookups and their end-of-call evaluation are
written in. The page around them stays in the language they are learning.

## The lesson code

A student is handed six characters and types them at `/eleve`. That is the only
way in — there is no "whichever was published last" behind it, which is what
used to let one class walk into another's conversation.

**The format is not ours to choose.** LingoLecto has been minting these since
before this app had a student page, and the intent is that one day a student
types one code and reaches whichever kind of LingoMondo lesson it names —
scribo, lecto or voco. So vocoTrial matches it exactly:

```
code    K7MPQR   six chars of ABCDEFGHJKLMNPQRSTUVWXYZ23456789
url     /eleve?token=K7MPQR
lookup  case-insensitive, uniqueness checked against R2 on mint
```

No `I`, `O`, `0` or `1` — the characters that get misread off a whiteboard. No
app prefix, which is the deliberate cost: nothing in `K7MPQR` says which app it
belongs to, and two apps minting independently can collide. The shared resolver
that fixes that does not exist yet and probably belongs in `mondo-monorepo`.

The contract, and what each app owes it, is written down in
[docs/lesson-codes.md](docs/lesson-codes.md). vocoTrial's half is
[src/realtime/lessonCodes.ts](src/realtime/lessonCodes.ts). The old `VOCO-XXXX`
codes and the old `?c=` parameter are gone and not aliased; neither was ever
shown to a student.

## The published setup

A teacher's picks live on their own laptop. A student opening `/eleve` elsewhere
would otherwise meet the defaults — a different voice, a different face, a
different prompt — with no way of telling. So a setup travels through R2, the
road faces and evaluators already took.

```
/teach ──publish──► R2 ──get by code──► /eleve
                        sessions/<CODE>.json   one published setup
```

**What goes out is not what comes back.** A publish sends ids and the lesson as
the teacher typed it; the route composes the prompt, flattens the house profile
in and mints the code. All of that needs buckets a teacher's browser has no
business reading.

```
tutor style  ─┐
face persona ─┼─► instructions  (composed in the publish route)
lesson block ─┘
face persona ───► voice         (the other half of the same kit)
```

Three things worth knowing about what is published:

- **The prompt travels as rendered text, not as ids.** A style lives in the
  house library and the persona is megabytes away in the face bucket. Composing
  at publish also means editing either afterwards cannot change a conversation
  already handed out.
- **Publishing is a snapshot.** The student gets the setup as it stood when the
  button was pressed. Publishing again mints a *new* code; the old one keeps
  working, because changing what a code resolves to after it has been read off a
  board is the one thing publishing must never do.
- **The lesson travels by value too**, for the same reason and one more. It is
  read by the student's own browser mid-conversation, so a reference would let a
  teacher editing next week's questions rewrite the screen of somebody who is
  talking right now.

See [src/realtime/session.ts](src/realtime/session.ts) and
[functions/api/sessions/](functions/api/sessions/).

## Voco Sessions

A Voco Session is one prepared lesson: a few questions on a theme, the consigne
the student is handed, the structures the teacher wants to hear, and the tutor
that asks them — a language, a manner, a face and a scale. Written on `/teach`,
and copied into a published setup as text.

It used to be called a *sheet* and held only the lesson half; the tutor half was
picked separately in the studio at publish time and never saved, so reopening
last week's material meant re-choosing the face from memory.

**The voice is not one of a teacher's picks.** It belongs to the face, on the
same persona as the biography, and an administrator writes both in faceKit. A
Voco Session did briefly carry its own — a dropdown next to the face grid,
defaulting to nothing — which meant the ordinary path of leaving it alone
published somebody's carefully written tutor in a voice nobody had chosen for
them, and the deliberate path let two people choose the two halves of one
character a week apart. The publish route now reads voice and bio out of the
kit together. Old rows still holding a `voice` string are ignored, and the
field drains the next time the lesson is saved.

```
/teach ──save──► R2 sheets.json
                     │
                     └──publish──► setup ──► /eleve   (questions, consigne)
                                          └──► report  (targets)
```

**The prose and the targets go to different readers**, which is the one thing
worth reading twice:

| | Student sees | Tutor is told | Report checks |
| --- | --- | --- | --- |
| `brief` — the consigne, prose | ✅ verbatim | ❌ | ❌ |
| `questions` — ordered | ✅ as a list | ✅ works down them | ❌ |
| `targets` — nameable structures | ❌ | ✅ steers, never announces | ✅ one verdict each |

The consigne is addressed to the learner — *"Réponds aux questions suivantes"* is
an instruction to the person answering, and handing it to the tutor gives a model
an instruction meant for somebody else, which these models act on. The targets
are the machine-readable half of the same intent, which is what lets the report
return a verdict per target instead of a paragraph of judgement about a
paragraph of prose.

**There is no built-in Voco Session**, unlike the evaluator. A report with no
scale cannot be written at all, so a scale ships in the code; a conversation
with no questions is just a conversation, which is what every session before
this feature was. "No lesson" stays a supported thing for a published setup to
carry — what is refused is *saving* one with no questions, which is a filing
cabinet entry about nothing.

On `/eleve` the first tab carries the consigne under the name **Consignes**,
keeps it up *during* the call — a learner three questions in wants to check what
the fourth one is — and turns over to **Évaluation** once a conversation has
ended. When the report arrives, consigne and button both go and the reading has
the panel to itself. Starting another call clears the report, which brings the
consigne back with no machinery of its own.

The report gains a **second axis, not a second scale**: `task` says whether the
lesson's targets were met, `bands` says where the learner stands, and neither
feeds the other. A secure A2 can miss the target and a shaky B1 can hit it. The
targets are resolved server-side from the published setup rather than taken
from the caller, for the reason the evaluator already is — they land in a system
prompt. A report with no code gets no targets, rather than falling back to
somebody else's lesson.

See [src/realtime/vocoSessions.ts](src/realtime/vocoSessions.ts),
[functions/api/voco-sessions/](functions/api/voco-sessions/) and
[src/teach/Teach.tsx](src/teach/Teach.tsx).

## The house

Publishing needs a system prompt and twenty-odd knobs describing how a face
moves. A teacher has neither and should not be asked to acquire them, so an
administrator publishes both from the studio and `/teach` spends them without
ever seeing them.

| | What it is | Where it is set |
| --- | --- | --- |
| **Tutor styles** | Named manners a teacher picks between, as rendered prompts | studio → *Publish as a tutor style* |
| **Performance profile** | One profile every published lesson carries | studio → *Save this tuning as the house default* |

A style is a *rendered* prompt, not a preset key — presets live in
`localStorage`, so a key would name a prompt the teacher's browser has never
heard of. The persona is deliberately not baked in: which face is worn is
decided per lesson on `/teach`, so the wrap is applied at publish — and the
voice rides in on the same read, which is why a teacher picking a portrait is
picking a whole character rather than a picture.

There is a library of styles and exactly one profile, and the asymmetry is the
point. A manner is a pedagogical choice a teacher should make per lesson. How
high a brow lifts is not — it is a property of how this deployment's faces are
drawn, and offering a teacher a menu of it would be offering a choice they have
no grounds to make.

**A save reaches the next publish, not the next call.** Setups already handed
out carry a flattened copy of whatever these were at the time, so retuning
cannot reach a class mid-lesson.

With an empty house bucket, `FALLBACK_PERFORMANCE` publishes exactly the face
the code ships with — but publishing refuses outright with no style, because a
tutor with no instructions is not a tutor.

See [src/realtime/house.ts](src/realtime/house.ts) and
[functions/api/house/](functions/api/house/).

## How it fits together

```
No usable browser credential exists, so the socket is relayed
  browser ──WS /api/live/gemini──► Worker ──WS ?key=…──► Vertex AI or AI Studio
     └──────── audio both ways, through Cloudflare ───────────┘   (per model)
```

Google is **two APIs**, and a model is served by whichever one carries it —
Vertex and AI Studio publish overlapping but different catalogues. So the
surface is a property of each model in
[src/realtime/models.ts](src/realtime/models.ts), not a global setting:

| model | surface | why |
| --- | --- | --- |
| `gemini-live-2.5-flash-native-audio` | Vertex (GCP billing) | GA there; the native-audio dialect |
| `gemini-3.1-flash-live-preview` | AI Studio | **no Vertex build in any region** |
| `gemini-3-pro-image` (face kit) | Vertex | confirmed generating; on the **global** endpoint only |

Vertex runs in **express mode**, which is what makes it usable from a Worker at
all: it takes an API key and infers the project, with no OAuth exchange to sign.
There is deliberately **no cross-surface fallback** — an error on one is not a
reason to spend the other account on a catalogue that may not have the model.
See [functions/api/_vertex.ts](functions/api/_vertex.ts) and
[functions/api/_aistudio.ts](functions/api/_aistudio.ts).

**Vertex is two surfaces wearing one name**, and they disagree about the host:

| | host | why |
| --- | --- | --- |
| REST `generateContent` | `aiplatform.googleapis.com` | global; express mode infers project *and* region |
| Live socket (bidi) | `us-central1-aiplatform.googleapis.com` | **regional only** — the global host has no bidi service |

That second row cost an afternoon. The global host does not answer "no bidi
here": it closes the socket with `1007 Invalid resource field value` or `1008
Publisher model … was not found`, both of which read as a wrong model id. The
identical frames reach `setupComplete` against the regional host.

The one rule the whole design turns on: **the API keys never reach the
browser.** Anything in a JS bundle is public, and a leaked key is a metered
bill.

The site is private, behind a single shared password. What that gate protects is
the account, not the UI: a stranger who never loads the page can still spend the
keys by calling `/api/*` directly, so the check lives in the middleware and the
sign-in screen is only the polite version of it. The credential is an HttpOnly
cookie carrying an HMAC of its own expiry rather than the password — a browser
cannot set custom headers on a WebSocket handshake, and a cookie is the one
credential that rides both the `fetch` and the socket. See
[functions/api/auth/_cookie.ts](functions/api/auth/_cookie.ts).

Gemini cannot honour that cheaply — its ephemeral tokens are refused on this
account (see below) — so the socket is relayed through the Worker, which keeps
the key private at the cost of a latency leg and some billed Worker time.

| Path | What it does |
| --- | --- |
| [src/start/Start.tsx](src/start/Start.tsx) | **start**, at `/` — names and explains every page; the only route that is not a tool |
| [src/tutor/TutorBench.tsx](src/tutor/TutorBench.tsx) | **tutorBench**, at `/tutorbench` — every model, every knob, the prompt you write, and what the call cost |
| [src/live/Studio.tsx](src/live/Studio.tsx) | **studio**, at `/studio` — dresses one tutor in a face and a voice, tunes how it moves, and publishes the house styles and profile |
| [src/facekit/FaceKit.tsx](src/facekit/FaceKit.tsx) | **faceKit**, at `/facekit` — authors a face, and saves it to the shared library |
| [functions/api/_middleware.ts](functions/api/_middleware.ts) | Same-origin **and** session-cookie gate in front of every `/api/*` route; POST-only except WebSocket upgrades |
| [functions/api/auth/](functions/api/auth/) | Trades the site password for a signed session cookie |
| [src/PasswordGate.tsx](src/PasswordGate.tsx) | The sign-in screen. Cosmetic — the middleware is what actually refuses |
| [functions/api/live/gemini.ts](functions/api/live/gemini.ts) | Relays the Gemini Live socket with the API key attached, to whichever surface carries the model |
| [functions/api/live/_resolve.ts](functions/api/live/_resolve.ts) | Checks the prompt and settings that arrive in the socket's opening frame |
| [functions/api/live/_setup.ts](functions/api/live/_setup.ts) | Turns those settings into the Live `setup` payload |
| [functions/api/_vertex.ts](functions/api/_vertex.ts) | Vertex host, key pair, region and express-mode model naming |
| [functions/api/live/regions.ts](functions/api/live/regions.ts) | Asks every region which models it serves, and whether it has capacity — free, and the A/B behind the quota question |
| [functions/api/_aistudio.ts](functions/api/_aistudio.ts) | The same three facts for AI Studio, for models Vertex has no build of |
| [src/realtime/instructions.ts](src/realtime/instructions.ts) | The five built-in prompts, and the default the server falls back to |
| [src/realtime/presets.ts](src/realtime/presets.ts) | Those plus your saved ones, and the last-used pick. Browser only |
| [src/realtime/settings.ts](src/realtime/settings.ts) | Which knobs exist, which models take them, and the sanitiser |
| [src/tutor/SettingsPanel.tsx](src/tutor/SettingsPanel.tsx) | The panel, rendered from the settings schema rather than written out |
| [src/realtime/gemini.ts](src/realtime/gemini.ts) | WebSocket session — this code handles mic and playback |
| [src/realtime/audio.ts](src/realtime/audio.ts) | 16 kHz capture and 24 kHz scheduled playback |
| [public/worklets/pcm-capture.js](public/worklets/pcm-capture.js) | AudioWorklet: float32 → int16, batched to ~128 ms |
| [functions/api/faces/](functions/api/faces/) | The shared face library on R2 — list, get, original, source, publish, ready, delete |
| [src/facekit/published.ts](src/facekit/published.ts) | What that library holds and where, read by the Worker and the browser alike |
| [src/facekit/store.ts](src/facekit/store.ts) | IndexedDB: a cache of the faces this browser has fetched, and which one is worn |
| [src/teach/Teach.tsx](src/teach/Teach.tsx) | **teach**, at `/teach` — writes a Voco Session and hands it out under a code |
| [src/realtime/vocoSessions.ts](src/realtime/vocoSessions.ts) | What a Voco Session is, and the block the tutor is told. Pure, shared with the Worker |
| [functions/api/voco-sessions/](functions/api/voco-sessions/) | The shared Voco Session library on R2 — list, save, delete |
| [src/realtime/lessonCodes.ts](src/realtime/lessonCodes.ts) | The six-character code, shared with LingoLecto. See [docs/lesson-codes.md](docs/lesson-codes.md) |
| [src/realtime/house.ts](src/realtime/house.ts) | Tutor styles and the performance profile an administrator sets for every teacher |
| [functions/api/house/](functions/api/house/) | The house library on R2 — get, style-save, style-delete, performance-save |
| [src/lingo/BrandBar.tsx](src/lingo/BrandBar.tsx) | The LingoMondo lockup, worn by both `/teach` and `/eleve` |
| [src/eleve/ConsignePanel.tsx](src/eleve/ConsignePanel.tsx) | The consigne and questions as the student reads them, up during the call |

## What a call can be configured with

**tutorBench** is the page for comparing realtime models as language tutors,
so the prompt and the knobs are set per call, from the panel, and kept in
`localStorage` between calls.

**The prompt is the client's to write.** It used to be server-only, so that a
visitor could not turn a metered key into their own chatbot — the right call for
a public page, and the wrong one here, because two models cannot be compared on
a prompt nobody is allowed to vary. The password gate is what keeps strangers
off the account.

What the client still may **not** send is a model id or a language code. Those
travel as keys that the Worker looks up in [src/realtime/models.ts](src/realtime/models.ts)
and [src/realtime/languages.ts](src/realtime/languages.ts), because the model
decides which meter the key is spent against. A prompt decides neither.

The settings are declared once, in
[src/realtime/settings.ts](src/realtime/settings.ts), and that one table drives
the panel, the Worker's validation and the translation into the `setup` frame.
Applicability is per **model**: native audio takes fields the half-cascade model
rejects outright, and a rejected field fails the whole call at connect. Adding a
knob means adding one entry there.

Two consequences worth knowing:

- Unset is a real state. An untouched control sends no field at all, rather than
  sending the value that happens to be Google's default today.
- Configuration arrives in the socket's **opening frame**, not the query string
  — a system instruction is far too long for a URL. The Worker holds the
  upstream socket unconfigured until that frame arrives, or for three seconds,
  whichever comes first.

### Prompts you save yourself

The five built-in prompts are functions of the language: pick Italian and every
one of them says "Italian" throughout, because they are rendered rather than
stored. They live in code, in
[src/realtime/instructions.ts](src/realtime/instructions.ts), and the Worker
imports that file for the fallback prompt — which is why it holds no browser
APIs and knows nothing about saved ones.

Saved prompts live beside them in
[src/realtime/presets.ts](src/realtime/presets.ts), under
`vocotrial.presets.v1` in `localStorage`. Write anything in the box, **Save as
new**, name it, and it joins the picker; **Update** writes over the selected one
and **Delete** removes it. Both pages read this store, so a prompt written on
tutorBench is offered in the studio too, and whichever was picked last —
on either page — is the one both open on.

One real difference, surfaced in the panel rather than hidden: a saved prompt is
**fixed text**, captured in whatever language it was written in, and it does not
follow the language picker afterwards. Rewriting someone's own words on a
dropdown change would be worse than letting them go stale. Updating a built-in
is deliberately not offered — they are code; save your version as your own.

## The shared face library

A kit is nine 1024-square PNGs. Those used to live in the authoring browser's
IndexedDB and go nowhere else, which was fine while one person on one laptop was
the whole audience and useless the moment a face had to appear on a machine that
never authored it.

So **R2 is where a kit lives**. faceKit has no local store: saving writes to the
bucket, and every other browser signed in to this site reads it back. There is
one list of faces, not a private one and a shared one.

```
faceKit ──save────► R2 ──list────► /teach's face grid (ready faces only)
 (any browser)        │  └─get────► the face it wears
     ▲                │
     └──get+original──┘  the same face, opened for editing
```

| Object | What it is |
| --- | --- |
| `index.json` | Every face as `{ id, name, createdAt, publishedAt, thumb, ready, hasOriginal }` |
| `kits/<id>.json` | One whole kit, artwork inlined as data URLs, no `original` |
| `originals/<id>.json` | The portrait that kit was authored from, on its own |

**The index is one object rather than a `list()` call**, because R2 will hand
back custom metadata with its keys but that metadata is HTTP headers — capped
around two kilobytes, nowhere near a thumbnail. A picker of names with no faces
is not a picker, so the alternative was one read per face just to draw the
strip. Thumbnails ride inside the index for the same reason a thumbnail cannot
be an `<img src>` pointing at a route: the middleware allows POST and nothing
else.

Five things worth knowing:

- **`publishedAt` is the whole cache check.** A browser keeps fetched kits in an
  IndexedDB store and compares that one number against the listing, so a page
  load costs a small request rather than several megabytes of artwork that has
  not changed. A save bumps it and the next load re-fetches. That cache is now
  the only thing IndexedDB holds, and deleting it loses nothing.
- **Keyed by the kit's own id**, so saving twice replaces a face rather than
  leaving two with one name.
- **`ready` is what separates saved from fit to wear.** A face reaches the
  library on its first save, half its mouths undrawn, because the library is the
  only place it can go — so "in the library" stopped answering "fit to put in
  front of somebody". `/teach` offers ready faces only — a teacher picking a
  half-drawn face publishes it to a class — while the studio also keeps whichever
  is currently worn, so that a draft being tested does not vanish from under the
  person testing it. faceKit shows everything, dims the drafts, and flips the
  flag through `ready.ts` — one small index write, no artwork.
- **The portrait goes up once.** `original` is kept so neutralising stays
  repeatable; it is close to half a kit's bytes and useless to anything that
  only wears the face, so it lives under its own prefix and is fetched only when
  a face is opened for editing. It also never changes after upload, so the
  browser reads `hasOriginal` from the listing it already has and skips it on
  every save after the first. First save: both halves. Every save after: the kit
  alone, roughly half the bytes.
- **Delete is delete.** It removes the kit, the portrait, and the index entry.
  The route was called `unpublish` and removed a shared copy, leaving the
  authored kit in the author's own browser; there is no second copy now, so it
  is named for what it does and faceKit asks before calling it.

**A face can be edited from any browser.** Tapping one in faceKit's library
strip reads `kits/<id>.json` through the same cache that wearing it uses — free
if this browser has worn it — and fetches the portrait beside it.

Faces saved before the `originals/` prefix report `hasOriginal: false`, and
there are two kinds. Those from the window when the whole authoring copy went to
`sources/<id>.json` still have their portrait inside it; `source.ts` hands that
object back and the browser lifts `original` out of it, which is a whole kit
across the wire to get one member and is the price of not abandoning them. Those
older than that never had a portrait at all, and open without one — editable in
every way except that "start again from the original" has no original to return
to. Either way the next save writes whatever was recovered under `originals/`,
so the detour happens once per face.

**A legacy `sources/` object is deleted only by the save that replaces it**, and
never merely to tidy up. It is the sole home of that face's portrait until
`originals/` has one, so a save that deletes it without writing the replacement
would be throwing the portrait away. Faces nobody re-saves keep theirs until the
face is deleted — storage, and nothing else.

One writer is assumed. The index is read, edited and written back, so two saves
landing together can lose one of the two entries — the kits themselves are
already safely written by then, so the loss is a face missing from the listing
until something saves it again. Not worth a lock while the author is one person
at one keyboard.

## First-time deploy

Cloudflare builds and ships this repo itself, from the Git integration. Nothing
deploys from CI — [.github/workflows/ci.yml](.github/workflows/ci.yml) only
gates the build.

1. **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**,
   pick `lingologico1-sys/vocoTrial`.
2. Build command `npm run build`, output directory `dist`. Cloudflare reads the
   rest from [wrangler.toml](wrangler.toml).
3. **Settings → Variables and Secrets**, add these **Secrets** (encrypted, not
   plain text) to Production *and* Preview:
   - `SITE_PASSWORD`
   - `GEMINI_API_KEY` (Vertex AI key — see below, it is a particular kind)
   - `GEMINI_API_KEY2` (optional fallback Vertex key)
   - `GOOGLE_API_KEY` (ordinary AI Studio key, for models with no Vertex build)

   **A Vertex key is not an ordinary API key**, and the difference is invisible:
   both are 39–53 characters of `AIza…`. Vertex refuses a plain one with `403`
   *"Requests to this API … are blocked"*. What it wants is an **authorization
   key** — an API key bound to a service account — which cannot be made from the
   Credentials page (the console greys out Agent Platform there, because the API
   does not accept unbound keys). Make it with gcloud:

   ```bash
   gcloud services enable aiplatform.googleapis.com
   gcloud iam service-accounts create vocotrial-vertex --display-name="vocoTrial Vertex"
   gcloud projects add-iam-policy-binding PROJECT_ID \
     --member="serviceAccount:vocotrial-vertex@PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/aiplatform.user"
   gcloud beta services api-keys create --display-name="vocoTrial Vertex" \
     --api-target=service=aiplatform.googleapis.com \
     --service-account=vocotrial-vertex@PROJECT_ID.iam.gserviceaccount.com
   ```

   If that last command fails with
   `FLOW_APIKEY_SERVICE_ACCOUNT_BINDING_FAILED_PRECONDITION`, an org policy is
   blocking it — `constraints/iam.managed.disableServiceAccountApiKeyCreation`,
   which Google enforces by default. Exempt the one project (needs
   `roles/orgpolicy.policyAdmin`), and expect a few minutes before the API Keys
   service notices:

   ```bash
   gcloud org-policies set-policy policy.yaml   # spec.rules[0].enforce: false
   ```

   Verify before pasting anything — free, because a rejected request is not
   billed. `404` means the credential authenticated and only the fake model id
   was refused; `401` means it is not a Vertex credential; `403` means it is
   blocked by restriction or a disabled API:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H "x-goog-api-key: KEY" -H 'Content-Type: application/json' \
     -d '{"contents":[{"role":"user","parts":[{"text":"probe"}]}]}' \
     'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-no-such-model-probe:generateContent'
   ```

   They have to go in the dashboard: because `wrangler.toml` exists, Pages takes
   plain-text vars from that file and the dashboard will only accept Secrets.
4. **Create the five buckets**, once, and do it *before the deploy that adds
   the binding* rather than before the first save:

   ```bash
   npx wrangler r2 bucket create vocotrial-faces
   npx wrangler r2 bucket create vocotrial-evaluators
   npx wrangler r2 bucket create vocotrial-sessions
   npx wrangler r2 bucket create vocotrial-sheets
   npx wrangler r2 bucket create vocotrial-house
   ```

   `vocotrial-sheets` holds Voco Sessions; the bucket name predates the rename
   and is not worth a migration to fix, so the binding is `VOCO_SESSIONS` and
   the bucket is not. See [wrangler.toml](wrangler.toml).

   The bindings are already in [wrangler.toml](wrangler.toml) — a binding name
   is not a credential, so unlike the keys they belong in the file. **Pages
   validates every binding when it builds**, so a block naming a bucket that
   does not exist fails the whole deployment and the site stays on the previous
   commit. It reads as a build failure rather than as a missing bucket; the fix
   is to create it and redeploy, and nothing needs reverting.

   Each is independently survivable if you skip it. Without `vocotrial-faces`,
   faceKit's save and the face grid say no library is configured. Without
   `vocotrial-evaluators`, the built-in scale still works — it ships in the code
   and is merged in by the browser. Without `vocotrial-sessions`, `/teach`
   cannot publish. Without `vocotrial-sheets`, `/teach` cannot save a lesson.
   Without `vocotrial-house`, no tutor style can be published — and publishing a
   lesson refuses until one is, because a tutor with no instructions is not a
   tutor.

   **After the first deploy, open `/studio` and press *Publish as a tutor
   style* once.** Nothing else works until there is one; that is the only
   required setup step beyond the buckets.
5. Push to `main`. Every push deploys; every PR gets a preview URL.

Set `SITE_PASSWORD` **before** the first deploy that includes the gate. It fails
closed, so a deployment without it locks out everyone, you included — the sign-in
screen says as much rather than looking like a wrong password.

Model ids are not configuration — they live in
[src/realtime/models.ts](src/realtime/models.ts), because the picker and the
server allowlist have to agree and a var can only hold one value.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste in the password and the keys
npm run dev:api                  # SPA + functions, which is what you want
```

`npm run dev` alone serves the SPA but not `functions/`, so `/api/live/*`
returns 404 and no call can start. Use `dev:api` for anything touching audio.

Getting a microphone requires a secure context: `localhost` counts, an IP on
your LAN does not.

```bash
npm run build              # production bundle
npm run typecheck          # src/
npm run typecheck:functions   # functions/, against workers-types
npm run lint
```

## Status

| Path | State |
| --- | --- |
| SPA, `_headers`, `_redirects`, Git-integration deploys | working |
| Same-origin gate (`403` on a forged Origin) | working |
| Password gate (`401` on every `/api/*` without a cookie, fetch and WebSocket alike) | working — verified against `wrangler pages dev`, including a tampered cookie and an unset `SITE_PASSWORD` |
| `/api/live/gemini` | **working on both surfaces** — `setupComplete` through the relay on Vertex *and* AI Studio |
| `/api/live/models` | probes candidate ids with `generateContent`, the only call this key may make |
| `/api/live/regions` | **run 2026-08-16** — all twelve hosts take the key; Pro is global-endpoint-only, Flash is in seven regions |
| `/api/image/generate` | **working on Vertex** — returned an image in ~16s on Flash |
| `/api/faces/*`, the shared library | **untested** — typechecks, lints and builds; the save → list → wear round trip, the save → get + original → edit → save one, and the `ready` flag reaching the face grid, all need a browser and a created bucket |
| `/api/house/*`, tutor styles and the profile | **untested** — typechecks, lints and builds; needs a browser and `vocotrial-house` |
| `/api/voco-sessions/*` | **untested since the rename** — the read side accepts both the old `sheets` field and the new `sessions` one, and the first save rewrites the object under the new one |
| `/api/sessions/publish`, composing the prompt server-side | **untested** — the three-layer composition (style → persona → lesson), the code mint-and-retry, and the house profile merge all need a browser and the buckets |
| `/eleve` code entry | **untested** — the `?token=` path and the typed path share one function, but neither has been run |
| Gemini handshake | **working** — 2.5 native audio on Vertex, 3.1 Flash Live on AI Studio |
| Gemini audio in a browser | untested; needs a mic |
| Saved prompt presets | typechecks and builds; the create/update/delete round trip is **untested in a browser** |
| Cost readout on 2.5 native audio | **was showing "no rates"** until this change — the rate table was keyed to the model's old AI Studio id. Now keyed to `gemini-live-2.5-flash-native-audio`; the figures themselves are unverified since the rename |

### Which model ids are actually confirmed

A model id can only be confirmed by a call that connects, because nothing
earlier looks at it. Google's `auth_tokens` accepted four mutually exclusive
spellings of a 3.1 id before minting against any of them, and the relay does not
discover a bad id either: it opens the upstream socket first, and only the
`setup` frame names the model, so a wrong one surfaces as a close code seconds
later rather than as a refusal to connect.

Both Gemini Live ids reach `setupComplete` today, each on its own surface — and
the responses differ in a way that confirms it: Vertex returns a `sessionId`, AI
Studio an empty `setupComplete`.

**A model id belongs to a surface.** The two ids that had reached
`setupComplete` twelve times out of twelve on AI Studio both `404` on Vertex.
Sixteen Live spellings across four Vertex regions produced exactly one hit:

```
✅  gemini-live-2.5-flash-native-audio                   ← GA alias, in use
✅  gemini-live-2.5-flash-preview-native-audio-09-2025   ← works, but dated
404  gemini-3.1-flash-live-preview            (AI Studio only)
404  gemini-live-3.1-flash-preview / -3.1-flash / dated variants
404  gemini-live-2.5-flash / -preview / -preview-native-audio
404  gemini-2.0-flash-live-preview-04-09 · gemini-3-flash-live-*
```

Prefer the **GA alias** over a dated preview: previews retire 45 days after
their replacement ships, and a replacement for the `-09-2025` one already exists
on AI Studio. Note the near-misses differ from the real id by a single word or a
date — do not guess.

**The 2026-10-16 retirement does not apply here.** That date covers
`gemini-2.5-flash`, `-pro` and `-flash-lite` — the standard text models, none of
which this app uses. `gemini-live-2.5-flash-native-audio` is GA with no
published retirement date, and the Live audio models were left out of that
sweep. Do not let "Gemini 2.5 retires in October" propagate onto this entry.

Still worth a periodic check, because Vertex publishes no Gemini 3 or 3.1 Live
model to migrate *to* if that ever changes. `/api/live/models` probes candidates
with `generateContent`: `404` is a wrong id, `400` is a real id that is
bidi-only, and neither is billed.

### Where the RESOURCE_EXHAUSTED bursts come from

Not yet known, and `/api/live/regions` exists to settle it. Image generation
fails in bursts that clear on their own (see the note in
[src/facekit/imageModels.ts](src/facekit/imageModels.ts)), and there are two
explanations that want opposite responses:

- **Dynamic shared quota.** Capacity is pooled per *region* across everyone
  using the model, so a `429` means the region was full at that instant — not
  that this project spent an allowance. Another region genuinely helps, and
  `us-central1`, where express mode puts us by default, is the busiest one
  Google has.
- **A cap on the project.** Express tier, or a per-project ceiling. That applies
  in every region at once, and moving is a change of hostname and nothing else.

The error is identical either way, so the way to tell them apart is to ask two
regions **during the same burst**:

```js
// from the page's console, which already holds the session cookie
await (await fetch('/api/live/regions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ regions: ['us-central1', 'europe-west4'] }),
})).json()
```

One `EXHAUSTED` and one `served here` means the pool is regional and the fix is
to move. Both `EXHAUSTED` at the same moment means it is the project, and the
levers are the billing tier or Provisioned Throughput instead. POST with no body
walks the whole candidate list, which is the run to do first — it also reports
which region the global endpoint actually resolves to.

#### What the first sweep found (2026-08-16)

All twelve hosts authenticate this key, so express mode is not pinned to one
region the way the URL shape suggests. What differs is the catalogue:

```
                          3-pro-image   2.5-flash-image
global                    SERVED        SERVED
us-central1               404           SERVED
us-east4 / -east5         404           SERVED
us-west1 / -west4         404           SERVED
europe-west1 / -west4     404           SERVED
northamerica-northeast1   404           404
asia-northeast1           404           404
asia-southeast1           404           404
australia-southeast1      404           404
```

**`gemini-3-pro-image` is published on the global endpoint and nowhere else** —
including `us-central1`, which is the region the global endpoint names in its
own error text. So "global" is not an alias for a region here; it is a distinct
routing layer that reaches capacity no regional host exposes. Flash is the
control that makes this readable: the identical probe body at the identical
hosts returns `400` for Flash wherever it returns `404` for Pro.

Two consequences, and the first is a trap:

- **Pinning a region would break Pro outright**, with a `404` that reads like a
  wrong model id rather than a wrong endpoint. Anything that adds a region to
  the generating path has to leave Pro on global. See the warning in
  [functions/api/_vertex.ts](functions/api/_vertex.ts).
- **Region-switching is a lever for Flash only** — seven regions serve it, so
  the burst A/B above is worth running on Flash and is meaningless on Pro.

It also explains, with evidence rather than suspicion, why Pro exhausts so much
sooner than Flash: Pro has exactly one pool and no fallback, while Flash has
eight places to be asked. Nothing returned `429` during the sweep, so the
capacity question itself is still open — that needs a run fired *during* a
burst.

Eleven regions is not all of them. Pro may be published somewhere unprobed;
`404` across every major US and European region is strong evidence for
global-only, not proof.

None of it is billed. Phase one sends a well-formed body to a fake model id, so
routing refuses it before the body matters; phase two sends a deliberately empty
`contents` to the real ids, so a published model gets far enough to complain
about the body (`400`, the hit) and an unpublished one still `404`s. Nothing
generates. `429` is the exception worth watching for in either phase — quota is
checked at admission, ahead of both, so a region can refuse a probe it would
otherwise have answered for free. That refusal *is* the measurement.

### Why Gemini is proxied

Gemini's ephemeral tokens do not work on this account. `auth_tokens` mints one
happily, and the token is then refused as a credential *everywhere* — not just
the Live socket but plain REST too, as `?key=`, `?access_token=`, a `Bearer`
header and `x-goog-api-key` alike:

```
socket ?access_token=…  →  1008 "Method doesn't allow unregistered callers"
socket ?key=…           →  1007 "API key not valid"
REST   (all four forms) →  400/401 "API key not valid"
```

Since nothing browser-safe can be handed out, the socket is relayed through
[functions/api/live/gemini.ts](functions/api/live/gemini.ts) instead. The key
stays server-side and the Worker — not the page — sends the setup message, so a
visitor still cannot redefine the agent. The cost is that Gemini audio hops
through Cloudflare, adding a leg of latency and billing Worker time for the
length of a call. There is no second path to fall back to: OpenAI Realtime kept
a direct browser-to-provider WebRTC line because its ephemeral secrets work, and
that was removed along with the provider.

The move to Vertex does not change any of that on its own — the relay is still
carrying the audio, and an express-mode API key is no more browser-safe than an
AI Studio one. What it changes is where the question can be asked next: the
direct browser-to-Google line this relay stands in for needs a credential the
page may hold, and if one exists it will be a Vertex one.

## Known edges

- **Auth.** The gate in `_middleware.ts` blocks other *sites* from spending our
  keys, but an `Origin` header is trivially forged outside a browser. Before
  this is public, put a real session check there — sciptomondo's
  `functions/api/auth/` is the worked example — and rate-limit per user.
- **Gemini audio is billed Worker time.** The relay holds a socket open for the
  whole call. If ephemeral tokens ever start working on this account, moving
  Gemini back to a direct connection removes both that cost and a latency leg.
- **No session resumption.** A dropped socket ends the call rather than
  reconnecting; the Live API supports resumption handles if that becomes worth
  wiring up.
- **A student's vocabulary is browser-local.** `Mon lexique` lives in
  `localStorage`, so clearing the browser loses the words, and a learner who
  moves to another machine starts empty. There is no student account to hang a
  list on — the site is one shared password — and inventing a user store before
  anybody is using the page would be building the wrong thing early. Same
  reasoning as the row below, and the same trigger for revisiting it.
- **The dictionary is French-only, and says so.** Every rule in the instruction
  is French lexicography — `un`/`une`, the six-form conjugation, the `-e → -es`
  plural. A second target language is a second instruction, not a parameter;
  templating the language name into this one would produce confidently wrong
  grammar notes. The student UI is likewise a French string table, shaped so a
  second language is a second table.
- **`/eleve` is desktop-only.** LingoLecto stacks its right-hand column under
  the reading below a breakpoint; this does not yet. The consigne panel makes
  this worse, not better: the questions a learner most wants to glance at
  mid-call are in the column that has nowhere to go on a phone.
- **A lesson code says nothing about which app it belongs to.** Six bare
  characters is LingoLecto's format and now ours, so nothing in `K7MPQR`
  distinguishes a reading from a conversation, and two apps minting
  independently can collide. Deliberate — an app prefix would defeat the shared
  resolver the format exists for — but the resolver does not exist yet. See
  [docs/lesson-codes.md](docs/lesson-codes.md).
- **A code is the student's whole credential, over a billion-wide keyspace.**
  Enough to stop a typo landing in another class's lesson; not enough to defend
  anything against somebody grinding it. Nothing should go behind a code that
  you would mind a stranger reaching.
- **Every teacher can see every teacher's codes.** `/api/sessions/list` is
  behind the site password like everything else, which today means one list for
  the whole deployment. The first thing to gate when roles arrive.
- **A Voco Session is written in one language and cannot follow the picker.**
  Same limitation as a saved preset, and the same reason: the text is captured
  once, so rewriting somebody's own questions on a dropdown change would lose
  work. Switching the target language leaves the questions saying what they said.
- **Nothing checks that the questions, the tutor style and the target language
  agree.** A French lesson published on an Italian setting, with a style
  rendered for German, produces a tutor working down French questions in
  Italian, and no part of the app objects.
- **Students and teachers will reach every page.** The site is one shared
  password and there are no roles, so the three tiers describe who a page is
  *for* and not who can open it: a teacher can open the studio, and a student
  can open faceKit and spend the image keys. Deferred deliberately for now, and
  every metered call is anonymous — there is nothing to attribute a bill to or
  to rate-limit per person. A deliberate choice while the audience is nobody
  yet; the alternative is a real user store, and that is worth building once
  students are actually using this rather than before.
