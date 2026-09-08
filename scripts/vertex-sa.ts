/**
 * Does Vertex accept a service account where it used to take an express-mode key?
 *
 * WHY THIS EXISTS. The move off express mode changes three things at once — the
 * credential (an OAuth bearer token instead of `x-goog-api-key`), the model path
 * (fully qualified with a project and a location instead of a bare
 * `publishers/google/models/…`), and, for the Live socket, nothing else at all.
 * Two of those are cheap to be wrong about and one is not: _vertex.ts already
 * records that the bidi service answers a wrong region or a wrong spelling with
 * a 1007 or 1008 close whose text reads like a bad model id. So the same
 * mistake has three plausible causes and no distinguishing message.
 *
 * This settles it before nine call sites are rewritten against a guess. It is
 * also the standard _vertex.ts sets for itself: "verified by a real handshake,
 * which is the only thing that verifies a Live endpoint".
 *
 * IT IMPORTS THE REAL TOKEN MINTER from functions/api/_google-auth.ts rather
 * than signing its own JWT, for the reason probe.ts gives about prompts: a probe
 * with its own copy of the thing under test tests something nobody ships.
 *
 * THE FIRST TWO CHECKS ARE FREE. A rejected request is not billed, so the
 * credential is proved against a model id that cannot exist before anything
 * real is asked for. Only --live opens a socket, and it closes it as soon as
 * the setup is acknowledged, before a single audio frame.
 *
 *   npm run vertex:sa                     mint a token, prove it on REST
 *   npm run vertex:sa -- --live           and open the Live socket (the real question)
 *   npm run vertex:sa -- --file path.json read the key from a file instead of .dev.vars
 *
 * The key is read from GEMINI_JSON01 in .dev.vars unless --file says otherwise,
 * and nothing about it is ever printed but the account address and project.
 */

import { readFileSync } from 'node:fs';

import { accessToken, parseServiceAccount, type ServiceAccount } from '../functions/api/_google-auth';
import { MODELS, isGoogle } from '../src/realtime/models';

/** The region the Live socket is served from. See VERTEX_LOCATION in _vertex.ts. */
const LOCATION = 'us-central1';

/** A model id that cannot exist, so the call is refused before it is billed. */
const BOGUS_MODEL = 'gemini-no-such-model-probe';

const args = process.argv.slice(2);
const wantsLive = args.includes('--live');
const fileFlag = args.indexOf('--file');
const filePath = fileFlag >= 0 ? args[fileFlag + 1] : null;

function loadServiceAccount(): ServiceAccount {
  if (filePath) {
    const sa = parseServiceAccount(readFileSync(filePath, 'utf8'));
    if (!sa) throw new Error(`${filePath} is not a service-account JSON`);
    return sa;
  }

  // Relative to the working directory, not to this module: esbuild bundles this
  // into node_modules/.cache, so import.meta.url points somewhere useless. Same
  // approach scripts/probe.ts takes, and `npm run` always sets cwd to the root.
  let devVars: string;
  try {
    devVars = readFileSync('.dev.vars', 'utf8');
  } catch {
    throw new Error('No .dev.vars found. Pass --file <service-account.json> instead.');
  }

  // Values may be quoted, and a service-account JSON is one long line.
  for (const line of devVars.split(/\r?\n/)) {
    const match = /^GEMINI_JSON0?1\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[1].trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    const sa = parseServiceAccount(value);
    if (sa) return sa;
    throw new Error('GEMINI_JSON01 in .dev.vars is not a valid service-account JSON.');
  }
  throw new Error('No GEMINI_JSON01 in .dev.vars. Paste one in, or pass --file.');
}

/** Vertex names a model by project and location once express mode is left behind. */
function modelPath(sa: ServiceAccount, id: string, location = LOCATION): string {
  return `projects/${sa.project_id}/locations/${location}/publishers/google/models/${id}`;
}

