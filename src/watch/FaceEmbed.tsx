import { useEffect, useRef, useState } from 'react';
import { loadBundledKit } from '../facekit/bundled';
import { migrate, type FaceKit } from '../facekit/kit';
import { reposed, type VisemeMark } from '../live/visemeTable';
import type { ExpressionSpan } from '../lipsync/published';
import SpeakingFace from '../live/SpeakingFace';
import { MARK_LOOKAHEAD_MS } from '../live/polly';

/**
 * A speaking face with somebody else's clock.
 *
 * /watch is a whole player: it holds the token, fetches the take, owns the audio and
 * runs the mouth against its own `currentTime`. This is the mouth on its own, for a
 * page in another app that already has the audio and everything around it — LingoLecto's
 * Phono, where the passage, the questions, the dictionary, the scrub bar and the
 * keyboard are all the host's and only the face is ours.
 *
 * WHY THIS IS THE HALF WE KEEP. The alternative was handing LingoLecto the renderer —
 * SpeakingFace, Face, visemes and headMotion, some 5,400 lines of React — to port into
 * a page that has no build step. That fork would have to be re-crossed by every future
 * improvement to the mouth. Serving the renderer from here instead means a redeploy of
 * this app reaches every Phono already published, in every classroom, with nothing to
 * change at the other end. See docs/phono-embed.md for the contract.
 *
 * IT FETCHES NOTHING IT WAS NOT POINTED AT, and holds no credential. /watch carries a
 * share token because it is the thing being shared; this page is the thing being
 * embedded, and the host has already stored everything at publish time. So there is no
 * token in the address bar to leak, no /api/share/* call, and nothing a stranger loading
 * the bare path could see — an unaddressed frame is a resting face.
 *
 * NO AUDIO ELEMENT, DELIBERATELY. Two elements playing one recording is two clocks to
 * keep together and one of them audible twice. The host owns the sound, this owns the
 * picture, and clock() is the whole of what passes between them.
 */

/**
 * Who may drive this frame, and where a kit may be fetched from.
 *
 * Both directions are checked against the same list, because they are the same trust: a
 * page allowed to tell the mouth what to say is a page allowed to say what it wears.
 * localhost on any port is here for `wrangler pages dev` running alongside LingoLecto's
 * own dev server, which are on different ports by construction. That branch cannot fire
 * in production, where reaching this deployment requires a Host that Cloudflare routes
 * here, and localhost is not and cannot be one — the same argument _middleware.ts makes.
 */
const ALLOWED_HOSTS = ['lecto.lingomondo.app', 'lingoreader.lingologico1.workers.dev'];

function isAllowedOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return protocol === 'https:' && ALLOWED_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

/** The protocol version. Bumped only for a change the other side has to notice. */
const V = 1;

interface Track {
  marks: VisemeMark[];
  expressions: ExpressionSpan[];
}

