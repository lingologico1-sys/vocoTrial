# vocoTrial

A live voice agent — you talk, the model talks back — running on Cloudflare
Pages. Two providers behind one UI: **Gemini Live** (WebSocket) and **OpenAI
Realtime** (WebRTC).

## How it fits together

```
browser ──POST /api/session/{gemini,openai}──► Pages Function ──► provider
   │                                            (holds the API key)
   │                                                 │
   │◄──────────── short-lived token ─────────────────┘
   │
   └──────── audio, direct to the provider ─────────► Gemini / OpenAI
```

The one rule the whole design turns on: **the provider API keys never reach the
browser.** Anything in a JS bundle is public, and a leaked Realtime key is a
metered bill. So the keys stay in the Worker, which exchanges them for a
credential that expires in minutes and is bound to this one agent. The audio
itself then flows browser-to-provider with no hop through Cloudflare, which is
what keeps latency at conversation speed.

| Path | What it does |
| --- | --- |
| [functions/api/_middleware.ts](functions/api/_middleware.ts) | Same-origin, POST-only gate in front of every `/api/*` route |
| [functions/api/session/openai.ts](functions/api/session/openai.ts) | Mints an OpenAI Realtime client secret (`ek_…`) |
| [functions/api/session/gemini.ts](functions/api/session/gemini.ts) | Mints a Gemini Live ephemeral auth token |
| [functions/api/session/_agent.ts](functions/api/session/_agent.ts) | The agent persona, server-side so a visitor cannot rewrite it |
| [src/realtime/openai.ts](src/realtime/openai.ts) | WebRTC session — the browser handles mic and playback |
| [src/realtime/gemini.ts](src/realtime/gemini.ts) | WebSocket session — this code handles mic and playback |
| [src/realtime/audio.ts](src/realtime/audio.ts) | 16 kHz capture and 24 kHz scheduled playback, Gemini only |
| [public/worklets/pcm-capture.js](public/worklets/pcm-capture.js) | AudioWorklet: float32 → int16, batched to ~128 ms |

## First-time deploy

Cloudflare builds and ships this repo itself, from the Git integration. Nothing
deploys from CI — [.github/workflows/ci.yml](.github/workflows/ci.yml) only
gates the build.

1. **Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git**,
   pick `lingologico1-sys/vocoTrial`.
2. Build command `npm run build`, output directory `dist`. Cloudflare reads the
   rest from [wrangler.toml](wrangler.toml).
3. **Settings → Variables and Secrets**, add two **Secrets** (encrypted, not
   plain text) to Production *and* Preview:
   - `OPENAI_API_KEY`
   - `GOOGLE_API_KEY`

   They have to go in the dashboard: because `wrangler.toml` exists, Pages takes
   plain-text vars from that file and the dashboard will only accept Secrets.
   The model ids live in the file's `[vars]` block for exactly that reason.
4. Push to `main`. Every push deploys; every PR gets a preview URL.

### Before the first real call

Check both model ids in [wrangler.toml](wrangler.toml) against current provider
docs — `OPENAI_REALTIME_MODEL` and `GEMINI_LIVE_MODEL`. These two APIs rename
models often, and a stale id fails at connect time with an opaque 400. They are
config rather than code so a bump is a dashboard edit, not a commit.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste in the two real keys
npm run dev:api                  # SPA + functions, which is what you want
```

`npm run dev` alone serves the SPA but not `functions/`, so `/api/session/*`
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
| `/api/session/openai` | working — mints against `gpt-realtime` and `gpt-realtime-mini` |
| `/api/session/gemini` | mints, but the token is refused by the Live socket — see below |
| Actual voice conversation | untested; needs a browser |

### The Gemini path is blocked on auth

The ephemeral token mints fine and then the Live WebSocket refuses it. Probed
across both API versions, both parameter names, and with and without the
`auth_tokens/` prefix:

```
?access_token=…  →  1008 "Method doesn't allow unregistered callers"
?key=…           →  1007 "API key not valid"
```

Because the socket never gets past auth, no Gemini model id can be confirmed
either — and `auth_tokens` accepts any model string, so minting proves nothing.
Every Gemini entry in [src/realtime/models.ts](src/realtime/models.ts) is
therefore marked unverified, including the 3.1 Flash Live id, which is a guess
extrapolated from Google's naming pattern.

The likely fix is to drop ephemeral tokens and proxy the WebSocket through the
Worker: `GOOGLE_API_KEY` still never reaches the browser, but audio then hops
through Cloudflare instead of going direct, which costs latency and Worker
time. That trade is a decision, not a patch, so it is left open.

## Known edges

- **Auth.** The gate in `_middleware.ts` blocks other *sites* from spending our
  keys, but an `Origin` header is trivially forged outside a browser. Before
  this is public, put a real session check there — sciptomondo's
  `functions/api/auth/` is the worked example — and rate-limit per user.
- **Gemini's ephemeral-token endpoint is on `v1alpha`.** If minting starts
  returning 404, check whether it moved to `v1beta` before suspecting the key.
- **No session resumption.** A dropped socket ends the call rather than
  reconnecting; the Live API supports resumption handles if that becomes worth
  wiring up.