function restUrl(sa: ServiceAccount, id: string, location = LOCATION): string {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/${modelPath(sa, id, location)}:generateContent`;
}

async function checkRest(sa: ServiceAccount, token: string, id: string, location: string) {
  const url = restUrl(sa, id, location);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'probe' }] }] }),
  });
  const body = await response.text();
  return { status: response.status, body: body.slice(0, 300) };
}

/**
 * The decisive one: the bidi socket, with the token in a header.
 *
 * A Worker opens this by fetching with an Upgrade header, which is why the app
 * holds the endpoint as https. Node cannot do that, so `ws` carries the same
 * handshake with the same header — identical on the wire, which is all Google
 * sees.
 */
async function checkLive(sa: ServiceAccount, token: string, id: string): Promise<number> {
  const { default: WebSocket } = await import('ws');
  const url =
    `wss://${LOCATION}-aiplatform.googleapis.com` +
    '/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

  console.log(`\n  socket  ${url}`);
  console.log(`  model   ${modelPath(sa, id)}`);

  return await new Promise<number>((resolve) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const done = (code: number) => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      resolve(code);
    };
    const timer = setTimeout(() => {
      console.log('  ✗ timed out with no setupComplete after 20s');
      done(1);
    }, 20_000);

    socket.on('open', () => {
      console.log('  · handshake accepted — the token was taken');
      socket.send(JSON.stringify({ setup: { model: modelPath(sa, id) } }));
    });

    socket.on('message', (data: Buffer) => {
      const text = data.toString('utf8');
      if (text.includes('setupComplete')) {
        clearTimeout(timer);
        console.log('  ✓ setupComplete — Vertex Live works on a service account');
        done(0);
      } else {
        console.log(`  · ${text.slice(0, 200)}`);
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timer);
      const why = reason?.toString('utf8') || '(no reason given)';
      console.log(`  ✗ closed ${code}: ${why}`);
      if (code === 1007 || code === 1008) {
        console.log('    _vertex.ts warns these read like a bad model id and usually are not.');
        console.log('    Suspect the region or the model path before the model id itself.');
      }
      done(1);
    });

    socket.on('error', (error: Error) => {
      clearTimeout(timer);
      // A 401 or 403 arrives here, before any close frame, as an HTTP error on
      // the upgrade — which is the answer we came for, not a transport fault.
      console.log(`  ✗ ${error.message}`);
      done(1);
    });
  });
}

async function main() {
  const sa = loadServiceAccount();
  console.log(`account  ${sa.client_email}`);
  console.log(`project  ${sa.project_id}`);

  console.log('\n1. Minting an access token');
  let token: string;
  try {
    token = await accessToken(sa);
    console.log(`  ✓ token minted (${token.length} chars)`);
  } catch (error) {
    console.log(`  ✗ ${(error as Error).message}`);
    process.exit(1);
  }

  console.log('\n2. REST, against a model id that cannot exist (free)');
  const bogus = await checkRest(sa, token, BOGUS_MODEL, LOCATION);
  console.log(`  ${bogus.status} ${bogus.body.replace(/\s+/g, ' ').slice(0, 180)}`);
  if (bogus.status === 404) {
    console.log('  ✓ 404 — the credential authenticated; only the fake model was refused');
  } else if (bogus.status === 401 || bogus.status === 403) {
    console.log('  ✗ the credential was refused. Check the account has roles/aiplatform.user');
    process.exit(1);
  } else {
    console.log('  ? unexpected — read the body above before trusting anything below');
  }

  const liveModel = MODELS.find((m) => isGoogle(m) && m.surface === 'vertex');
  if (!liveModel) {
    console.log('\nNo vertex-surface model in the allowlist; nothing to try on the socket.');
    return;
  }

  if (!wantsLive) {
    console.log(`\n3. Live socket — skipped. Re-run with --live to try ${liveModel.id}.`);
    return;
  }

  console.log(`\n3. Live socket, the question this script exists for`);
  const code = await checkLive(sa, token, liveModel.id);
  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