export default function FaceEmbed() {
  const [track, setTrack] = useState<Track | null>(null);
  const [kit, setKit] = useState<FaceKit | null>(null);
  const [playing, setPlaying] = useState(false);

  /**
   * The host's last word about its audio, and the moment it said it.
   *
   * A ref rather than state because it is read sixty times a second by the mouth and
   * never drawn: in state it would re-render the face on every sync for no visible
   * difference.
   */
  const sync = useRef({ playing: false, time: 0, rate: 1, at: 0 });

  /**
   * Seconds into the recording, extrapolated from the last sync.
   *
   * Held in a ref so its identity never changes: SpeakingFace lists `audioTime` in an
   * effect's dependencies, so a fresh closure each render would tear down and rebuild
   * MarkMouth sixty times a second. Same arrangement, and same reason, as LipSync.tsx
   * and Watch.tsx.
   *
   * Extrapolating between syncs rather than only stepping on them is what keeps the
   * mouth smooth on a host that reports four times a second. Doing it from the wall
   * clock is safe here for exactly the reason markAt is a binary search rather than a
   * cursor: the answer is correct for any time in any order, so a sync arriving late,
   * early or out of order replaces an estimate rather than confusing a running position.
   */
  const clock = useRef(() => {
    const s = sync.current;
    if (!s.playing) return s.time;
    return s.time + ((performance.now() - s.at) / 1000) * s.rate;
  }).current;

  useEffect(() => {
    let cancelled = false;
    /** Where to answer. Set from the first message that passes the origin check. */
    let host: { window: Window; origin: string } | null = null;

    const tell = (message: Record<string, unknown>) => {
      if (host) host.window.postMessage({ v: V, ...message }, host.origin);
    };

    /**
     * The bundled face first, so a slow kit fetch does not hold up the take, and so a
     * host that sends no kit at all still has something to wear. Watch.tsx opens the
     * same way, for the same two reasons.
     */
    void loadBundledKit()
      .then((bundled) => {
        if (!cancelled && bundled) setKit((current) => current ?? bundled);
      })
      .catch(() => undefined);

    async function wear(kitUrl: unknown) {
      if (typeof kitUrl !== 'string' || !kitUrl) return;
      // Checked against the same list that may drive the frame: a URL arriving in a
      // message is not a reason to fetch from anywhere.
      let origin: string;
      try {
        origin = new URL(kitUrl).origin;
      } catch {
        return;
      }
      if (!isAllowedOrigin(origin)) {
        tell({ type: 'error', reason: 'kit_origin' });
        return;
      }
      try {
        const response = await fetch(kitUrl);
        if (!response.ok) throw new Error(String(response.status));
        const raw = (await response.json()) as FaceKit;
        // `migrate` for the reason fetchSharedFace calls it: a kit saved under an older
        // format is brought forward here rather than left to draw wrong.
        if (!cancelled) setKit(migrate(raw));
      } catch {
        // A kit that will not load leaves the bundled face in place, which is a better
        // answer than a black square — share/face.ts settles the same question the same
        // way, and says so.
        tell({ type: 'error', reason: 'kit_fetch' });
      }
    }

    function onMessage(event: MessageEvent) {
      if (!isAllowedOrigin(event.origin)) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.v !== V) return;

      if (!host && event.source) {
        host = { window: event.source as Window, origin: event.origin };
      }

      if (data.type === 'track') {
        // `reposed` for the reason fetchShared calls it, and this is the whole point of
        // serving the renderer from here. A package baked before `s` and `t` collapsed
        // into `st` is carrying the old answer; running it through the current table on
        // the way in is what lets an already-published lesson pick up the new one
        // without anybody rebaking a library. The host stores these marks verbatim and
        // never looks inside them, so this is the only place that opinion can be applied.
        //
        // A track with no usable marks is refused rather than accepted as an empty one.
        // Both draw a still face, but only one of them says so: MarkMouth given nothing
        // rests forever, which on screen is indistinguishable from a clip of silence and
        // from a mouth that is working. A host whose marks failed to arrive needs to find
        // that out, so it is an error and the previous track stands.
        if (!Array.isArray(data.marks) || !data.marks.length) {
          tell({ type: 'error', reason: 'no_marks' });
          return;
        }
        // `expressions` is allowed to be empty — a line where nothing blinks or nods
        // legitimately has none. See ExpressionSpan in lipsync/published.ts.
        const expressions = Array.isArray(data.expressions)
          ? (data.expressions as ExpressionSpan[])
          : [];
        setTrack({ marks: reposed(data.marks as VisemeMark[]), expressions });
        void wear(data.kitUrl);
        tell({ type: 'loaded' });
        return;
      }

      if (data.type === 'clock') {
        const playingNow = data.playing === true;
        sync.current = {
          playing: playingNow,
          time: typeof data.time === 'number' && isFinite(data.time) ? data.time : 0,
          rate: typeof data.rate === 'number' && data.rate > 0 ? data.rate : 1,
          at: performance.now(),
        };
        // The only part of a sync worth a render: `speaking` gates the mouth, and a
        // paused face has to stop being asked to move. The time itself is read by the
        // animation loop straight off the ref.
        setPlaying((was) => (was === playingNow ? was : playingNow));
      }
    }

    window.addEventListener('message', onMessage);

    // The frame announces itself rather than waiting to be asked: the host cannot know
    // when this bundle finished parsing, so a handshake that starts here is what stops a
    // track sent early from being simply lost. The host re-sends on every `ready`.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ v: V, type: 'ready' }, '*');
    }

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black">
      {/*
        Square, because the artwork is — Face.tsx draws into a 200x200 viewBox — so
        filling the frame means filling its smaller dimension. Cropping to the larger one
        would cut off a chin or a forehead, which is not bigger, it is wrong. Same
        reasoning and same measurements as Watch.tsx.
      */}
      <div
        className="relative"
        style={{ width: 'min(100vw, 100vh)', height: 'min(100vw, 100vh)' }}
      >
        <SpeakingFace
          tap={null}
          driver="scheduled"
          lookaheadMs={MARK_LOOKAHEAD_MS}
          marks={track ? track.marks : null}
          expressions={track ? track.expressions : null}
          audioTime={track ? clock : null}
          kit={kit}
          speaking={playing}
        />
      </div>
    </div>
  );
}
