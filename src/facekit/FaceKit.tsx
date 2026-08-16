import { useCallback, useEffect, useMemo, useState } from 'react';
import BoxPicker from './BoxPicker';
import Diagnostics from './Diagnostics';
import Filmstrip from './Filmstrip';
import MotionPreview from './MotionPreview';
import { composite, dataUrlToBlob, fileToDataUrl, normalise, patchDivergence } from './canvas';
import { generateBase, generatePatch } from './generate';
import {
  IMAGE_MODELS,
  IMAGE_RATES_READ_ON,
  defaultImageModelKey,
  findImageModel,
} from './imageModels';
import {
  KIT_FORMAT,
  defaultBoxSize,
  defaultBrowBox,
  defaultHeadBox,
  newKit,
  patchFilename,
  resizeAbout,
  type Box,
  type FaceKit as Kit,
} from './kit';
import {
  NEUTRALISE_BASE_PROMPT,
  BROW_BOXES,
  DEFAULT_LASH_STYLE,
  LASH_STYLES,
  SLOTS,
  isBrow,
  isFreeBox,
  partnerBox,
  slot,
  type BoxId,
  type SlotId,
} from './slots';
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

/** The poses that get compared against each other. Eyes have nothing to collide with. */
const MOUTH_SLOTS = SLOTS.filter((entry) => entry.region === 'mouth');

/**
 * Below this share of visibly differing pixels, two mouths are the same drawing.
 *
 * Four percent, and the number is not delicate — the statistic it reads is
 * strongly bimodal. A pose that genuinely changed puts tens of percent of the
 * compared area over the visibility step; a generation that returned its input
 * puts a fraction of one percent there, since the only disagreement is encoding
 * noise. Anything in this range is a mouth that moved by a few pixels of lip
 * line, which is a mouth that will not read as a different shape at twelve
 * frames a second.
 */
const SAME_MOUTH = 0.04;

/** Identifies one thumbnail on the page: a slot's accepted patch, or its nth candidate. */
const twinKey = (id: SlotId, index: number | 'kept') => `${id}:${index}`;

/** "same as Rest", or "same as Rest and Neutral open (UH)". */
function sameAs(ids: SlotId[]): string {
  const labels = ids.map((id) => slot(id).label);
  const listed =
    labels.length < 2
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `same as ${listed}`;
}

/**
 * The eye tabs say which side of the *picture*, not which of her eyes, because
 * that is what you are dragging a rectangle over.
 */
const REGION_TABS: { id: BoxId; label: string }[] = [
  { id: 'mouth', label: 'Mouth' },
  { id: 'eyeLeft', label: 'Left eye' },
  { id: 'eyeRight', label: 'Right eye' },
  { id: 'browLeft', label: 'Left brow' },
  { id: 'browRight', label: 'Right brow' },
  { id: 'head', label: 'Head' },
];

/**
 * How deep a band at the foot of the head box the close view frames.
 *
 * As a fraction of the box's height, so it stays the same piece of neck on a
 * tightly cropped portrait and a loosely cropped one. This is the only part of
 * the head box that can go wrong in a way you have to look closely to see.
 */
const NECK_BAND = 0.18;

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

/**
 * A filename from whatever the kit is called.
 *
 * Falls back rather than trusting the name, because the name is now typed by
 * hand and can be blank, punctuation, or emoji — none of which makes a filename
 * anyone wants to find again.
 */
function kitSlug(name: string): string {
  const slug = name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'face';
}

