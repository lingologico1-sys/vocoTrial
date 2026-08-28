/**
 * The parts of a live relay that have nothing to do with which provider is on
 * the far end.
 *
 * WHY THERE IS A SECOND RELAY AT ALL. Both providers are reached the same way
 * and for the same reason: a browser cannot hold the credential, and neither
 * API accepts one it could safely be given. Google's ephemeral tokens are
 * refused outright on this account (see gemini.ts); OpenAI's would work over
 * WebRTC and this app does not use WebRTC, because WebRTC hands back an <audio>
 * element and every instrument this project has — the face, the reveal, the gap
 * detector, the sent-bytes accounting — reads raw PCM. So both are browser to
 * Worker to provider, and the machinery in between is one piece of code.
 *
 * WHAT IS SHARED IS THE INSTRUMENTATION, WHICH IS THE EXPENSIVE HALF. The ping
 * protocol, the two pongs and what their absence means, the upstream-quiet
 * accumulator, the forwarder's reordering guard and its fast path — every one
 * of those was written against a specific failure on a specific date, and none
 * of them would have been rediscovered by writing a second relay from scratch.
 *
 * WHAT IS NOT SHARED IS EVERYTHING ABOUT THE CONVERSATION: the URL, the
 * credential, whether it rides in a header or a query string, what the opening
 * configuration frame is called and when it may be sent. Each route owns those.
 */

/**
 * How long to wait for the browser's config frame before setting up without it.
 *
 * A socket carries no request body, so instructions and settings arrive as the
 * first frame the client sends rather than in the URL — they are far too long
 * for a query string. That makes the handshake dependent on a client that knows
 * to send one, and a cached older bundle does not. Rather than hang forever
 * waiting, fall back to the defaults after this long and let the call proceed.
 */
export const CONFIG_GRACE_MS = 3_000;

/**
 * Reads a `{"ping": <number>}` frame, or reports that this is not one.
 *
 * THE ONE FRAME THE RELAY ANSWERS ITSELF. Everything else in either direction
 * is forwarded verbatim, which is what makes this cheap and what makes it
 * invisible: a call that takes nine seconds to say hello looks identical from
 * the browser whether those seconds were spent upstream or in the two extra
 * hops this proxy adds. That was an open question on 2026-08-27 and there was
 * no measurement anywhere that could close it.
 *
 * So the browser pings and the Worker pongs, and the round trip that comes back
 * is the browser-to-Worker leg on its own — the half of the detour that runs
 * over the learner's own connection. Paired with `upgradeMs` it bounds the
 * whole detour, and a bound is all that is needed here: if the two together are
 * a fifth of a second then a nine-second silence was the provider's, and no
 * amount of removing this relay would have helped.
 *
 * Deliberately not forwarded upstream. Neither API knows what a ping frame is
 * and both would be within their rights to close on one.
 */
export function readPingFrame(data: unknown): number | null {
  if (typeof data !== 'string') return null;
  /*
   * THE LENGTH TEST IS NOT AN OPTIMISATION, IT IS THE POINT. Every microphone
   * frame the browser sends is a string too, and without this, `includes` scans
   * the whole of one dozens of times a second for the entire length of a call.
   * That is this Worker's steady-state CPU, spent proving that an audio frame
   * is not a ping.
   *
   * It matters because a Worker has a CPU budget and the runtime takes the
   * isolate away when it is spent, leaving both sockets open and nothing
   * running behind them — which is exactly what a call looks like from the
   * browser when it goes deaf with no close frame. See RELAY_DEAD_PINGS.
   *
   * IT MATTERS MORE ON THE OPENAI ROUTE, not less. That protocol is chattier in
   * both directions — an event per item, per delta, per lifecycle change, where
   * Gemini sends one merged frame — so there is more traffic to not-scan.
   *
   * A ping is `{"ping":1756304400000}` and nothing else, so anything longer
   * than this is something else. Generous by a factor of three, because being
   * wrong here means never answering a ping again.
   */
  if (data.length > 64 || !data.includes('"ping"')) return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return typeof parsed.ping === 'number' ? parsed.ping : null;
  } catch {
    return null;
  }
}

/**
 * Reads a `{"config": …}` opening frame, or reports that this is not one.
 *
 * `null` means "not a config frame" and is distinct from a config frame with
 * nothing in it, which means "use the defaults" and is a perfectly ordinary
 * thing for the client to send.
 */
export function readConfigFrame(data: unknown): { config: unknown } | null {
  if (typeof data !== 'string') return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || !('config' in parsed)) return null;
    return { config: parsed.config ?? {} };
  } catch {
    return null;
  }
}

/**
 * Forwards a frame, normalising whatever the runtime handed us.
 *
 * `event.data` is not always a string or ArrayBuffer here — provider frames
 * arrive as Blobs, and `send()` turns a Blob into the literal text
 * "[object Blob]", which is what the browser received before this existed.
 *
 * Sends go through a per-direction promise chain because the Blob conversion
 * is async: forwarding without one lets a converted frame overtake a
 * synchronous one, and a live audio stream reordered by even one frame is
 * audible.
 */
