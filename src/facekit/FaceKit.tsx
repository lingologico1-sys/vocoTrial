import { useCallback, useEffect, useMemo, useState } from 'react';
import BoxPicker from './BoxPicker';
import Filmstrip from './Filmstrip';
import { composite, dataUrlToBlob, fileToDataUrl, normalise } from './canvas';
import { generateBase, generatePatch } from './generate';
import {
  IMAGE_MODELS,
  IMAGE_RATES_READ_ON,
  defaultImageModelKey,
  findImageModel,
} from './imageModels';
import { KIT_FORMAT, newKit, patchFilename, type FaceKit as Kit } from './kit';
import { NEUTRALISE_BASE_PROMPT, SLOTS, slot, type Region, type SlotId } from './slots';
import { deleteKit, listKits, saveKit, selectKit, selectedKitId } from './store';
import { download, zip } from './zip';

/**
 * The face-kit workshop.
 *
 * A third page, reached at /facekit, whose whole job is turning one uploaded
 * portrait into the set of images the live face wears: a neutral base, six
 * mouths, and a pair of closed eyes. It exists as a page rather than a script
 * because every step of it is a judgement — where the mouth box goes, which of
 * two providers drew the better "oh", whether the seam shows — and judgements
 * want the picture in front of you.
 *
 * The rule the page is built around, stated once here and enforced in
 * canvas.ts: a generator's output is never used whole. It is cut to the box and
 * laid on the untouched base. Everything on screen respects that, including the
 * previews, so nothing you approve here can look better than what ships.
 */

type Candidate = { modelKey: string; patch: string; full: string; usd: number };

/**
 * The eye tabs say which side of the *picture*, not which of her eyes, because
 * that is what you are dragging a rectangle over.
 */
const REGION_TABS: { id: Region; label: string }[] = [
  { id: 'mouth', label: 'Mouth' },
  { id: 'eyeLeft', label: 'Left eye' },
  { id: 'eyeRight', label: 'Right eye' },
];

/**
 * The two models the page compares, and what they start as.
 *
 * Once one provider had won every slot outright, "one picker per provider"
 * stopped describing a useful comparison — the open question became which
 * *Gemini* to spend on, and the old shape could not express that. Both slots now
 * choose from the whole list, so Pro against Flash, Gemini against OpenAI, or a
 * model against itself are all sayable.
 */
const DEFAULT_A = defaultImageModelKey('gemini');
const DEFAULT_B = 'gemini-image-flash';

/**
 * The ellipsis a busy button wears, carrying the attempt number once there has
 * been more than one.
 *
 * Visible on purpose. A refused request is not billed and the waits between
 * attempts run to the better part of a minute, so a silent retry would read as
 * a hung page during something that is both free and working.
 */
function busyMark(attempt: number): string {
  return attempt > 1 ? `… ${attempt}` : '…';
}

