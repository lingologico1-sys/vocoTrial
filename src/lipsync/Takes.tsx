import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  AudioLines,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import { loadBundledKit } from '../facekit/bundled';
import { fetchPublished, listPublished } from '../facekit/library';
import type { FaceKit } from '../facekit/kit';
import type { PublishedFace } from '../facekit/published';
import SpeakingFace from '../live/SpeakingFace';
import Diagnostics from './Diagnostics';
import { audioUrl, deleteLine, fetchLine, listLines } from './library';
import { loadPrefs, savePrefs } from './prefs';
import type { LipsyncPackage, PublishedLine } from './published';

interface OpenTake {
  pkg: LipsyncPackage;
  audio: string | null;
}

const languageName: Record<PublishedLine['language'], string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
};

function when(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function duration(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

/**
 * The durable half of /lipsync.
 *
 * Finalize has always written a complete package to R2, and list/get/delete have always
 * existed beside it. This page is intentionally just a reader for those endpoints: the
 * authoring page stays about making and judging one take, while this one answers what was
 * otherwise an invisible question after the green "Take finalized" label disappeared:
 * what did I keep, and can I still hear it?
 */
export default function Takes() {
  const remembered = useState(loadPrefs)[0];
  const [lines, setLines] = useState<PublishedLine[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openTake, setOpenTake] = useState<OpenTake | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kit, setKit] = useState<FaceKit | null>(null);
  const [faces, setFaces] = useState<PublishedFace[]>([]);
  const [faceId, setFaceId] = useState(remembered.faceId);
  const [started, setStarted] = useState(false);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrl = useRef<string | null>(null);
  const requestNumber = useRef(0);
  const audioTime = useRef(() => audioElement.current?.currentTime ?? 0).current;

  function releaseAudio() {
    if (audioObjectUrl.current) URL.revokeObjectURL(audioObjectUrl.current);
    audioObjectUrl.current = null;
  }

  useEffect(() => releaseAudio, []);

  useEffect(() => {
    loadBundledKit()
      .then((bundled) => {
        setKit(bundled);
        if (remembered.faceId) {
          fetchPublished(remembered.faceId)
            .then(setKit)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    listPublished()
      .then((found) => {
        const wearable = found.filter((face) => face.ready !== false);
        setFaces(wearable);
        setFaceId((id) => (id && !wearable.some((face) => face.id === id) ? '' : id));
      })
      .catch(() => undefined);
  }, [remembered.faceId]);

  useEffect(() => {
    savePrefs({ faceId });
  }, [faceId]);

  async function wear(id: string) {
    setFaceId(id);
    try {
      setKit(id ? await fetchPublished(id) : await loadBundledKit());
    } catch {
      // Keep the current face visible if a library item disappeared after listing.
    }
  }

  async function refresh() {
    setLoadingList(true);
    setProblem(null);
    try {
      const found = await listLines();
      setLines([...found].sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not load finalized takes.');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function open(line: PublishedLine) {
    const request = ++requestNumber.current;
    setOpeningId(line.id);
    setProblem(null);
    try {
      const found = await fetchLine(line.id);
      if (request !== requestNumber.current) return;
      releaseAudio();
      const url = found.audioBase64 ? audioUrl(found.audioBase64) : null;
      audioObjectUrl.current = url;
      setStarted(false);
      setOpenTake({ pkg: found.package, audio: url });
    } catch (error) {
      if (request === requestNumber.current) {
        setProblem(error instanceof Error ? error.message : 'Could not open that take.');
      }
    } finally {
      if (request === requestNumber.current) setOpeningId(null);
    }
  }

  async function remove(line: PublishedLine) {
    if (!window.confirm(`Delete the finalized take “${line.name}” and its audio? This cannot be undone.`)) {
      return;
    }
    setDeletingId(line.id);
    setProblem(null);
    try {
      await deleteLine(line.id);
      setLines((current) => current.filter((item) => item.id !== line.id));
      if (openTake?.pkg.id === line.id) {
        ++requestNumber.current;
        releaseAudio();
        setOpenTake(null);
        setStarted(false);
        setOpeningId(null);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not delete that take.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <BuildBadge look="workshop" />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <AudioLines size={19} className="text-slate-500" />
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">
                Lip-sync takes
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
              Every take kept with <span className="text-slate-400">Finalize this take</span>.
              Its audio, script, alignment marks, voice settings, and diagnostics stay together.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/lipsync"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200"
            >
              New take
            </a>
            <ReturnButton look="workshop" />
          </div>
        </header>

        {problem && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-950 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{problem}</span>
          </div>
        )}

        <div className="grid min-h-[32rem] gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-medium text-slate-200">Finalized</h2>
                <p className="text-xs text-slate-600">
                  {loadingList ? 'Loading…' : `${lines.length} take${lines.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loadingList}
                title="Refresh finalized takes"
                className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-900 hover:text-slate-300 disabled:cursor-wait"
              >
                <RefreshCw size={15} className={loadingList ? 'animate-spin' : ''} />
              </button>
            </div>

            {loadingList && lines.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                Loading takes…
              </div>
            ) : lines.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <p className="text-sm text-slate-400">No finalized takes yet.</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Generate one on lipSync, listen to it, then choose Finalize this take.
                </p>
              </div>
            ) : (
              <div className="max-h-[70vh] divide-y divide-slate-900 overflow-y-auto">
                {lines.map((line) => {
                  const selected = openTake?.pkg.id === line.id;
                  const opening = openingId === line.id;
                  return (
                    <div
                      key={line.id}
                      className={`group flex items-stretch transition-colors ${
                        selected ? 'bg-slate-900/80' : 'hover:bg-slate-900/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void open(line)}
                        disabled={Boolean(deletingId)}
                        className="min-w-0 flex-1 px-4 py-3 text-left disabled:cursor-wait"
                      >
                        <div className="flex items-center gap-2">
                          {opening ? (
                            <Loader2 size={13} className="shrink-0 animate-spin text-slate-500" />
                          ) : (
                            <Play size={13} className="shrink-0 text-slate-600" />
                          )}
                          <span className="truncate text-sm font-medium text-slate-200">
                            {line.name}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 pl-5 font-mono text-[10px] text-slate-600">
                          <span>{when(line.createdAt)}</span>
                          <span>{languageName[line.language]}</span>
                          <span>{duration(line.durationMs)}</span>
                          {line.oovCount > 0 && (
                            <span className="text-amber-500">{line.oovCount} unknown</span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(line)}
                        disabled={Boolean(deletingId)}
                        title={`Delete ${line.name}`}
                        className="w-10 shrink-0 text-slate-700 transition-colors hover:bg-rose-950/20 hover:text-rose-400 disabled:cursor-wait"
                      >
                        {deletingId === line.id ? (
                          <Loader2 size={14} className="mx-auto animate-spin" />
                        ) : (
                          <Trash2 size={14} className="mx-auto" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-w-0 rounded-xl border border-slate-800 p-5">
            {!openTake ? (
              <div className="flex h-full min-h-72 items-center justify-center text-center">
                <div>
                  <AudioLines size={28} className="mx-auto text-slate-800" />
                  <p className="mt-3 text-sm text-slate-500">Choose a take to open it.</p>
                  <p className="mt-1 text-xs text-slate-700">
                    The full package is fetched only when you select one.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold tracking-tight text-slate-100">
                      {openTake.pkg.name}
                    </h2>
                    <p className="mt-1 text-xs text-slate-600">{when(openTake.pkg.createdAt)}</p>
                  </div>
                  {openTake.audio && (
                    <a
                      href={openTake.audio}
                      download={`${openTake.pkg.name}.mp3`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
                    >
                      <Download size={13} />
                      MP3
                    </a>
                  )}
                </div>

                <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-5">
                  <div className="w-full max-w-[300px]">
                    <SpeakingFace
                      tap={null}
                      marks={started ? openTake.pkg.marks : null}
                      audioTime={started ? audioTime : null}
                      expressions={started ? openTake.pkg.expressions : null}
                      driver="scheduled"
                      lookaheadMs={remembered.lookaheadMs}
                      kit={kit}
                      speaking={started}
                    />
                  </div>

                  {openTake.audio ? (
                    <audio
                      ref={audioElement}
                      controls
                      preload="metadata"
                      src={openTake.audio}
                      className="w-full max-w-md"
                      onPlay={() => setStarted(true)}
                      onEnded={() => setStarted(false)}
                    />
                  ) : (
                    <div className="rounded-lg border border-amber-950 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                      This package is present, but its audio object is missing.
                    </div>
                  )}

                  <label className="flex w-full max-w-md flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Preview face</span>
                    <select
                      value={faceId}
                      className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
                      onChange={(event) => void wear(event.target.value)}
                    >
                      <option value="">the deployment&rsquo;s own face</option>
                      {faces.map((face) => (
                        <option key={face.id} value={face.id}>
                          {face.name || face.id}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-slate-700">
                      The take stores audio and movement, not a face. This choice is remembered for previews.
                    </span>
                  </label>
                </div>

                <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg bg-slate-900/60 px-3 py-2.5">
                    <p className="text-slate-600">Voice</p>
                    <p className="mt-0.5 truncate text-slate-300">
                      {openTake.pkg.voiceName || openTake.pkg.voiceId}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-900/60 px-3 py-2.5">
                    <p className="text-slate-600">Language</p>
                    <p className="mt-0.5 text-slate-300">{languageName[openTake.pkg.language]}</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/60 px-3 py-2.5">
                    <p className="text-slate-600">Duration</p>
                    <p className="mt-0.5 text-slate-300">{duration(openTake.pkg.durationMs)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/60 px-3 py-2.5">
                    <p className="text-slate-600">Marks</p>
                    <p className="mt-0.5 text-slate-300">
                      {openTake.pkg.marks.length.toLocaleString()}
                      {openTake.pkg.oovCount > 0 && (
                        <span className="ml-2 text-amber-400">· {openTake.pkg.oovCount} unknown</span>
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-600">Authored line</h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900/40 px-4 py-3 text-sm leading-relaxed text-slate-300">
                    {openTake.pkg.text}
                  </p>
                </div>

                {openTake.pkg.script !== openTake.pkg.text && (
                  <details className="rounded-xl border border-slate-800 px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-400">
                      Aligner script
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-500">
                      {openTake.pkg.script}
                    </p>
                  </details>
                )}

                <Diagnostics pkg={openTake.pkg} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