export function forwarder(target: WebSocket) {
  let chain: Promise<void> = Promise.resolve();
  /**
   * How many frames are waiting on the chain.
   *
   * THE FAST PATH BELOW IS ONLY SAFE WHILE THIS IS ZERO. A frame that needs no
   * conversion can go straight out — but only if nothing is queued ahead of it,
   * or it would overtake a Blob still converting and reorder the stream, which
   * is the exact bug the chain was built to prevent.
   */
  let queued = 0;
  return (data: unknown) => {
    const plain = typeof data === 'string' || data instanceof ArrayBuffer;
    /*
     * EVERY FRAME GOING UP IS A STRING, so before this the whole async
     * machinery ran on the microphone: a promise allocated and a microtask
     * scheduled dozens of times a second, all of it to hand a string to `send`
     * unchanged. Only the provider's frames arrive as Blobs and actually need
     * converting. A Worker that spends its CPU budget is taken away mid-call
     * with its sockets left open, so this is not tidiness.
     */
    if (plain && queued === 0) {
      try {
        target.send(data as string | ArrayBuffer);
      } catch {
        // The peer went away mid-flight; the close handlers tear the pair down.
      }
      return;
    }
    queued += 1;
    chain = chain
      .then(async () => {
        const payload = plain
          ? (data as string | ArrayBuffer)
          : await new Response(data as BodyInit).arrayBuffer();
        target.send(payload);
      })
      .catch(() => {
        // The peer went away mid-flight; the close handlers tear the pair down.
      })
      .then(() => {
        queued -= 1;
      });
  };
}

/**
 * Either side closing must close the other, or the survivor leaks for the rest
 * of the request's lifetime — and a hung provider socket bills for it.
 */
export function bridgeClose(a: WebSocket, b: WebSocket): void {
  a.addEventListener('close', (event) => {
    try {
      b.close(event.code === 1006 ? 1011 : event.code, event.reason);
    } catch {
      /* already closed */
    }
  });
  a.addEventListener('error', () => {
    try {
      b.close(1011, 'peer error');
    } catch {
      /* already closed */
    }
  });
}

/**
 * Watches the upstream socket for silence, and answers the browser's pings.
 *
 * THE LEG NOTHING WAS WATCHING. The browser's ping measures browser to Worker
 * and back; `upgradeMs` measures opening a fresh connection to the provider.
 * The socket this lesson is actually carried on — Worker to provider — had no
 * instrument at all, and that is precisely where a stall would hide: on
 * 2026-08-27 a call whose worst relay sample was 23ms still put a turn's words
 * six seconds ahead of its sound, and every number on the page was clean.
 *
 * MAX SINCE THE LAST PONG, NOT QUIET RIGHT NOW. Pongs are ten seconds apart and
 * a stall that fell between two of them would be sampled away entirely, so the
 * gap is accumulated as frames arrive and read out on the next pong. The reset
 * happens there, so each sample describes its own window.
 *
 * A GAP IS NOT A FAULT. A provider says nothing while the learner talks, so
 * quiet between turns is the protocol working. Only the browser knows where the
 * turn boundaries are, so this stays a raw fact and the account it lands in
 * supplies the meaning — see onRelay in types.ts.
 *
 * Cheap on purpose: two numbers and a subtraction per frame, no parsing, no
 * Blob conversion. The forwarder stays the only thing that touches the payload.
 */
export function upstreamWatch(upgradeMs: number) {
  let lastAt = Date.now();
  let maxGapMs = 0;

  return {
    /**
     * One frame arrived from upstream.
     *
     * Stamped on arrival, before the forwarder's queue gets a say: this is
     * meant to time the provider's leg, and a frame that then waits behind a
     * Blob conversion is the relay's own cost, which `rttMs` already covers.
     */
    note(): void {
      const now = Date.now();
      const gap = now - lastAt;
      if (gap > maxGapMs) maxGapMs = gap;
      lastAt = now;
    },

    /**
     * TWO PONGS, AND THE DIFFERENCE BETWEEN THEM IS THE DIAGNOSIS.
     *
     * The queued one goes through the forwarder, so it sits behind whatever
     * provider frames are still converting. That was always the point: a pong
     * that jumped the queue would measure a path the audio never takes, and
     * would read fastest exactly when the relay was most backed up.
     *
     * It also meant the instrument died with the thing it measured. On
     * 2026-08-27 a call went deaf at about fifteen seconds and two of eleven
     * pongs came back — which proved the failure was at or before this Worker,
     * since a pong never reaches the provider, and could not say which of three
     * things it was.
     *
     * So the direct one leaves immediately, past the queue, and carries
     * everything a reader needs when nothing else survives. Direct arriving
     * without the queued one is a wedged forwarder chain; neither arriving is
     * this Worker not running at all. Nothing else tells those apart from the
     * browser.
     *
     * The gap is measured to *now* and not to the last frame, so a socket that
     * has been silent since well before this ping reports the silence it is
     * still in rather than the last one it finished. Reset after reading, so
     * the next sample describes the next window and nothing is counted twice —
     * and it rides the direct pong, because the one measurement of the upstream
     * leg must not be lost in exactly the failure that makes it worth having.
     */
    answer(ping: number, toBrowserDirect: WebSocket, toClient: (data: unknown) => void): void {
      const quiet = Date.now() - lastAt;
      try {
        toBrowserDirect.send(
          JSON.stringify({
            pong: ping,
            direct: true,
            upgradeMs,
            upstreamMaxGapMs: Math.max(maxGapMs, quiet),
          }),
        );
        maxGapMs = 0;
      } catch {
        // The browser went away mid-flight; the close handlers tear the pair down.
      }
      toClient(JSON.stringify({ pong: ping }));
    },
  };
}
