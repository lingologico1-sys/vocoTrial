# vocoTrial

A live voice agent — you talk, the model talks back — running on Cloudflare
Pages. Two providers behind one UI: **Gemini Live** (WebSocket) and **OpenAI
Realtime** (WebRTC).

## How it fits together

```
OpenAI ── ephemeral secret, then audio goes direct ────────────────────┐
  browser ──POST /api/session/openai──► Worker ──► OpenAI              │
     │◄──────── ek_… secret ───────────────┘                           │
     └──────── WebRTC audio, no relay ────────────────────► OpenAI ◄───┘

Gemini ── no usable browser credential exists, so the socket is relayed
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
| face-kit image models | Vertex | both confirmed generating |

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

The one rule the whole design turns on: **the provider API keys never reach the
browser.** Anything in a JS bundle is public, and a leaked Realtime key is a
metered bill.

The site is private, behind a single shared password. What that gate protects is
the account, not the UI: a stranger who never loads the page can still spend the
keys by calling `/api/*` directly, so the check lives in the middleware and the
sign-in screen is only the polite version of it. The credential is an HttpOnly
cookie carrying an HMAC of its own expiry rather than the password — a browser
cannot set custom headers on a WebSocket handshake, and a cookie is the one
credential that rides both the `fetch` and the socket. See
[functions/api/auth/_cookie.ts](functions/api/auth/_cookie.ts).

OpenAI lets us honour that cheaply: the Worker trades the key for a short-lived
`ek_…` secret, and audio then flows browser-to-OpenAI with no hop through
Cloudflare. Gemini cannot — its ephemeral tokens are refused on this account
(see below) — so its socket is relayed through the Worker instead, which keeps
the key private at the cost of a latency leg.

| Path | What it does |
| --- | --- |
| [functions/api/_middleware.ts](functions/api/_middleware.ts) | Same-origin **and** session-cookie gate in front of every `/api/*` route; POST-only except WebSocket upgrades |
| [functions/api/auth/](functions/api/auth/) | Trades the site password for a signed session cookie |
| [src/PasswordGate.tsx](src/PasswordGate.tsx) | The sign-in screen. Cosmetic — the middleware is what actually refuses |
| [functions/api/session/openai.ts](functions/api/session/openai.ts) | Mints an OpenAI Realtime client secret (`ek_…`) |
| [functions/api/live/gemini.ts](functions/api/live/gemini.ts) | Relays the Gemini Live socket with the API key attached, to whichever surface carries the model |
| [functions/api/_vertex.ts](functions/api/_vertex.ts) | Vertex host, key pair, region and express-mode model naming |
| [functions/api/_aistudio.ts](functions/api/_aistudio.ts) | The same three facts for AI Studio, for models Vertex has no build of |
| [src/realtime/instructions.ts](src/realtime/instructions.ts) | The prompt presets, and the default the server falls back to |
| [src/realtime/settings.ts](src/realtime/settings.ts) | Which provider knobs exist, which models take them, and the sanitiser |
| [functions/api/session/_providerConfig.ts](functions/api/session/_providerConfig.ts) | Translates those settings into each provider's payload shape |
| [src/SettingsPanel.tsx](src/SettingsPanel.tsx) | The panel, rendered from the settings schema rather than written out |
| [src/realtime/openai.ts](src/realtime/openai.ts) | WebRTC session — the browser handles mic and playback |
| [src/realtime/gemini.ts](src/realtime/gemini.ts) | WebSocket session — this code handles mic and playback |
| [src/realtime/audio.ts](src/realtime/audio.ts) | 16 kHz capture and 24 kHz scheduled playback, Gemini only |
| [public/worklets/pcm-capture.js](public/worklets/pcm-capture.js) | AudioWorklet: float32 → int16, batched to ~128 ms |

## What a call can be configured with

This is a rig for comparing realtime models as language tutors, so the prompt
and the provider knobs are set per call, from the panel, and kept in
`localStorage` between calls.

**The prompt is the client's to write.** It used to be server-only, so that a
visitor could not turn a metered key into their own chatbot — the right call for
a public page, and the wrong one here, because two models cannot be compared on
a prompt nobody is allowed to vary. The password gate is what keeps strangers
off the account.

What the client still may **not** send is a model id or a language code. Those
travel as keys that the Worker looks up in [src/realtime/models.ts](src/realtime/models.ts)
and [src/realtime/languages.ts](src/realtime/languages.ts), because the model
decides which meter the key is spent against and the language reaches Whisper as
free text. A prompt decides neither.

The settings are declared once, in
[src/realtime/settings.ts](src/realtime/settings.ts), and that one table drives
the panel, the Worker's validation and the translation into each provider's
payload. Applicability is per **model**, not per provider — native audio takes
fields the half-cascade model rejects outright, and a rejected field fails the
whole call at connect. Adding a knob means adding one entry there.

Two consequences worth knowing:

- Unset is a real state. An untouched control sends no field at all, rather than
  sending the value that happens to be the provider's default today.
- Gemini gets its configuration in the socket's **opening frame**, not the query
  string — a system instruction is far too long for a URL. The Worker holds the
  upstream socket unconfigured until that frame arrives, or for three seconds,
  whichever comes first.

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
   - `OPENAI_API_KEY`
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
4. Push to `main`. Every push deploys; every PR gets a preview URL.

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

`npm run dev` alone serves the SPA but not `functions/`, so `/api/session/*` and
`/api/live/*` return 404 and no call can start. Use `dev:api` for anything
touching audio.

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
| `/api/session/openai` | mints ephemeral secrets correctly |
| `/api/live/gemini` | **working on both surfaces** — `setupComplete` through the relay on Vertex *and* AI Studio |
| `/api/live/models` | probes candidate ids with `generateContent`, the only call this key may make |
| `/api/image/generate` | **working on Vertex** — returned an image in ~16s on Flash |
| OpenAI voice conversation | **working** — confirmed from a browser on `gpt-realtime` and `gpt-realtime-mini`, and untouched by the Vertex move |
| Gemini handshake | **working** — 2.5 native audio on Vertex, 3.1 Flash Live on AI Studio |
| Gemini audio in a browser | untested; needs a mic |

### Which model ids are actually confirmed

A model id can only be confirmed by a call that connects, because nothing
earlier looks at it. Neither provider validates the model when issuing a
credential — Google's `auth_tokens` accepted four mutually exclusive spellings
of a 3.1 id, and OpenAI's `client_secrets` minted a deliberate
`gpt-realtime-no-such-model` just like the real ones. OpenAI's `/realtime/calls`
rejects a hand-rolled SDP offer before it reads the model, so that proves
nothing either.

Both OpenAI ids are confirmed by real browser calls, and the Vertex move does
not touch them.

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

### Why Gemini is proxied and OpenAI is not

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
length of a call.

OpenAI keeps the direct path: its ephemeral secrets work, so WebRTC goes
browser-to-OpenAI with no relay.

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