function money(usd: number): string {
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export default function FaceKit() {
  const [kit, setKit] = useState<Kit | null>(null);
  const [saved, setSaved] = useState<Kit[]>([]);
  const [inUse, setInUse] = useState<string | null>(selectedKitId());
  const [region, setRegion] = useState<Region>('mouth');
  const [candidates, setCandidates] = useState<Partial<Record<SlotId, Candidate[]>>>({});
  /**
   * Which generations are in flight, and on which attempt.
   *
   * A number rather than a flag so a retry is visible. A refused request is not
   * billed and the waits between attempts run to the better part of a minute,
   * so without this the page would look hung during something that is both free
   * and working as intended.
   */
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [modelA, setModelA] = useState(DEFAULT_A);
  const [modelB, setModelB] = useState(DEFAULT_B);
  const [assembled, setAssembled] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listKits()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  useEffect(refresh, [refresh]);

  // Deduplicated: picking the same model in both slots should offer one button,
  // not two identical ones side by side.
  const chosen = useMemo(
    () => Array.from(new Set([modelA, modelB])),
    [modelA, modelB],
  );

  /**
   * The rest pose, composited, so the boxes can be judged against what they
   * will actually cover rather than against the portrait as uploaded.
   */
  useEffect(() => {
    if (!kit) {
      setAssembled(null);
      return;
    }
    let live = true;
    const overlays = [
      ...(kit.patches.rest ? [{ patch: kit.patches.rest, box: kit.boxes.mouth }] : []),
    ];
    composite(kit.base, overlays)
      .then((image) => {
        if (live) setAssembled(image);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kit]);

  const upload = async (file: File) => {
    setError(null);
    try {
      const normalised = await normalise(await fileToDataUrl(file));
      setKit(newKit(file.name.replace(/\.[^.]+$/, '') || 'face', normalised));
      setCandidates({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read');
    }
  };

  const mark = (key: string, attempt: number) =>
    setBusy((current) => ({ ...current, [key]: attempt }));

  const run = async (id: SlotId, modelKey: string) => {
    if (!kit) return;
    const definition = slot(id);
    const key = `${id}:${modelKey}`;
    mark(key, 1);
    setError(null);

    try {
      const result = await generatePatch({
        modelKey,
        base: kit.base,
        box: kit.boxes[definition.region],
        instruction: definition.prompt,
        onAttempt: (attempt) => mark(key, attempt),
      });

      setCandidates((current) => ({
        ...current,
        [id]: [...(current[id] ?? []), { modelKey, ...result }],
      }));
      // Spent whether or not the result is kept — a rejected generation still
      // billed, and a total that only counted the keepers would be a lie in the
      // direction that flatters the page.
      setKit((current) => (current ? { ...current, spentUsd: current.spentUsd + result.usd } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That generation failed');
    } finally {
      mark(key, 0);
    }
  };

  const neutralise = async (modelKey: string) => {
    if (!kit) return;
    const key = `base:${modelKey}`;
    mark(key, 1);
    setError(null);

    try {
      // From the upload, never from the current base. Pressing this again means
      // "try that again", not "edit the last attempt".
      const result = await generateBase(
        modelKey,
        kit.original ?? kit.base,
        NEUTRALISE_BASE_PROMPT,
        kit.boxes.mouth,
        undefined,
        (attempt) => mark(key, attempt),
      );
      // Patches cut from the old base no longer describe this face, so they go
      // with it. Keeping them would leave a mouth drawn for a jaw that moved.
      setKit((current) =>
        current
          ? { ...current, base: result.base, patches: {}, spentUsd: current.spentUsd + result.usd }
          : current,
      );
      setCandidates({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That generation failed');
    } finally {
      mark(key, 0);
    }
  };

  /**
   * How much artwork each region is already committed to.
   *
   * Derived rather than stored, so it is right for kits authored before locking
   * existed and cannot fall out of step with the thing it describes. Candidates
   * count as well as accepted patches: an unaccepted candidate was still cropped
   * to the box that was in force when it was made, and accepting it after a move
   * would misplace it exactly as a stored patch would.
   */
  const committed = useMemo(() => {
    const counts: Record<Region, number> = { mouth: 0, eyeLeft: 0, eyeRight: 0 };
    for (const entry of SLOTS) {
      if (kit?.patches[entry.id]) counts[entry.region] += 1;
      counts[entry.region] += candidates[entry.id]?.length ?? 0;
    }
    return counts;
  }, [kit, candidates]);

  /**
   * Frees a region's box by throwing away everything cut to it.
   *
   * Discarding is the point rather than a side effect. Keeping the artwork and
   * letting the box move is precisely the silent corruption the lock exists to
   * prevent, so an unlock that spared it would only move the bug behind another
   * button.
   */
  const unlock = (which: Region) => {
    const ids = SLOTS.filter((entry) => entry.region === which).map((entry) => entry.id);
    setKit((current) => {
      if (!current) return current;
      const patches = { ...current.patches };
      for (const id of ids) delete patches[id];
      return { ...current, patches };
    });
    setCandidates((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
  };

  const accept = (id: SlotId, candidate: Candidate) => {
    setKit((current) =>
      current ? { ...current, patches: { ...current.patches, [id]: candidate.patch } } : current,
    );
  };

  const store = async () => {
    if (!kit) return;
    try {
      await saveKit(kit);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That kit could not be saved');
    }
  };

  const use = async () => {
    if (!kit) return;
    await store();
    selectKit(kit.id);
    setInUse(kit.id);
  };

  /**
   * The same kit, as a folder.
   *
   * Deliberately the identical manifest the browser store holds, minus the
   * inlined images — so a kit checked into public/faces/ and a kit sitting in
   * IndexedDB are one format arriving by two routes, and the live page needs
   * one loader rather than two.
   */
  const exportKit = () => {
    if (!kit) return;
    const files = [
      { name: 'base.png', source: kit.base },
      ...SLOTS.filter((entry) => kit.patches[entry.id]).map((entry) => ({
        name: patchFilename(entry.id, entry.region),
        source: kit.patches[entry.id]!,
      })),
    ];

    const manifest = {
      format: KIT_FORMAT,
      name: kit.name,
      base: 'base.png',
      boxes: kit.boxes,
      patches: Object.fromEntries(
        SLOTS.filter((entry) => kit.patches[entry.id]).map((entry) => [
          entry.id,
          patchFilename(entry.id, entry.region),
        ]),
      ),
    };

    Promise.all(
      files.map(async (file) => ({
        name: file.name,
        data: new Uint8Array(await dataUrlToBlob(file.source).arrayBuffer()),
      })),
    )
      .then((entries) =>
        download(
          zip([
            ...entries,
            {
              name: 'manifest.json',
              data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
            },
          ]),
          `${kit.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-facekit.zip`,
        ),
      )
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'That kit could not be exported'),
      );
  };

  const anyUnverified = chosen.some((key) => findImageModel(key)?.unverified);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 px-5 py-8">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">faceKit</h1>
            <p className="text-xs text-slate-500">
              One portrait in, a mouth and a pair of eyelids out.
            </p>
          </div>
          <nav className="flex gap-4 text-xs text-slate-500">
            <a href="/livetrial" className="underline-offset-4 hover:underline">
              liveTrial →
            </a>
            <a href="/" className="underline-offset-4 hover:underline">
              comparison rig →
            </a>
          </nav>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}

        {!kit ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 py-20 text-center hover:border-slate-500">
            <span className="text-sm text-slate-300">Choose a portrait PNG</span>
            <span className="max-w-md text-xs text-slate-500">
              It is fitted to a {1024}px square without cropping, so nothing is cut off the top of
              a head. A transparent cut-out keeps its edges.
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        ) : (
          <>
            <section className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-slate-300">Regions</h2>
                  <div className="flex gap-1 rounded-lg border border-slate-800 p-0.5 text-xs">
                    {REGION_TABS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setRegion(option.id)}
                        className={`rounded-md px-2.5 py-1 ${
                          region === option.id ? 'bg-slate-800 text-slate-100' : 'text-slate-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <BoxPicker
                  base={assembled ?? kit.base}
                  boxes={kit.boxes}
                  active={region}
                  locked={committed[region] > 0}
                  onChange={(which, box) =>
                    setKit((current) =>
                      current ? { ...current, boxes: { ...current.boxes, [which]: box } } : current,
                    )
                  }
                />

                {committed[region] > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                    <p className="text-xs text-slate-400">
                      This box is fixed — {committed[region]}{' '}
                      {committed[region] === 1 ? 'image was' : 'images were'} cut to it.
                    </p>
                    <button
                      type="button"
                      onClick={() => unlock(region)}
                      className="rounded-md border border-amber-700/70 px-2 py-1 text-[11px] text-amber-300 hover:border-amber-500"
                    >
                      Unlock · discards {committed[region]}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                    Place this box now. It fixes on the first generation, because everything
                    generated afterwards is cut to it.
                  </p>
                )}

                <p className="text-xs text-slate-500">
                  The box is the mask, the crop, and where the patch lands.
                  {region === 'mouth' ? (
                    <>
                      {' '}
                      Cover the whole of the existing mouth — anything it leaves showing stays
                      showing — and leave room <em>below</em> it for a dropped jaw. Every pose is
                      cropped at this box, so one sized to the closed mouth cuts the bottom off
                      the open one.
                    </>
                  ) : (
                    <>
                      {' '}
                      Keep it <em>inside</em> the lens. A box that catches a spectacle rim invites
                      the model to redesign the glasses; one that stops short of the frame throws
                      any such damage away with the rest of the crop.
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-medium text-slate-300">In motion</h2>
                <Filmstrip kit={kit} />
                <p className="text-xs text-slate-500">
                  Drift between generations is invisible in stills and obvious here. If the face
                  crawls, regenerate the offending slot rather than shipping it.
                </p>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-sm font-medium text-slate-300">Providers</h2>
                <p className="text-xs text-slate-500">
                  Spent on this kit: <span className="tabular-nums">{money(kit.spentUsd)}</span> — a
                  floor, excluding the input image&rsquo;s own tokens. Rates read{' '}
                  {IMAGE_RATES_READ_ON}.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['A', modelA, setModelA],
                    ['B', modelB, setModelB],
                  ] as const
                ).map(([slotName, value, set]) => (
                  <label key={slotName} className="space-y-1 text-xs text-slate-500">
                    <span>{slotName}</span>
                    <select
                      value={value}
                      onChange={(event) => set(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                    >
                      {IMAGE_MODELS.map((model) => (
                        <option key={model.key} value={model.key}>
                          {model.label} — {money(model.usdPerImage)}/image
                          {model.masked ? '' : ' (no mask)'}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              {anyUnverified && (
                <p className="text-xs text-amber-400/80">
                  Marked unverified: neither the model id nor the rate has yet been confirmed by a
                  call that returned an image. Clear the flag in imageModels.ts once one has.
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {chosen.map((modelKey) => (
                  <button
                    key={modelKey}
                    type="button"
                    disabled={Boolean(busy[`base:${modelKey}`])}
                    onClick={() => void neutralise(modelKey)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  >
                    {busy[`base:${modelKey}`]
                      ? `Neutralising${busyMark(busy[`base:${modelKey}`])}`
                      : 'Neutralise base'}{' '}
                    · {findImageModel(modelKey)?.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Closes the mouth on the base itself. Worth doing first if the portrait arrived
                smiling — and it clears any patches, which were cut for the old face. Always runs
                against the portrait you uploaded, so pressing it again is another attempt rather
                than an edit of the last one.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-slate-300">Slots</h2>

              {SLOTS.map((entry) => {
                const options = candidates[entry.id] ?? [];
                const current = kit.patches[entry.id];

                return (
                  <div
                    key={entry.id}
                    className="grid gap-3 rounded-xl border border-slate-800 p-3 sm:grid-cols-[10rem_1fr]"
                  >
                    <div className="space-y-1.5">
                      <p className="text-sm text-slate-200">{entry.label}</p>
                      <p className="text-[11px] capitalize text-slate-600">{entry.region}</p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {chosen.map((modelKey) => {
                          const model = findImageModel(modelKey);
                          const key = `${entry.id}:${modelKey}`;
                          return (
                            <button
                              key={modelKey}
                              type="button"
                              disabled={Boolean(busy[key])}
                              onClick={() => void run(entry.id, modelKey)}
                              title={
                                current
                                  ? `Generate another with ${model?.label ?? modelKey}`
                                  : model?.label
                              }
                              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                            >
                              {busy[key] ? busyMark(busy[key]) : (model?.short ?? modelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-start gap-2">
                      {current && (
                        <figure className="space-y-1">
                          <img
                            src={current}
                            alt=""
                            className="h-20 rounded-md border-2 border-emerald-500 bg-slate-900"
                          />
                          <figcaption className="text-[10px] text-emerald-400">in the kit</figcaption>
                        </figure>
                      )}

                      {options.map((candidate, index) => (
                        <figure key={`${candidate.modelKey}-${index}`} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => accept(entry.id, candidate)}
                            title="Use this one"
                          >
                            <img
                              src={candidate.patch}
                              alt=""
                              className={`h-20 rounded-md border bg-slate-900 ${
                                candidate.patch === current
                                  ? 'border-emerald-500'
                                  : 'border-slate-700 hover:border-slate-400'
                              }`}
                            />
                          </button>
                          <figcaption className="text-[10px] text-slate-500">
                            {findImageModel(candidate.modelKey)?.provider ?? candidate.modelKey}
                          </figcaption>
                        </figure>
                      ))}

                      {!current && !options.length && (
                        <p className="self-center text-xs text-slate-600">
                          Nothing generated for this slot yet.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => void use()}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
              >
                Save and wear in liveTrial
              </button>
              <button
                type="button"
                onClick={() => void store()}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
              >
                Save
              </button>
              <button
                type="button"
                onClick={exportKit}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
              >
                Download folder
              </button>
              <button
                type="button"
                onClick={() => {
                  setKit(null);
                  setCandidates({});
                }}
                className="ml-auto text-xs text-slate-500 underline-offset-4 hover:underline"
              >
                start over
              </button>
            </section>
          </>
        )}

        {saved.length > 0 && (
          <section className="space-y-2 border-t border-slate-800 pt-4">
            <h2 className="text-sm font-medium text-slate-300">Saved kits</h2>
            <ul className="flex flex-wrap gap-3">
              {saved.map((entry) => (
                <li key={entry.id} className="space-y-1 text-center">
                  <button type="button" onClick={() => setKit(entry)} title="Open">
                    <img
                      src={entry.base}
                      alt=""
                      className={`h-24 w-24 rounded-lg border object-cover ${
                        entry.id === inUse ? 'border-sky-500' : 'border-slate-800 hover:border-slate-600'
                      }`}
                    />
                  </button>
                  <p className="max-w-24 truncate text-[11px] text-slate-400">{entry.name}</p>
                  <button
                    type="button"
                    onClick={() =>
                      void deleteKit(entry.id).then(() => {
                        if (entry.id === inUse) {
                          selectKit(null);
                          setInUse(null);
                        }
                        refresh();
                      })
                    }
                    className="text-[10px] text-slate-600 underline-offset-4 hover:underline"
                  >
                    delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