function money(usd: number): string {
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export default function FaceKit() {
  const [kit, setKit] = useState<Kit | null>(null);
  const [saved, setSaved] = useState<Kit[]>([]);
  const [inUse, setInUse] = useState<string | null>(selectedKitId());
  const [region, setRegion] = useState<BoxId>('mouth');
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
  /**
   * Which mouths have come back as copies of one already in the kit.
   *
   * Keyed by `twinKey`, valued with the slots the artwork duplicates. It exists
   * because this is the one defect the page could not show you: a duplicate
   * looks *correct* in the contact sheet — a perfectly good closed mouth, drawn
   * in the right style, on the right face — and only announces itself in the
   * filmstrip, as a mouth that stops moving for a beat. Two closed poses
   * generated from an already-closed base collide almost by default, so without
   * this the failure ships quietly, which is exactly what it did.
   */
  const [twins, setTwins] = useState<Record<string, SlotId[]>>({});
  /**
   * Whether the kit holds work that has not reached the store.
   *
   * Tracked rather than compared, because comparing means diffing megabytes of
   * data URLs on every render to answer a question a boolean already knows.
   * It exists so that closing a kit can warn — a stray click used to discard an
   * afternoon and a dollar of generations with no confirmation at all.
   */
  const [dirty, setDirty] = useState(false);
  /**
   * Which boxes are still taking their size from the box across the face.
   *
   * A face is symmetric enough that sizing the left eye has just said what the
   * right eye wants too, and making that second drag by hand is a fiddly way of
   * arriving at a number the page already knows. So a size carries across — and
   * then has to stop carrying, or the answer given to the second box could never
   * be kept. Setting a box's own size is what stops it: from then on it holds
   * what it was told and its partner can be dragged freely.
   *
   * Absent means "not decided yet in this session", not "no": the answer for a
   * box nobody has touched is worked out from its size (see `defaultBoxSize`),
   * which is what lets a kit saved with two carefully placed eyes be reopened
   * without one of them being resized by a drag on the other.
   *
   * Session state rather than part of the kit, because it describes an editing
   * session and not the artwork. A kit is boxes and pictures; which of its boxes
   * were dragged in what order is nothing a face needs to animate.
   */
  const [following, setFollowing] = useState<Partial<Record<BoxId, boolean>>>({});

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

  /**
   * Compares every mouth on the page against every mouth in the kit.
   *
   * Against the *accepted* ones only, in that direction, because the question
   * being answered is "would keeping this leave me with two of the same
   * drawing" — a pair of candidates that resemble each other is not a problem
   * until one of them is chosen, and by then it is this comparison again.
   *
   * Serial rather than parallel, and guarded by `live` rather than cancelled:
   * each comparison decodes two images and walks a few thousand pixels, which
   * is cheap enough to be invisible next to a generation and not so cheap that
   * firing fifteen of them at once during a drag is free.
   */
  useEffect(() => {
    const box = kit?.boxes.mouth;
    const patches = kit?.patches;
    if (!box || !patches) {
      setTwins({});
      return;
    }

    let live = true;
    (async () => {
      const kept = MOUTH_SLOTS.map((entry) => ({ id: entry.id, patch: patches[entry.id] })).filter(
        (entry): entry is { id: SlotId; patch: string } => Boolean(entry.patch),
      );

      const pending: { key: string; id: SlotId; patch: string }[] = [];
      for (const entry of MOUTH_SLOTS) {
        const current = patches[entry.id];
        if (current) pending.push({ key: twinKey(entry.id, 'kept'), id: entry.id, patch: current });
        (candidates[entry.id] ?? []).forEach((candidate, index) =>
          pending.push({ key: twinKey(entry.id, index), id: entry.id, patch: candidate.patch }),
        );
      }

      const found: Record<string, SlotId[]> = {};
      for (const item of pending) {
        const matches: SlotId[] = [];
        for (const other of kept) {
          if (other.id === item.id) continue;
          // The cheap answer first: accepting one candidate into two slots
          // makes them the same string, and there is nothing to measure.
          if (other.patch === item.patch) {
            matches.push(other.id);
            continue;
          }
          if ((await patchDivergence(item.patch, other.patch, box)) < SAME_MOUTH) {
            matches.push(other.id);
          }
        }
        if (!live) return;
        if (matches.length) found[item.key] = matches;
      }

      if (live) setTwins(found);
    })().catch(() => undefined);

    return () => {
      live = false;
    };
  }, [kit?.patches, kit?.boxes.mouth, candidates]);

  const upload = async (file: File) => {
    setError(null);
    try {
      const normalised = await normalise(await fileToDataUrl(file));
      setKit(newKit(file.name.replace(/\.[^.]+$/, '') || 'face', normalised));
      setCandidates({});
      setFollowing({});
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read');
    }
  };

  const mark = (key: string, attempt: number) =>
    setBusy((current) => ({ ...current, [key]: attempt }));

  /** Every edit funnels through here so nothing can change the kit unnoticed. */
  const edit = (change: (current: Kit) => Kit) => {
    setDirty(true);
    setKit((current) => (current ? change(current) : current));
  };

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
        instruction: definition.prompt(kit.lashes ?? DEFAULT_LASH_STYLE),
        label: definition.label,
        onAttempt: (attempt) => mark(key, attempt),
      });

      setCandidates((current) => ({
        ...current,
        [id]: [...(current[id] ?? []), { modelKey, ...result }],
      }));
      // Spent whether or not the result is kept — a rejected generation still
      // billed, and a total that only counted the keepers would be a lie in the
      // direction that flatters the page.
      edit((current) => ({ ...current, spentUsd: current.spentUsd + result.usd }));
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
      const result = await generateBase({
        modelKey,
        base: kit.original ?? kit.base,
        instruction: NEUTRALISE_BASE_PROMPT,
        box: kit.boxes.mouth,
        label: 'Neutral base',
        onAttempt: (attempt) => mark(key, attempt),
      });
      // Patches cut from the old base no longer describe this face, so they go
      // with it. Keeping them would leave a mouth drawn for a jaw that moved.
      edit((current) => ({
        ...current,
        base: result.base,
        patches: {},
        spentUsd: current.spentUsd + result.usd,
      }));
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
    // The free boxes are counted for the same reason they are listed: so the
    // rest of the page can index by box without a special case. Their numbers
    // stay zero — nothing is ever generated into them — which is exactly right,
    // as a box holding no artwork has nothing to be corrupted by a later drag.
    const counts: Record<BoxId, number> = {
      mouth: 0,
      eyeLeft: 0,
      eyeRight: 0,
      browLeft: 0,
      browRight: 0,
      head: 0,
    };
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
  const unlock = (which: BoxId) => {
    const ids = SLOTS.filter((entry) => entry.region === which).map((entry) => entry.id);
    edit((current) => {
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

  /**
   * The opening rectangle for a free box, or null for a box that is not one.
   *
   * Null rather than a throw because the caller is a click handler in a branch
   * the type system cannot narrow: `isFreeBox` answers a question about
   * behaviour, not about which member of the union `region` is.
   */
  const placeFreeBox = (id: BoxId): Box | null => {
    if (id === 'head') return defaultHeadBox();
    if (!isBrow(id)) return null;

    // A brow placed second starts at the size of the brow placed first, at the
    // default position for its own side. The size is the part that was work —
    // finding the depth that clears the rim and still holds a lift — and doing
    // that work twice on a symmetric face is the thing worth sparing.
    const partner = partnerBox(id);
    const other = partner ? kit?.boxes[partner] : undefined;
    const box = defaultBrowBox(id);
    return other ? resizeAbout(box, other) : box;
  };

  /**
   * Whether this box's size is still the page's to choose.
   *
   * Locked boxes never are: artwork has been cut to them, and resizing one
   * behind the owner's back is the exact corruption the lock exists to prevent —
   * worse here than a stray drag, because nobody would be looking at the box
   * that moved.
   */
  const boxFollows = (id: BoxId): boolean => {
    if (committed[id] > 0) return false;
    const known = following[id];
    if (known !== undefined) return known;

    const box = kit?.boxes[id];
    if (!box) return false;
    const size = defaultBoxSize(id);
    return box.width === size.width && box.height === size.height;
  };

  /**
   * Writes a dragged box back, carrying a new size across to its partner.
   *
   * Only a *size* carries, and only when the drag changed one: moving a box
   * leaves its partner alone, because where the other eye sits is a fact about
   * the portrait and not about this box.
   *
   * Every reading of the kit here comes from the render the drag started on, and
   * that is what makes it stable. The picker installs its pointer listeners once
   * per drag, so this closure is the one they keep calling — the partner's
   * geometry and its right to follow are settled at pointer-down and cannot
   * flicker part way through a resize as the page re-renders under it.
   */
  const moveBox = (which: BoxId, box: Box) => {
    const was = kit?.boxes[which];
    const resized = was ? was.width !== box.width || was.height !== box.height : false;
    const partner = partnerBox(which);
    const other = partner ? kit?.boxes[partner] : undefined;
    const carry = resized && partner && other && boxFollows(partner) ? partner : null;

    const carried: Partial<Record<BoxId, Box>> = {};
    if (carry && other) carried[carry] = resizeAbout(other, box);

    edit((current) => ({ ...current, boxes: { ...current.boxes, [which]: box, ...carried } }));

    if (resized) {
      setFollowing((current) => ({
        ...current,
        [which]: false,
        ...(carry ? { [carry]: true } : {}),
      }));
    }
  };

  /**
   * What the motion preview's close view should frame, for the box being edited.
   *
   * Different in kind for the two free boxes, which is why the preview takes a
   * rectangle rather than working it out itself. For the brows it is the pair of
   * them, because the seam is all around each box and both want watching at
   * once. For the head it is the band of neck at the foot of the box and nothing
   * else: the crown and the temples move rigidly with the rest of the crop and
   * have no seam to show, so framing them would be a close look at the one part
   * that cannot be wrong.
   */
  const previewFocus: Box | null = (() => {
    if (!kit) return null;

    if (region === 'head') {
      const box = kit.boxes.head;
      if (!box) return null;
      const band = box.height * NECK_BAND;
      return { ...box, y: box.y + box.height - band, height: band };
    }

    const placed = BROW_BOXES.map((id) => kit.boxes[id]).filter((box): box is Box =>
      Boolean(box),
    );
    if (!placed.length) return null;

    const left = Math.min(...placed.map((box) => box.x));
    const right = Math.max(...placed.map((box) => box.x + box.width));
    const top = Math.min(...placed.map((box) => box.y));
    const bottom = Math.max(...placed.map((box) => box.y + box.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  })();

  const accept = (id: SlotId, candidate: Candidate) => {
    edit((current) => ({ ...current, patches: { ...current.patches, [id]: candidate.patch } }));
  };

  /** Everything cut from this portrait so far, accepted or merely offered. */
  const generated = useMemo(
    () => Object.values(committed).reduce((total, count) => total + count, 0),
    [committed],
  );

  /**
   * Back to the portrait as uploaded, keeping the boxes.
   *
   * The boxes stay because a restart is usually prompted by one of them being
   * wrong, and nudging a box that is nearly right beats replacing it from a
   * generic default. They unlock on their own, the lock being derived from
   * artwork that no longer exists.
   *
   * What is spent stays spent. The money left the account whatever happens to
   * the pictures, and a total that crept back to zero on a restart would be the
   * one number on this page that lies.
   */
  const restart = () => {
    if (!kit) return;
    if (!window.confirm(`Discard ${generated} generated image(s) and start again from the portrait you uploaded?`)) {
      return;
    }
    edit((current) => ({ ...current, base: current.original ?? current.base, patches: {} }));
    setCandidates({});
    setError(null);
  };

  const close = () => {
    if (dirty && !window.confirm('This kit has changes that are not saved. Close it anyway?')) {
      return;
    }
    setKit(null);
    setCandidates({});
    setFollowing({});
    setDirty(false);
  };

  const store = async () => {
    if (!kit) return;
    try {
      await saveKit(kit);
      setDirty(false);
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
    // A zip holding one image and an empty manifest is never what anyone meant
    // to ask for, and it looks like a finished kit from the outside — the file
    // arrives, it opens, and nothing says the artwork is missing.
    if (generated === 0) {
      const proceed = window.confirm(
        'This kit has no generated artwork yet — the download would contain only the base portrait. Download anyway?',
      );
      if (!proceed) return;
    }
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
      lashes: kit.lashes ?? DEFAULT_LASH_STYLE,
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
          `${kitSlug(kit.name)}-facekit.zip`,
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
            <div className="flex flex-wrap items-center gap-3">
              <input
                aria-label="Kit name"
                value={kit.name}
                onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))}
                placeholder="Untitled"
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-medium text-slate-100 placeholder:text-slate-600 hover:border-slate-800 focus:border-slate-700 focus:outline-none"
              />
              {/*
                Shown rather than inferred. The name is the one thing on this
                page you can change without a generation behind it, so it is
                also the easiest to change and then close without saving.
              */}
              {/*
                Three states, not two: a kit that has never reached the store is
                not the same as one saved and untouched since, and calling the
                first "saved" would be the indicator itself telling a lie.
              */}
              <span className="text-xs text-slate-500">
                {!saved.some((entry) => entry.id === kit.id)
                  ? 'not saved yet'
                  : dirty
                    ? 'unsaved changes'
                    : 'saved'}
              </span>
            </div>

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
                  onChange={moveBox}
                />

                {isFreeBox(region) ? (
                  <>
                    {kit.boxes[region] ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                        <p className="text-xs text-slate-400">
                          Free to move at any time — nothing is ever cut to this one.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            edit((current) => {
                              const boxes = { ...current.boxes };
                              delete boxes[region];
                              return { ...current, boxes };
                            })
                          }
                          className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-500"
                        >
                          {region === 'head'
                            ? 'Remove · the whole picture moves again'
                            : 'Remove · this brow stops moving'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                        <p className="text-xs text-slate-400">
                          {region === 'head'
                            ? 'No head box, so the lift moves the whole picture.'
                            : 'This brow does not move.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const box = placeFreeBox(region);
                            if (!box) return;
                            edit((current) => ({
                              ...current,
                              boxes: { ...current.boxes, [region]: box },
                            }));
                            // Handed the other brow's size, so it keeps taking
                            // it until this one is sized on its own account.
                            const partner = partnerBox(region);
                            if (partner && kit.boxes[partner]) {
                              setFollowing((current) => ({ ...current, [region]: true }));
                            }
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            region === 'head'
                              ? 'border-rose-700/70 text-rose-300 hover:border-rose-500'
                              : 'border-violet-700/70 text-violet-300 hover:border-violet-500'
                          }`}
                        >
                          Place a box for it
                        </button>
                      </div>
                    )}

                    {/*
                      Under the picker rather than in the "In motion" column,
                      because judging one of these boxes is a loop of drag,
                      watch, drag again — and a preview that lives a column away
                      from the handles is one you stop consulting after the
                      second drag.

                      The head starts wide rather than close, because the first
                      thing to check is the one the box exists for: that the
                      background has stopped moving. The seam at the neck is the
                      second question, and the Close tick is where it is asked.
                    */}
                    <MotionPreview
                      kit={kit}
                      focus={previewFocus}
                      startZoomed={region !== 'head'}
                      note={
                        region === 'head'
                          ? 'No head box is placed, so what moves here is the whole picture — which is the thing a head box exists to stop.'
                          : 'Neither brow is placed, so neither brow moves — what you can see here is the head lift, which every kit has always had.'
                      }
                    />

                    {region === 'head' ? (
                      <p className="text-xs text-slate-500">
                        Not a mask and not a crop — no generator ever sees this box, so it
                        never locks. It says which pixels are <em>the head</em>, and only those
                        get the lift and the roll; everything outside it holds still. The
                        bottom edge is the only one that is feathered, and the only one worth
                        fussing over: end it across the <em>chest or neck</em>, below the jaw,
                        somewhere the picture is smooth, because that is where the gap the
                        lift opens gets hidden. The top and sides are hard cuts, so they want
                        to be either out in plain background or hard against the edge of the
                        canvas — which is usually the honest answer, since on a portrait
                        cropped near the hair there is no inset line that clears the curls, and
                        one that does not shows as a straight edge the moment the head moves.
                        Running them to the edge means the background inside moves too: free on
                        flat white, wrong if there is a pattern you wanted held still. Leave
                        the box unplaced for artwork that is a head on nothing, where moving
                        the frame and moving the head are the same act.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Not a mask and not a crop — no generator ever sees this box, so it
                        never locks and the glasses are never at risk. Cover the brow, give it
                        plenty of plain forehead <em>above</em> (the height is the travel budget:
                        the lift is capped at a third of it), and end it on the last clear row of
                        skin <em>below</em> the brow and above the spectacle rim — that bottom row
                        is what gets stretched up to fill the gap the brow leaves. There is one
                        box per brow because a rim runs diagonally, so the row that is clear on
                        one side is already frame on the other. Where a rim or a fringe leaves no
                        clear row at all, leave the box unplaced. The second brow is placed at the
                        size of the first and keeps following it, so only its <em>position</em>
                        needs the diagonal thought — until you size it yourself, after which it
                        holds what you gave it.
                      </p>
                    )}
                  </>
                ) : (
                  <>
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
                          showing — and leave room <em>below</em> it for a dropped jaw. The open
                          pose takes the chin down with it, as a real jaw drop does, so the bottom
                          edge has to sit below where the chin <em>ends up</em>, not where it rests:
                          low on the chin at least, and across the neck if the portrait allows it.
                          Every pose is cropped at this box, so one sized to the closed mouth cuts
                          the bottom off the open one — and one sized to the resting chin leaves the
                          dropped chin above the original, which reads as two chins.
                        </>
                      ) : (
                        <>
                          {' '}
                          Keep it <em>inside</em> the lens. A box that catches a spectacle rim
                          invites the model to redesign the glasses; one that stops short of the
                          frame throws any such damage away with the rest of the crop. Resizing
                          one eye resizes the other to match, about its own centre and without
                          moving it — until you size that one yourself, after which it keeps
                          what you gave it.
                        </>
                      )}
                    </p>
                  </>
                )}
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

              {/*
                Above the list rather than inside the two eye rows, because one
                kit has one answer and a control drawn twice invites the reader
                to wonder whether the eyes can disagree. They cannot: both eye
                slots share a prompt, which is what keeps a blink symmetrical.
              */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 p-3">
                <span className="text-xs text-slate-400">Eyelashes on closed eyes</span>
                {LASH_STYLES.map((style) => {
                  const active = (kit.lashes ?? DEFAULT_LASH_STYLE) === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      title={style.hint}
                      onClick={() => edit((current) => ({ ...current, lashes: style.id }))}
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        active
                          ? 'border-emerald-500 text-emerald-300'
                          : 'border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {style.label}
                    </button>
                  );
                })}
                <p className="w-full text-[11px] text-slate-500">
                  {LASH_STYLES.find((style) => style.id === (kit.lashes ?? DEFAULT_LASH_STYLE))?.hint}{' '}
                  Applies to the next eye you generate — eyes already in the kit are left as they
                  are, so regenerate both if you change this.
                </p>
              </div>

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
                          {/*
                            Recovered by matching pixels rather than recorded on
                            the kit, so it is only known while this session's
                            candidates are still around. Worth having anyway: the
                            question "which one did I keep" is asked while
                            choosing, and that is exactly when the answer exists.
                          */}
                          <figcaption className="text-[10px] text-emerald-400">
                            in the kit
                            {(() => {
                              const source = options.find((option) => option.patch === current);
                              const from = source && findImageModel(source.modelKey);
                              return from ? ` · ${from.short}` : '';
                            })()}
                          </figcaption>
                          {twins[twinKey(entry.id, 'kept')] && (
                            <figcaption className="max-w-[7rem] text-[10px] text-amber-400">
                              {sameAs(twins[twinKey(entry.id, 'kept')])}
                            </figcaption>
                          )}
                        </figure>
                      )}

                      {options.map((candidate, index) => {
                        const from = findImageModel(candidate.modelKey);
                        /*
                          Named per model and numbered per repeat. The caption
                          used to print the provider, which was fine only while
                          the two slots were one provider each — put Pro against
                          Flash and every thumbnail said "gemini", which is the
                          one thing you are trying to tell apart. Pressing the
                          same button twice needs separating too, or a second
                          opinion is indistinguishable from the first.
                        */
                        const seen = options
                          .slice(0, index)
                          .filter((earlier) => earlier.modelKey === candidate.modelKey).length;
                        const name = from?.short ?? candidate.modelKey;
                        const duplicate = twins[twinKey(entry.id, index)];

                        return (
                          <figure key={`${candidate.modelKey}-${index}`} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => accept(entry.id, candidate)}
                              title={
                                duplicate
                                  ? `${sameAs(duplicate)} — accepting it would put the same drawing in two slots`
                                  : `Use this one — ${from?.label ?? candidate.modelKey}, attempt ${seen + 1}`
                              }
                            >
                              <img
                                src={candidate.patch}
                                alt=""
                                className={`h-20 rounded-md border bg-slate-900 ${
                                  candidate.patch === current
                                    ? 'border-emerald-500'
                                    : duplicate
                                      ? 'border-amber-500/70 hover:border-amber-400'
                                      : 'border-slate-700 hover:border-slate-400'
                                }`}
                              />
                            </button>
                            <figcaption className="text-[10px] text-slate-500">
                              {seen > 0 ? `${name} ${seen + 1}` : name}
                            </figcaption>
                            {duplicate && (
                              <figcaption className="max-w-[7rem] text-[10px] text-amber-400">
                                {sameAs(duplicate)}
                              </figcaption>
                            )}
                          </figure>
                        );
                      })}

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
              {generated > 0 && (
                <button
                  type="button"
                  onClick={restart}
                  title="Keeps the portrait you uploaded and the boxes you placed"
                  className="rounded-lg border border-amber-700/70 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500"
                >
                  Start again from the original · discards {generated}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                title="Returns to the upload screen. Saved kits are not affected."
                className="ml-auto text-xs text-slate-500 underline-offset-4 hover:underline"
              >
                close kit
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
                  <button
                    type="button"
                    onClick={() => {
                      setKit(entry);
                      // A kit arriving from the store has boxes but no history
                      // of how they got there, so every box goes back to being
                      // judged on its size alone.
                      setFollowing({});
                    }}
                    title="Open"
                  >
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

        {/*
          Last on the page and outside the kit branch on purpose: a run that
          failed is most worth reading after the kit it belonged to has been
          closed, and the log outlives the kit either way.
        */}
        <Diagnostics />
      </div>
    </div>
  );
}
