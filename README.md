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
  browser ──WS /api/live/gemini──► Worker ──WS ?key=…──► Google
     └──────── audio both ways, through Cloudflare ───────────┘
```

The one rule the whole design turns on: **the provider API keys never reach the
browser.** Anything in a JS bundle is public, and a leaked Realtime key is a
metered bill.

OpenAI lets us honour that cheaply: the Worker trades the key for a short-lived
`ek_…` secret, and audio then flows browser-to-OpenAI with no hop through
Cloudflare. Gemini cannot — its ephemeral tokens are refused on this account
(see below) — so its socket is relayed through the Worker instead, which keeps
the key private at the cost of a latency leg.

| Path | What it does |
| --- | --- |
| [functions/api/_middleware.ts](functions/api/_middleware.ts) | Same-origin gate in front of every `/api/*` route; POST-only except WebSocket upgrades |
| [functions/api/session/openai.ts](functions/api/session/openai.ts) | Mints an OpenAI Realtime client secret (`ek_…`) |
| [functions/api/live/gemini.ts](functions/api/live/gemini.ts) | Relays the Gemini Live socket to Google with the API key attached |
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
4. Push to `main`. Every push deploys; every PR gets a preview URL.

Model ids are not configuration — they live in
[src/realtime/models.ts](src/realtime/models.ts), because the picker and the
server allowlist have to agree and a var can only hold one value.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste in the two real keys
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
| `/api/session/openai` | mints ephemeral secrets correctly |
| `/api/live/gemini` | **working** — relays the Live socket; reaches `setupComplete` on both models |
| `/api/live/models` | lists the ids Google will actually accept for `bidiGenerateContent` |
| OpenAI voice conversation | **working** — confirmed from a browser on `gpt-realtime` and `gpt-realtime-mini` |
| Gemini handshake | **working** — 12/12 connections reached `setupComplete` |
| Gemini audio in a browser | untested; needs a mic |

### Which model ids are actually confirmed

A model id can only be confirmed by a call that connects, because nothing
earlier looks at it. Neither provider validates the model when issuing a
credential — Google's `auth_tokens` accepted four mutually exclusive spellings
of a 3.1 id, and OpenAI's `client_secrets` minted a deliberate
`gpt-realtime-no-such-model` just like the real ones. OpenAI's `/realtime/calls`
rejects a hand-rolled SDP offer before it reads the model, so that proves
nothing either.

Both OpenAI ids are confirmed by real browser calls. Both Gemini ids come from
Google's own catalogue via `/api/live/models` and reach `setupComplete`, so they
are confirmed too. Nothing in the picker is marked `unverified` today.

Do not guess a Gemini id. Two rounds of plausible-looking guesses were both
wrong, including `gemini-live-3.1-flash-preview`, whose word order looks right
and is not. Ask `/api/live/models` instead.

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
