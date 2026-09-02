import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { loadBundledKit } from '../facekit/bundled';
import type { FaceKit } from '../facekit/kit';
import { audioUrl } from '../lipsync/library';
import type { LipsyncPackage } from '../lipsync/published';
import SpeakingFace from '../live/SpeakingFace';
import { MARK_LOOKAHEAD_MS } from '../live/polly';
import { fetchShared, fetchSharedFace } from './library';

/**
 * A take, for somebody who was sent a link.
 *
 * THE ONE PAGE OUTSIDE THE PASSWORD, and the only one that has to earn it. See
 * src/lipsync/shared.ts for the shape of the key and functions/api/_middleware.ts for
 * the exemption; the short version is that the token in the address bar is the whole
 * credential, it opens one take and one face, and it reaches no route that spends money.
 *
 * NO CHROME AT ALL. There is no header, no title, no controls, no way to reach the rest
 * of the app and nothing naming it — a person who was sent a clip is here to watch the
 * clip, and every widget on the screen is a thing they have to decide to ignore. The
 * face is a square because the artwork is (Face.tsx draws into a 200x200 viewBox), so
 * filling the screen means filling the smaller dimension; cropping to the larger one
 * would cut a chin or a forehead off, which is not "bigger", it is wrong.
 *
 * THE ONE TAP IS NOT A DESIGN CHOICE. Browsers refuse to start audio without a gesture,
 * and this take is nothing but audio and a mouth moving in time with it. So there is one
 * unavoidable press, drawn as large and as obvious as a single control can be, and it
 * never appears again except at the end — where it means replay.
 *
 * The face is chosen by whoever shared, not here. A package stores audio and movement,
 * not artwork, and a viewer has no library to pick from; see the note under the picker
 * on Takes.tsx.
 */
export default function Watch() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const [pkg, setPkg] = useState<LipsyncPackage | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [kit, setKit] = useState<FaceKit | null>(null);
  const [started, setStarted] = useState(false);
  const [dead, setDead] = useState(false);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const audioTime = useRef(() => audioElement.current?.currentTime ?? 0).current;

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  useEffect(() => {
    if (!token) {
      setDead(true);
      return;
    }

    let cancelled = false;

    // The bundled face first, so that a slow kit download does not hold up the take —
    // and so that a link whose face has since been deleted still has something to wear.
    void loadBundledKit()
      .then((bundled) => {
        if (!cancelled && bundled) setKit((current) => current ?? bundled);
      })
      .catch(() => undefined);

    void fetchSharedFace(token)
      .then((shared) => {
        if (!cancelled && shared) setKit(shared);
      })
      .catch(() => undefined);

    fetchShared(token)
      .then((got) => {
        if (cancelled) return;
        const url = got.audioBase64 ? audioUrl(got.audioBase64) : null;
        objectUrl.current = url;
        setAudio(url);
        setPkg(got.package);
      })
      .catch(() => {
        if (!cancelled) setDead(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * The title is the take's name and nothing else.
   *
   * Set from the package rather than from index.html, because a link pasted into a chat
   * shows whatever the tab is called, and "vocoTrial" tells the recipient nothing about
   * what they are being sent.
   */
  useEffect(() => {
    if (pkg?.name) document.title = pkg.name;
  }, [pkg]);

  function start() {
    const element = audioElement.current;
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  }

  const ready = Boolean(pkg && audio);

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <div
        className="relative"
        style={{ width: 'min(100vw, 100vh)', height: 'min(100vw, 100vh)' }}
      >
        <SpeakingFace
          tap={null}
          marks={started && pkg ? pkg.marks : null}
          audioTime={started ? audioTime : null}
          expressions={started && pkg ? pkg.expressions : null}
          driver="scheduled"
          lookaheadMs={MARK_LOOKAHEAD_MS}
          kit={kit}
          speaking={started}
        />

        {audio && (
          // Hidden rather than absent: this is what actually plays, and the controls are
          // the chrome this page exists without. The face is the interface.
          <audio
            ref={audioElement}
            preload="auto"
            src={audio}
            className="hidden"
            onPlay={() => setStarted(true)}
            onEnded={() => setStarted(false)}
          />
        )}

        {!started && (
          <button
            type="button"
            onClick={start}
            disabled={!ready}
            aria-label={dead ? 'This link is not valid' : 'Play'}
            className="absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity disabled:cursor-default"
          >
            {dead ? (
              <span className="px-8 text-center text-sm text-white/40">
                This link is no longer valid.
              </span>
            ) : (
              <span
                className={`flex h-24 w-24 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white/80 backdrop-blur transition-opacity ${
                  ready ? 'opacity-100' : 'opacity-30'
                }`}
              >
                <Play size={34} className="ml-1.5 fill-current" />
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
