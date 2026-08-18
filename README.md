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
| [src/tutor/TutorBench.tsx](src/tutor/TutorBench.tsx) | **tutorBench**, at `/` — every model, every knob, the prompt you write, and what the call cost |
| [src/live/LiveTrial.tsx](src/live/LiveTrial.tsx) | **liveTrial**, at `/livetrial` — one model, a face, and the picker that chooses which face |
| [src/facekit/FaceKit.tsx](src/facekit/FaceKit.tsx) | **faceKit**, at `/facekit` — authors a face, and publishes it to the shared library |
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
| [functions/api/faces/](functions/api/faces/) | The shared face library on R2 — list, get, source, publish, unpublish |
| [src/facekit/published.ts](src/facekit/published.ts) | What that library holds and where, read by the Worker and the browser alike |
| [src/facekit/store.ts](src/facekit/store.ts) | IndexedDB: the kits this browser authored, and a cache of the ones it fetched |

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
tutorBench is offered on liveTrial too, and whichever was picked last —
on either page — is the one both open on.

One real difference, surfaced in the panel rather than hidden: a saved prompt is
**fixed text**, captured in whatever language it was written in, and it does not
follow the language picker afterwards. Rewriting someone's own words on a
dropdown change would be worse than letting them go stale. Updating a built-in
is deliberately not offered — they are code; save your version as your own.

## The shared face library

A kit is nine 1024-square PNGs, which is why kits live in IndexedDB rather than
`localStorage` — and, until now, why they went nowhere else. That was fine while
one person on one laptop was the whole audience and useless the moment a face
has to appear on a machine that never authored it.

So faceKit **publishes**: it copies the kit to an R2 bucket, and every other
browser signed in to this site reads it back. liveTrial's picker is the first
consumer of that channel.

```
faceKit ──publish──► R2 ──list────► liveTrial's picker
 (any browser)         │  └─get────► the face it wears
     ▲                 │
     └────────source───┘  the same face, opened for editing
```

| Object | What it is |
| --- | --- |
| `index.json` | Every published face as `{ id, name, createdAt, publishedAt, thumb }` |
| `kits/<id>.json` | The wearable copy — one whole kit, artwork inlined as data URLs, no `original` |
| `sources/<id>.json` | The authoring copy — the same kit with `original` kept |

**The index is one object rather than a `list()` call**, because R2 will hand
back custom metadata with its keys but that metadata is HTTP headers — capped
around two kilobytes, nowhere near a thumbnail. A picker of names with no faces
is not a picker, so the alternative was one read per face just to draw the
strip. Thumbnails ride inside the index for the same reason a thumbnail cannot
be an `<img src>` pointing at a route: the middleware allows POST and nothing
else.

Four things worth knowing:

- **`publishedAt` is the whole cache check.** A browser keeps fetched kits in a
  second IndexedDB store and compares that one number against the listing, so a
  page load costs a small request rather than several megabytes of artwork that
  has not changed. A republish bumps it and the next load re-fetches.
- **Publishing keyed by the kit's own id**, so publishing twice replaces a face
  rather than leaving two with one name.
- **Two objects, one upload.** The kit goes up whole and `publish.ts` makes the
  split: verbatim to `sources/`, and minus `original` to `kits/`. `original` is
  the portrait as uploaded, kept so neutralising stays repeatable — an authoring
  concern, useless to anything that only wears the face, and close to half the
  payload. Folding it into the wearable copy would put it on every student's
  page load; a separate prefix means it is fetched only when a face is opened
  for editing. Publish uploads roughly twice what it used to; reads are
  untouched.
- **Unpublish is not delete.** It removes both shared copies; the authored kit
  in the author's own browser is untouched. faceKit's delete button is the other
  thing, deliberately kept separate so a mistake here costs a re-publish rather
  than artwork.

**A library face can be edited from any browser.** Tapping one in faceKit's
shared-library strip fetches `sources/<id>.json` into the editor, so the artwork
is no longer trapped in the IndexedDB of whichever laptop drew it; republishing
replaces the shared copy under the same id. Faces published before the
`sources/` prefix existed have no authoring copy, and open from the wearable one
instead — editable in every way except that "start again from the original" has
no original to return to. Republishing once seeds the source and settles it.

One writer is assumed. The index is read, edited and written back, so two
publishes landing together can lose one of the two entries — the kits themselves
are already safely written by then, so the loss is a face missing from the
listing until something republishes it. Not worth a lock while the author is one
person at one keyboard.

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
4. **Create the face bucket**, once, before the first publish:

   ```bash
   npx wrangler r2 bucket create vocotrial-faces
   ```

   The binding is already in [wrangler.toml](wrangler.toml) — a binding name is
   not a credential, so unlike the keys it belongs in the file. Without the
   bucket, faceKit's publish button and liveTrial's picker both say no library
   is configured, and nothing else is affected.
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
| `/api/faces/*`, the shared library | **untested** — typechecks, lints and builds; the publish → list → wear round trip, and the publish → source → edit → republish one, both need a browser and a created bucket |
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
- **Students will reach every page.** The site is one shared password, so
  anyone who can practise can also open faceKit and spend the image keys, and
  every metered call is anonymous — there is nothing to attribute a bill to or
  to rate-limit per person. A deliberate choice while the audience is nobody
  yet; the alternative is a real user store, and that is worth building once
  students are actually using this rather than before.
