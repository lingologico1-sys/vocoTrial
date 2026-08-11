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

const OPENAI_DEFAULT = defaultImageModelKey('openai');
const GEMINI_DEFAULT = defaultImageModelKey('gemini');

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
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [openAiModel, setOpenAiModel] = useState(OPENAI_DEFAULT);
  const [geminiModel, setGeminiModel] = useState(GEMINI_DEFAULT);
  const [assembled, setAssembled] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listKits()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  useEffect(refresh, [refresh]);

  const chosen = useMemo(() => [openAiModel, geminiModel], [openAiModel, geminiModel]);

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

  const mark = (key: string, value: boolean) =>
    setBusy((current) => ({ ...current, [key]: value }));

  const run = async (id: SlotId, modelKey: string) => {
    if (!kit) return;
    const definition = slot(id);
    const key = `${id}:${modelKey}`;
    mark(key, true);
    setError(null);

    try {
      const result = await generatePatch({
        modelKey,
        base: kit.base,
        box: kit.boxes[definition.region],
        instruction: definition.prompt,
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
      mark(key, false);
    }
  };

  const neutralise = async (modelKey: string) => {
    if (!kit) return;
    const key = `base:${modelKey}`;
    mark(key, true);
    setError(null);

    try {
      const result = await generateBase(
        modelKey,
        kit.base,
        NEUTRALISE_BASE_PROMPT,
        kit.boxes.mouth,
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
      mark(key, false);
    }
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
                    {(['mouth', 'eyes'] as Region[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setRegion(option)}
                        className={`rounded-md px-2.5 py-1 capitalize ${
                          region === option ? 'bg-slate-800 text-slate-100' : 'text-slate-500'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <BoxPicker
                  base={assembled ?? kit.base}
                  boxes={kit.boxes}
                  active={region}
                  onChange={(which, box) =>
                    setKit((current) =>
                      current ? { ...current, boxes: { ...current.boxes, [which]: box } } : current,
                    )
                  }
                />

                <p className="text-xs text-slate-500">
                  The box is the mask, the crop, and where the patch lands. Cover the whole of the
                  existing mouth — anything it leaves showing stays showing.
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
                    ['openai', openAiModel, setOpenAiModel],
                    ['gemini', geminiModel, setGeminiModel],
                  ] as const
                ).map(([provider, value, set]) => (
                  <label key={provider} className="space-y-1 text-xs text-slate-500">
                    <span className="capitalize">{provider}</span>
                    <select
                      value={value}
                      onChange={(event) => set(event.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                    >
                      {IMAGE_MODELS.filter((model) => model.provider === provider).map((model) => (
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
                    disabled={busy[`base:${modelKey}`]}
                    onClick={() => void neutralise(modelKey)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  >
                    {busy[`base:${modelKey}`] ? 'Neutralising…' : 'Neutralise base'} ·{' '}
                    {findImageModel(modelKey)?.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Closes the mouth on the base itself. Worth doing first if the portrait arrived
                smiling — and it clears any patches, which were cut for the old face.
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
                              disabled={busy[key]}
                              onClick={() => void run(entry.id, modelKey)}
                              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                            >
                              {busy[key] ? '…' : (model?.provider ?? modelKey)}
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
