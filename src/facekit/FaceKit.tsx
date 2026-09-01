import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import BoxPicker from './BoxPicker';
import DiagnosticsPanel from './DiagnosticsPanel';
import Filmstrip from './Filmstrip';
import EyewearPanel, { type EyewearCandidate } from './EyewearPanel';
import MotionPreview from './MotionPreview';
import PersonaPanel from './PersonaPanel';
import { bundledId, inlineKit, loadBundledKit } from './bundled';
import {
  composite,
  dataUrlToBlob,
  featherDepth,
  fileToDataUrl,
  normalise,
  patchDivergence,
} from './canvas';
import { generateBase, generatePatch } from './generate';
import {
  CANVAS_EDGE,
  IMAGE_MODELS,
  IMAGE_RATES_READ_ON,
  BASE_MODEL_KEY,
  findImageModel,
} from './imageModels';
import {
  KIT_FORMAT,
  browHeadroom,
  chinClearance,
  defaultBoxSize,
  defaultBrowBox,
  newKit,
  patchFilename,
  resizeAbout,
  type BaseKind,
  type Box,
  type BrowBox,
  type FaceKit as Kit,
  type MeasuredBox,
  type MouthBox,
} from './kit';
import {
  NEUTRALISE_BASE_PROMPT,
  SMILE_BASE_PROMPT,
  GLASSES_FREE_PREAMBLE,
  REMOVE_GLASSES_PREAMBLE,
  REMOVE_GLASSES_PROMPT,
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
import {
  deleteFace,
  fetchLegacyOriginal,
  fetchEyewearSource,
  fetchOriginal,
  listPublished,
  publishKit,
  setReady,
} from './library';
import type { PublishedFace } from './published';
import { publishedKit, selectFace, selectedFace } from './store';
import { download, zip } from './zip';

/**
 * The face-kit workshop.
 *
 * A third page, reached at /facekit, whose whole job is turning one uploaded
 * portrait into the set of images the live face wears: a neutral base, six
 * mouths, and a pair of closed eyes. It exists as a page rather than a script
 * because every step of it is a judgement — where the mouth box goes, which of
 * the attempts drew the better "oh", whether the seam shows — and judgements
 * want the picture in front of you. It used to say "which of two providers"
 * there, back when the page offered a pair of them; the judgement outlived the
 * comparison, because two attempts on one model differ as well.
 *
 * The rule the page is built around, stated once here and enforced in
 * canvas.ts: a generator's output is never used whole. It is cut to the box and
 * laid on the untouched base. Everything on screen respects that, including the
 * previews, so nothing you approve here can look better than what ships.
 */

type Candidate = {
  modelKey: string;
  patch: string;
  full: string;
  usd: number;
  /** Which way round the turn was sent. See `imageFirst` in the component. */
  imageFirst: boolean;
  /** The sampling preset used for a Laugh attempt. Other slots leave this absent. */
  laughVariation?: LaughVariation;
  /** Tokens the provider served from cache, as reported. Gemini only. */
  cached: number;
};

/** The poses that get compared against each other. Eyes have nothing to collide with. */
const MOUTH_SLOTS = SLOTS.filter((entry) => entry.region === 'mouth');

/**
 * The whole-frame passes the Base card can draw, in the order the buttons show
 * them.
 *
 * Kept beside the region tabs rather than in the Base card because the two
 * controls answer the same question in different keys: the tabs pick which box
 * to judge, these pick which face the boxes are judged against.
 *
 * Only one of them is a rest pose now. The neutral is the face every patch is
 * cut from and composited onto; the smile is the portrait this face is listed
 * by and nothing else — see SMILE_BASE_PROMPT. They still belong on one switch,
 * because what the switch does is put a drawn frame in the picker, and both of
 * these are drawn frames.
 */
const BASE_KINDS: ReadonlyArray<{ kind: BaseKind; label: string }> = [
  { kind: 'neutral', label: 'Neutral' },
  { kind: 'smile', label: 'Smile' },
];

type LaughVariation = 'precise' | 'default' | 'varied';

type LaughVariationOption = {
  id: LaughVariation;
  label: string;
  /** Undefined deliberately preserves Vertex's current model default. */
  temperature?: number;
  hint: string;
};

/**
 * Sampling choices for Laugh only.
 *
 * Temperature changes how much the model explores; it does not resize a mouth.
 * Keeping this to three named presets makes the experiment repeatable while the
 * middle choice remains byte-for-byte compatible with the old request.
 */
const LAUGH_VARIATIONS: readonly LaughVariationOption[] = [
  {
    id: 'precise',
    label: 'Precise',
    temperature: 0.2,
    hint: 'Less variation; more likely to stay close to the source face.',
  },
  {
    id: 'default',
    label: 'Default',
    hint: 'The original Laugh generation behavior.',
  },
  {
    id: 'varied',
    label: 'Varied',
    temperature: 1,
    hint: 'More variation between attempts; inspect the whole mouth and laugh lines.',
  },
];

const laughVariationOption = (id: LaughVariation) =>
  LAUGH_VARIATIONS.find((option) => option.id === id) ?? LAUGH_VARIATIONS[1];

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

/** How far one thumbnail sits from one accepted mouth, as patchDivergence measures it. */
type Distance = { id: SlotId; share: number };

/**
 * A share as a percentage, finer near zero.
 *
 * The digit matters only at the bottom of the range, which is the whole reason
 * the number is on screen: 0.2% and 3.8% are a returned input and a real but
 * small change, and rounding both to "0%" and "4%" would hide the distinction
 * being looked for. Nothing above ten percent is a close call, so a decimal
 * there is noise in a caption with no room for it.
 */
const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

/** "same as Rest (0.2%)", or "same as Rest (0.2%) and Neutral open (UH) (1.1%)". */
function sameAs(twins: Distance[]): string {
  const labels = twins.map(({ id, share }) => `${slot(id).label} (${percent(share)})`);
  const listed =
    labels.length < 2
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `same as ${listed}`;
}

/**
 * The whole row of measurements behind the verdict, for the tooltip.
 *
 * The caption can only say which pairs fell under the threshold, and that is
 * the half of the picture that is useless when the threshold itself is what you
 * doubt — a pose flagged at 3.8% and one flagged at 0.2% read identically, and
 * so do a pose that cleared at 4.1% and one that cleared at 40%. Hovering gives
 * the distances themselves, nearest first, so the number can be argued with.
 */
const distanceNote = (near: Distance[]) =>
  near.map(({ id, share }) => `${slot(id).label} ${percent(share)}`).join(' · ');

/**
 * What the mouth box's chin line has measured, said out loud under the picker.
 *
 * Here rather than in the picker for the reason the brow's paragraph is here too:
 * that component drags rectangles, this page explains them. But this one has to
 * earn its place harder than the brow's did. A brow's line can be dragged while
 * watching the preview answer, so it teaches itself; the mouth's is spent at the
 * next generation and moves nothing on screen, so without a caption it is a
 * dashed line with no visible purpose and the natural conclusion is that it does
 * nothing.
 *
 * The warning threshold is the patch's own fade, and it is chosen because it is
 * the one bound here that is mechanical rather than anatomical. How far a jaw
 * drops is a fact about a portrait and a prompt, and no number on this page knows
 * it. How far the seam fades is arithmetic on this rectangle — so a box with less
 * clear space below the chin than its own seam needs is provably too shallow,
 * whatever the face is doing. It is a floor and it is a low one: clearing it is
 * evidence there is *some* room, never that there is enough, which the caption
 * says rather than letting a green-looking figure imply otherwise.
 */
function ChinNote({ box, locked }: { box: MouthBox; locked: boolean }) {
  const clearance = chinClearance(box);
  const fade = featherDepth(box);
  const frame = 'rounded-lg border px-3 py-2 text-xs';

  if (clearance === null) {
    return (
      <p className={`${frame} border-slate-800 bg-slate-900/40 text-slate-400`}>
        The chin line has not been placed, so nothing is assumed: every edge fades as it did
        before the line existed.{' '}
        {locked
          ? // Told plainly rather than left as advice that cannot be taken. A
            // locked box draws no line, so "drag it" would name something that is
            // not on screen — and the way back is a button with a price on it.
            'This box is fixed, so there is no line to drag: unlocking it, and re-cutting what was cut to it, is the only way to measure this one now.'
          : 'Drag the dashed line onto the bottom of the chin at rest — it is the only check on whether this box leaves room for a dropped jaw, and it is what holds the bottom fade off the chin.'}
      </p>
    );
  }

  const share = Math.round((clearance / box.height) * 100);

  if (clearance < fade) {
    return (
      <p className={`${frame} border-amber-700/70 bg-amber-950/20 text-amber-300`}>
        Only {clearance}px of clear room below the chin line, which is less than the {fade}px this
        box&rsquo;s seam fades over. The bottom edge is sitting on the resting chin: the open pose
        drops its jaw into space that is not in the box, comes back cropped above the base&rsquo;s
        own chin, and reads as two chins.{' '}
        {locked
          ? 'This box is fixed, so the poses already cut to it were cut this shallow. Unlocking and re-cutting them is what fixes it.'
          : 'Drag the bottom edge lower before generating anything — it fixes on the first one.'}
      </p>
    );
  }

  return (
    <p className={`${frame} border-slate-800 bg-slate-900/40 text-slate-400`}>
      {clearance}px clear below the chin, {share}% of the box, and the bottom seam fades over{' '}
      {Math.min(fade, clearance)}px inside that band rather than over the chin above it. That the
      figure is not zero is all this can tell you: how far a jaw actually drops is a fact about
      this portrait and this prompt, so the depth still wants judging against the picture.
    </p>
  );
}

/**
 * A paragraph of instruction, folded away until it is wanted.
 *
 * The long notes on this page are worth their length the first time a box is
 * placed and are dead weight every time after, and they were long enough
 * between the controls that the controls stopped reading as a sequence. Folded,
 * the page is a column of things to press; the prose is one click away and its
 * label says what it answers, so it can be found again without being read again.
 */
function Guidance({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-800/80">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500 hover:text-slate-400">
        <span className="text-slate-600 transition-transform group-open:rotate-90">&rsaquo;</span>
        {label}
      </summary>
      <div className="border-t border-slate-800/80 px-3 py-2 text-xs leading-relaxed text-slate-500">
        {children}
      </div>
    </details>
  );
}

/**
 * The eye tabs say which side of the *picture*, not which of her eyes, because
 * that is what you are dragging a rectangle over.
 */
/**
 * No head tab, and its absence is the point.
 *
 * There was one, and it placed a rectangle that told the face which pixels to
 * lift. That mechanism is gone — see the note on HeadMotion in live/Face.tsx —
 * because a lifted crop has to hide its bottom edge somewhere on a neck, and
 * there is nowhere on a neck to hide it. The head now moves the whole picture
 * and needs nothing said about where it ends, so the box would be a rectangle
 * you could drag that changed nothing, which is worse than no rectangle at all.
 */
const REGION_TABS: { id: BoxId; label: string }[] = [
  { id: 'mouth', label: 'Mouth' },
  { id: 'eyeLeft', label: 'Left eye' },
  { id: 'eyeRight', label: 'Right eye' },
  { id: 'browLeft', label: 'Left brow' },
  { id: 'browRight', label: 'Right brow' },
];

/**
 * The model every generation on this page runs on.
 *
 * There used to be two of these behind two dropdowns, because the page ran an
 * A/B: one picker per provider at first, then — once one family had won every
 * slot outright — two slots drawn from the same list, the open question having
 * become which *Gemini* to spend on. Both dropdowns are gone. The list is one
 * model long (see the foot of imageModels.ts for what left and why), so the
 * pair offered the same entry twice, deduplicated back to a single button, and
 * asked everyone authoring a face to make a choice that did not exist.
 *
 * Derived rather than named, so removing a model from the list stays the whole
 * of removing it. The day a second one lands, the comparison wants its two
 * pickers back rather than an arbitrary first entry — `git log` holds the shape
 * they had, and restoring them is where that work starts.
 */
const MODEL_KEY = IMAGE_MODELS[0].key;

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

/**
 * How wide a mouth box has to be before the poses cut to it read as speech.
 *
 * A generated pose is not drawn at the size of its box. The whole 1024 frame
 * goes to the model and the result is cropped back, so the mouth's share of
 * that frame is the detail the model had to spend on it — which is why this is
 * the one number a situational portrait has to watch and a headshot never did.
 * The shipped portrait's mouth is 331px because the head fills the frame.
 *
 * 120 is a floor rather than a target, and it is a judgement rather than a
 * measurement: it is roughly where the narrow shapes stop being separable. The
 * open vowels survive much further down — `aa` and `oh` are big holes and read
 * at almost any size — but `ee`, `st` and `fv` are all the same small gap with
 * different lips around it, and once that gap is a few dozen pixels the model
 * returns three pictures of the same mouth. The face goes on moving, so nothing
 * looks broken; it just stops carrying the consonants, which on a listening
 * exercise is the entire point of it being there.
 */
const MIN_SITUATION_MOUTH = 120;

/**
 * What the framing is costing the mouth, said in the only unit that decides it.
 *
 * Shown for a situational kit and not for a portrait, because a portrait cannot
 * fail this: its head fills the frame by construction. Here the author chose how
 * much room to give the person, and that choice is spent before a single pose is
 * generated — which is the reason this is a note beside the picker rather than a
 * warning on the generate button. By the time a pose comes back soft, the
 * framing is three steps upstream and has been paid for.
 */
function FramingNote({ box }: { box: MouthBox }) {
  const frame = 'rounded-lg border px-3 py-2 text-xs';
  const share = Math.round((box.width / CANVAS_EDGE) * 100);

  if (box.width < MIN_SITUATION_MOUTH) {
    return (
      <p className={`${frame} border-amber-700/70 bg-amber-950/20 text-amber-300`}>
        This mouth box is {box.width}px wide, {share}% of the frame, and under the{' '}
        {MIN_SITUATION_MOUTH}px the narrow shapes need. The open vowels will still read; ee, st
        and fv will come back as the same small gap three times, and the face will go on moving
        while it stops carrying the consonants. The fix is upstream of this box — re-frame the
        picture closer, chest-up rather than full-length, and upload it again. Widening the
        rectangle over the same face only crops in more cheek.
      </p>
    );
  }

  return (
    <p className={`${frame} border-slate-800 bg-slate-900/40 text-slate-400`}>
      {box.width}px of mouth, {share}% of the frame, against 331px on the shipped headshot. Above
      the floor, so the poses have detail to spend — though closer is still better, and the
      narrow shapes are the ones to check first on the finished kit.
    </p>
  );
}

/**
 * The authoring page, in either of the two things it authors.
 *
 * One component rather than two pages, because the flow is genuinely identical:
 * a picture arrives, five rectangles go onto a face, and eight patches come
 * back cut to them. Nothing in that sequence changes when the face happens to
 * be sitting at a desk. What changes is the guidance around it — the framing
 * rule, which a headshot cannot break and a scene can — and the one flag the
 * kit carries out.
 *
 * Forking the page would have meant two copies of a 2000-line flow kept in step
 * by hand, and every future change to a box, a slot or the publish path landing
 * in one of them. See /situationmaker, which is this with the prop set.
 */
export default function FaceKit({ situation = false }: { situation?: boolean } = {}) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [inUse, setInUse] = useState<string | null>(selectedFace());
  /**
   * Whether the open kit is finished, as it will be saved.
   *
   * Session state that mirrors one field of the library's index entry rather
   * than anything in the kit, and deliberately so: `ready` is a fact about a
   * face's place in the library, not about its artwork, and putting it on the
   * kit would mean it rode into the zip export and the bundled manifest, where
   * it would mean nothing. Set when a face is opened, false for a fresh
   * portrait, and sent with every save.
   */
  const [ready, setReadyFlag] = useState(false);
  const [region, setRegion] = useState<BoxId>('mouth');
  const [candidates, setCandidates] = useState<Partial<Record<SlotId, Candidate[]>>>({});
  /** A session-only sampling choice, applied to the next Laugh generation only. */
  const [laughVariation, setLaughVariation] = useState<LaughVariation>('default');
  const [eyewearCandidate, setEyewearCandidate] = useState<EyewearCandidate | null>(null);
  const [eyewearSourceChanged, setEyewearSourceChanged] = useState(false);
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
  /**
   * Whether the portrait is sent before the instruction rather than after.
   *
   * Read once off the query string, and deliberately not a checkbox any more.
   * It is a bench experiment rather than a setting: the base image is identical
   * across every generation on a kit and the instruction is what varies, so
   * picture-first is the only arrangement in which the expensive half of the
   * request can be a reusable prefix. Whether Vertex actually caches it is
   * reported per candidate rather than assumed, and whether it costs anything
   * in quality is what the thumbnails and the divergence percentage are for.
   *
   * Off unless asked for, which is less a default than a control: off is the
   * order every kit in this repo was generated under, and a comparison whose
   * control has quietly moved is not a comparison. Running it means generating
   * one slot *twice with this off* — that difference is what two attempts cost
   * for nothing, no generation being deterministic — and only then once with it
   * on. A third figure inside the first two says the order changed nothing; one
   * well outside them is the finding.
   *
   * The protocol above used to be printed on the page under the checkbox, which
   * put a hundred words of bench procedure in front of everyone authoring a
   * face, for something they had no reason to run. It lives here now, where the
   * people who need it are the people already reading this file.
   */
  const imageFirst = useMemo(
    () => new URLSearchParams(window.location.search).get('imagefirst') === '1',
    [],
  );
  const [assembled, setAssembled] = useState<string | null>(null);
  /**
   * Which drawn rest pose the picker is showing, when any.
   *
   * Session state, not part of the kit: it is a view, not a fact about the
   * artwork. Null is the working view — the neutral base with the rest mouth
   * composited — and either kind shows that base on its own for a look. The
   * smile is reachable only through here, never by becoming `kit.base`.
   */
  const [shownBase, setShownBase] = useState<BaseKind | null>(null);
  /**
   * How far every mouth on the page sits from every mouth in the kit.
   *
   * Keyed by `twinKey`, valued with one distance per other accepted slot,
   * nearest first. It exists because this is the one defect the page could not
   * show you: a duplicate looks *correct* in the contact sheet — a perfectly
   * good closed mouth, drawn in the right style, on the right face — and only
   * announces itself in the filmstrip, as a mouth that stops moving for a beat.
   * Two closed poses generated from an already-closed base collide almost by
   * default, so without this the failure ships quietly, which is exactly what
   * it did.
   *
   * Every distance is kept rather than only the ones under SAME_MOUTH, because
   * the verdict alone cannot be checked. Rest and M/B/P are the closest two
   * poses in the set that are *supposed* to differ, and they differ in the one
   * way this measure is least able to see — a lip line moving a few pixels on a
   * face whose lips are nearly the colour of the skin around them. Whether a
   * flag there is a real duplicate or the threshold reaching too far is a
   * question about a number, so the number is what gets stored.
   */
  const [distances, setDistances] = useState<Record<string, Distance[]>>({});

  /**
   * How far each candidate sits from the first one generated for its own slot.
   *
   * Separate from `distances`, which deliberately never measures a candidate
   * against its own slot — two mouths that are supposed to be the same pose have
   * nothing to say to each other there, and a caption reading "same as Rest" on
   * a candidate for Rest would be noise. This is the case where that comparison
   * is the entire question: run one slot twice under different conditions and
   * the number between the two attempts is the answer.
   *
   * Against the first rather than pairwise, because the first is the control.
   * Whatever was generated before you changed anything is the thing every later
   * attempt is being asked to differ from.
   */
  const [fromFirst, setFromFirst] = useState<Record<string, number>>({});
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

  /**
   * The library, which is now the only list of faces there is.
   *
   * There used to be a second one beside it — the kits this browser had
   * authored, in IndexedDB — and the two answered different questions: "what
   * can I edit" against "what can anyone else see". They are the same question
   * now. A kit reaches the bucket on its first save and is editable from any
   * browser signed in to the site, so a face this page can open and a face
   * studio can wear are one list with one entry each.
   */
  const [published, setPublished] = useState<PublishedFace[]>([]);
  const [saving, setSaving] = useState(false);
  /** Which library face is being fetched, if one is. Its id, so the strip can say so. */
  const [opening, setOpening] = useState<string | null>(null);
  /** Whether the shipped face is on its way into the library. See `seed`. */
  const [seeding, setSeeding] = useState(false);

  const refreshLibrary = useCallback(() => {
    listPublished()
      .then(setPublished)
      .catch(() => setPublished([]));
  }, []);

  useEffect(refreshLibrary, [refreshLibrary]);

  /**
   * Folds one entry into the listing, newest first.
   *
   * The entry handed back by a write is the authority — the far side just wrote
   * it — so this is what both writers do instead of re-listing to be told what
   * they already know.
   */
  const remember = useCallback((face: PublishedFace) => {
    setPublished((current) =>
      [face, ...current.filter((other) => other.id !== face.id)].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    );
  }, []);

  /**
   * Whether the shipped face has already been imported.
   *
   * By id rather than by name, because the name is editable the moment the face
   * is an ordinary library entry and somebody will rename it. `bundledId` is
   * what makes this askable without fetching the manifest first.
   */
  const seeded = published.some((face) => face.id === bundledId());

  /**
   * Puts the face checked into public/faces/ in the library, once.
   *
   * WHY THIS BUTTON EXISTS. The shipped face was the one kit with a second
   * home. Every other face lives in the bucket and nowhere else — saving is
   * publishing, and that is what makes a face something a teacher can see,
   * name, give a voice to and hand out. The shipped one lived in the repo, so
   * it appeared in pickers as a tile with no picture and no persona: /teach
   * offered it as "Default", pre-selected, and the ordinary path — write the
   * questions, press Publish — handed a class a face the teacher had never
   * looked at, speaking in whatever voice the provider felt like. Importing it
   * makes it an ordinary face, and then there is no special case anywhere.
   *
   * It is deliberately not automatic. A seed that ran on load would rewrite an
   * administrator's edits every time faceKit was opened — the id is stable, so
   * publishing replaces — which is the one thing this must never do. The button
   * only appears while the library holds no copy, and after that the face is
   * reached like any other: through the strip below.
   *
   * Shown rather than a draft. It is what /teach fell back to a moment ago, so
   * importing it should not take the deployment's only face out of the pickers
   * that were already offering it. The persona is the part that still wants an
   * administrator, and it is written where every other face's is — open it and
   * fill in the panel.
   */
  const seed = async () => {
    setError(null);
    setSeeding(true);
    try {
      const shipped = await loadBundledKit();
      if (!shipped) {
        setError('This deployment ships no face in public/faces/, so there is nothing to import.');
        return;
      }
      // `hasOriginal: false` is the truth rather than a shortcut. A bundled kit
      // carries no portrait — `base` has already been neutralised — and calling
      // it the original would make "start again from the original" a press that
      // looks like it worked and changed nothing.
      remember(await publishKit(await inlineKit(shipped), { ready: true, hasOriginal: false }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The shipped face could not be imported',
      );
    } finally {
      setSeeding(false);
    }
  };

  /**
   * Opens a library face for editing, on a browser that need not have authored it.
   *
   * Two fetches, and only one of them usually costs anything. The kit comes
   * through publishedKit, which is the same cache-checked read wearing a face
   * makes — so a browser that already wore this one pays nothing for it here.
   * The portrait comes separately because it lives separately: it is half the
   * bytes, useless to anything that only wears the face, and needed on this
   * click alone. See originalKey in published.ts.
   *
   * A face the listing says has no portrait is one saved before the originals/
   * split, and there are two of those. The ones from the window when the whole
   * authoring copy went to sources/ still have their portrait inside it, and
   * fetchLegacyOriginal is what gets it back; the ones older than that never
   * had one. Either way this edit's save writes whatever was recovered under
   * originals/, so the detour happens once per face and then stops.
   *
   * Nothing is written to this browser's store here beyond the read-through
   * cache. Opening a face to look at it leaves nothing behind that wearing it
   * would not have.
   */
  const openPublished = useCallback(
    async (face: PublishedFace) => {
      setError(null);
      setOpening(face.id);
      try {
        const kit = await publishedKit(face.id);
        if (!kit) {
          setError('That face is in the listing but its artwork is missing');
          return;
        }
        const [original, glassed] = await Promise.all([
          face.hasOriginal ? fetchOriginal(face.id) : fetchLegacyOriginal(face.id),
          face.hasEyewearSource ? fetchEyewearSource(face.id) : Promise.resolve(null),
        ]);
        setKit({ ...kit, ...(original ? { original } : {}), ...(glassed ? { glassed } : {}) });
        setReadyFlag(face.ready !== false);
        setDirty(false);
        setCandidates({});
        setEyewearCandidate(null);
        setEyewearSourceChanged(false);
        // A kit arriving from the library has boxes but no history of how they
        // got there, so every box goes back to being judged on size.
        setFollowing({});
        setShownBase(null);
        // The editor is at the top of a page whose library sits at the bottom,
        // and a click that changes only off-screen state is the complaint this
        // whole button exists to answer.
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That face could not be opened');
      } finally {
        setOpening(null);
      }
    },
    [],
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
      ...(kit.eyewear ? [{ patch: kit.eyewear.frame, box: kit.eyewear.box }] : []),
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
      setDistances({});
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

      const found: Record<string, Distance[]> = {};
      for (const item of pending) {
        const measured: Distance[] = [];
        for (const other of kept) {
          if (other.id === item.id) continue;
          // The cheap answer first: accepting one candidate into two slots
          // makes them the same string, and there is nothing to measure.
          const share =
            other.patch === item.patch ? 0 : await patchDivergence(item.patch, other.patch, box);
          measured.push({ id: other.id, share });
        }
        if (!live) return;
        if (measured.length) {
          found[item.key] = measured.sort((a, b) => a.share - b.share);
        }
      }

      if (live) setDistances(found);

      // Cheap by comparison — one measurement per extra candidate, against a
      // patch already in memory — so it rides along in the same pass rather
      // than earning an effect and a debounce of its own.
      const within: Record<string, number> = {};
      for (const entry of SLOTS) {
        const options = candidates[entry.id] ?? [];
        const first = options[0];
        if (!first) continue;
        const region = kit?.boxes[entry.region];
        if (!region) continue;
        for (let index = 1; index < options.length; index++) {
          within[twinKey(entry.id, index)] =
            options[index].patch === first.patch
              ? 0
              : await patchDivergence(options[index].patch, first.patch, region);
        }
      }
      if (live) setFromFirst(within);
    })().catch(() => undefined);

    return () => {
      live = false;
    };
  }, [kit?.patches, kit?.boxes, kit?.boxes.mouth, candidates]);

  const upload = async (file: File) => {
    setError(null);
    try {
      const normalised = await normalise(await fileToDataUrl(file));
      setKit(newKit(file.name.replace(/\.[^.]+$/, '') || 'face', normalised, situation));
      setEyewearCandidate(null);
      setEyewearSourceChanged(false);
      setCandidates({});
      setFollowing({});
      setShownBase(null);
      setDirty(false);
      // A portrait that has just arrived has no mouths at all, so there is one
      // honest answer to whether it is fit to wear.
      setReadyFlag(false);
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
    // Capture the setting before the request starts. Changing the buttons while
    // a slow generation is running must not relabel the result after it returns.
    const variation = id === 'laugh' ? laughVariationOption(laughVariation) : undefined;
    const key = `${id}:${modelKey}`;
    mark(key, 1);
    setError(null);

    try {
      // Always generated from the neutral base, even while the page is showing
      // the smile one. The mouth and eye poses are written against a closed,
      // relaxed rest pose, and a smile is a rest pose the face can wear — not
      // one the poses are measured from. A kit with no neutral base yet falls
      // back to the active base, which is the behaviour every kit had before
      // either pose could be chosen.
      const result = await generatePatch({
        modelKey,
        base: kit.bases?.neutral ?? kit.base,
        box: kit.boxes[definition.region],
        instruction: definition.prompt(kit.lashes ?? DEFAULT_LASH_STYLE, Boolean(kit.eyewear)),
        preamble: kit.eyewear ? GLASSES_FREE_PREAMBLE : undefined,
        label: definition.label,
        imageFirst,
        temperature: variation?.temperature,
        onAttempt: (attempt) => mark(key, attempt),
      });

      // The ordering is recorded on the candidate rather than read off the
      // toggle when the caption is drawn. The toggle is a live control and a
      // thumbnail outlives it: flipping the switch after a run must not relabel
      // the pictures already on screen as something they are not.
      setCandidates((current) => ({
        ...current,
        [id]: [
          ...(current[id] ?? []),
          { modelKey, imageFirst, laughVariation: variation?.id, ...result },
        ],
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

  /**
   * Runs one base pass — neutralising or smiling — over the whole frame.
   *
   * Takes no model, where it used to take one per button. The buttons were
   * rendered one per picked model, which was a choice the function underneath
   * refused to honour: generateBase throws on anything but BASE_MODEL_KEY, on
   * the argument that a base quietly drawn by the cheaper model is
   * indistinguishable from a right one until a slot laid over it looks wrong.
   * Offering a choice that would have thrown was the picker's doing, and it
   * went with the picker.
   */
  const redrawBase = async (
    instruction: string,
    kind: BaseKind,
    label: string,
    verb: string,
  ) => {
    const key = `base:${kind}`;
    if (!kit) return;
    // Only the neutral pass replaces the base every patch is cut from and
    // composited onto, so only it discards work. A smile is stored beside the
    // base and changes nothing already cut — nothing to ask about.
    const replaces = kind === 'neutral';
    if (
      replaces &&
      (generated > 0 || Boolean(kit.eyewear)) &&
      !window.confirm(
        `${verb} redraws the base, so ${generated + (kit.eyewear ? 1 : 0)} piece(s) of generated or layered artwork will be discarded. Go on?`,
      )
    ) {
      return;
    }
    mark(key, 1);
    setError(null);

    try {
      // From the upload, never from the current base. Pressing this again means
      // "try that again", not "edit the last attempt".
      const result = await generateBase({
        modelKey: BASE_MODEL_KEY,
        base:
          kind === 'smile' && kit.eyewear
            ? kit.bases?.neutral ?? kit.base
            : kit.original ?? kit.base,
        instruction,
        preamble: kind === 'smile' && kit.eyewear ? GLASSES_FREE_PREAMBLE : undefined,
        box: kit.boxes.mouth,
        label,
        imageFirst,
        onAttempt: (attempt) => mark(key, attempt),
      });
      edit((current) => {
        const bases = { ...current.bases, [kind]: result.base };
        if (replaces && current.eyewear) delete bases.smile;
        // A smile is a view, not a target: it is stored beside the base and
        // never becomes it, so the base and its patches stay put. Only the
        // neutral pass replaces the base, and with it the patches that were
        // cut from the old one.
        return replaces
          ? {
              ...current,
              base: result.base,
              bases,
              patches: {},
              eyewear: undefined,
              glassed: undefined,
              spentUsd: current.spentUsd + result.usd,
            }
          : { ...current, bases, spentUsd: current.spentUsd + result.usd };
      });
      if (replaces) {
        setCandidates({});
        setEyewearCandidate(null);
        setEyewearSourceChanged(true);
        setShownBase(null);
      } else {
        // Show the smile that was just drawn, since it changed nothing else
        // and would otherwise be invisible.
        setShownBase('smile');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That generation failed');
    } finally {
      mark(key, 0);
    }
  };

  const neutralise = () =>
    redrawBase(NEUTRALISE_BASE_PROMPT, 'neutral', 'Neutral base', 'Neutralising');

  const smile = () =>
    redrawBase(SMILE_BASE_PROMPT, 'smile', 'Smiling base', 'Adding a smile');

  const removeGlasses = async (box: Box) => {
    if (!kit) return;
    const key = 'eyewear:remove';
    const source = kit.bases?.neutral ?? kit.base;
    mark(key, 1);
    setError(null);
    try {
      const result = await generatePatch({
        modelKey: MODEL_KEY,
        base: source,
        box,
        instruction: REMOVE_GLASSES_PROMPT,
        preamble: REMOVE_GLASSES_PREAMBLE,
        label: 'Removing glasses',
        imageFirst,
        onAttempt: (attempt) => mark(key, attempt),
      });
      const bare = await composite(source, [{ patch: result.patch, box }]);
      setEyewearCandidate({ source, bare, box });
      edit((current) => ({ ...current, spentUsd: current.spentUsd + result.usd }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The glasses could not be removed');
    } finally {
      mark(key, 0);
    }
  };

  const acceptEyewear = (candidate: EyewearCandidate, frame: string) => {
    edit((current) => {
      const patches = { ...current.patches };
      delete patches.eyeLeftClosed;
      delete patches.eyeRightClosed;
      const bases = { ...current.bases, neutral: candidate.bare };
      // A smile drawn before detachment has glasses baked into it. Keeping it
      // would double the frames when thumbnails begin composing the layer.
      delete bases.smile;
      return {
        ...current,
        base: candidate.bare,
        bases,
        patches,
        eyewear: { frame, box: candidate.box },
        glassed: candidate.source,
      };
    });
    setCandidates((current) => {
      const next = { ...current };
      delete next.eyeLeftClosed;
      delete next.eyeRightClosed;
      return next;
    });
    setEyewearCandidate(null);
    setEyewearSourceChanged(true);
    setShownBase(null);
  };

  const retuneEyewear = () => {
    if (!kit?.eyewear || !kit.glassed) return;
    setEyewearCandidate({
      source: kit.glassed,
      bare: kit.bases?.neutral ?? kit.base,
      box: kit.eyewear.box,
    });
  };

  const restoreGlasses = () => {
    if (!kit?.glassed || !window.confirm('Restore the baked-in glasses and remove the detachable layer? Both closed-eye patches will be discarded.')) return;
    edit((current) => {
      if (!current.glassed) return current;
      const patches = { ...current.patches };
      delete patches.eyeLeftClosed;
      delete patches.eyeRightClosed;
      const bases = { ...current.bases, neutral: current.glassed };
      delete bases.smile;
      const boxes = { ...current.boxes };
      delete boxes.browLeft;
      delete boxes.browRight;
      return {
        ...current,
        base: current.glassed,
        bases,
        patches,
        boxes,
        eyewear: undefined,
        glassed: undefined,
      };
    });
    setEyewearCandidate(null);
    setEyewearSourceChanged(true);
  };

  /**
   * Shows one drawn rest pose in the picker, as a look rather than a change.
   *
   * The alternative to switching the base outright, now that a smile is a view
   * and not a target: nothing here touches `kit.base` or the patches. Clicking
   * the pose already shown puts the picker back on the working view.
   */
  const showBase = (kind: BaseKind) =>
    setShownBase((current) => (current === kind ? null : kind));

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
  const placeFreeBox = (id: BoxId): BrowBox | null => {
    if (!isBrow(id)) return null;

    // A brow placed second starts at the size of the brow placed first, at the
    // default position for its own side. The size is the part that was work —
    // finding the depth that clears the rim and still holds a lift — and doing
    // that work twice on a symmetric face is the thing worth sparing.
    //
    // The travel line comes across with it, and only here. It is the same
    // argument as the size and a weaker version of it: how much forehead sits
    // above a brow is very nearly the same on both sides of one portrait, whereas
    // the *rim* below is what runs diagonally and is why these are two boxes at
    // all. Copied at placement rather than kept following, because unlike a size
    // this one is cheap to correct and there is no second question about whether
    // the owner has since chosen it — a line at the wrong height is visibly at the
    // wrong height, sitting on the brow it is meant to be touching.
    const partner = partnerBox(id);
    const other = partner ? kit?.boxes[partner] : undefined;
    const box = defaultBrowBox(id);
    if (!other) return box;
    return { ...resizeAbout(box, other), headroom: browHeadroom(other) };
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
  const moveBox = (which: BoxId, box: MeasuredBox) => {
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
   * What the motion preview's close view should frame.
   *
   * The pair of brows, because the seam is all around each box and both want
   * watching at once. A rectangle passed in rather than worked out by the
   * preview, because the preview also shows the head moving and has no business
   * deciding that the brows are the interesting part of that.
   */
  const previewFocus: Box | null = (() => {
    if (!kit) return null;

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
  const artwork = generated + (kit?.eyewear ? 1 : 0);

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
    if (!window.confirm(`Discard ${artwork} generated or layered image(s) and start again from the portrait you uploaded?`)) {
      return;
    }
    edit((current) => {
      const restored = current.original ?? current.base;
      const bases = current.bases ? { ...current.bases, neutral: restored } : current.bases;
      if (current.eyewear && bases) delete bases.smile;
      const boxes = { ...current.boxes };
      if (current.eyewear) {
        delete boxes.browLeft;
        delete boxes.browRight;
      }
      return {
        ...current,
        base: restored,
        bases,
        boxes,
        patches: {},
        eyewear: undefined,
        glassed: undefined,
      };
    });
    setCandidates({});
    setEyewearCandidate(null);
    setEyewearSourceChanged(true);
    setError(null);
  };

  const close = () => {
    if (dirty && !window.confirm('This kit has changes that are not saved. Close it anyway?')) {
      return;
    }
    setKit(null);
    setCandidates({});
    setEyewearCandidate(null);
    setEyewearSourceChanged(false);
    setFollowing({});
    setDirty(false);
  };

  /**
   * Saves the open kit to the library, which is the only save there is.
   *
   * This used to be two buttons — one writing IndexedDB, one copying the result
   * to R2 — and the pair was a lie by the end: the local copy was the one that
   * could not be reached from a second machine, so calling it "saved" promised
   * something it could not keep. One button, one place, and the price of it is
   * that a save is an upload rather than a write to disk. See publishKit for
   * what that costs and what it does not re-send.
   *
   * The entry that comes back is folded into the listing rather than triggering
   * a re-fetch of it. It is the entry the far side just wrote, so it is the
   * authority — and it carries `hasOriginal`, which the *next* save reads to
   * decide whether the portrait needs to go up again. Re-listing to learn what
   * the response already said would be a request for nothing.
   */
  const save = async (): Promise<boolean> => {
    if (!kit) return false;
    setError(null);
    setSaving(true);
    try {
      const entry = published.find((face) => face.id === kit.id);
      const face = await publishKit(kit, {
        ready,
        hasOriginal: entry?.hasOriginal === true,
        hasEyewearSource: entry?.hasEyewearSource === true,
        eyewearSourceChanged,
      });
      remember(face);
      setEyewearSourceChanged(false);
      setDirty(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That kit could not be saved');
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Saves, and puts the face on in studio.
   *
   * Only on a save that worked. Pointing the live page at a face the library
   * refused would leave it wearing an id nothing can serve, which is the one
   * failure mode activeKit deliberately does not paper over.
   */
  const use = async () => {
    if (!kit) return;
    if (!(await save())) return;
    selectFace(kit.id);
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
      ...(kit.eyewear ? [{ name: 'eyewear-frame.png', source: kit.eyewear.frame }] : []),
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
      // Written only when there is one, so a folder for a face with no
      // background holds no empty key inviting someone to fill it in.
      ...(kit.persona ? { persona: kit.persona } : {}),
      ...(kit.eyewear
        ? { eyewear: { frame: 'eyewear-frame.png', box: kit.eyewear.box } }
        : {}),
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

  const modelUnverified = findImageModel(MODEL_KEY)?.unverified === true;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <BuildBadge look="workshop" />
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 px-5 pb-8 pt-12">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {situation ? 'situationMaker' : 'faceKit'}
            </h1>
            <p className="text-xs text-slate-500">
              {situation
                ? 'One person at a desk in, the same mouth and eyelids out — on a picture that holds still.'
                : 'One portrait in, a mouth and a pair of eyelids out.'}
            </p>
          </div>
          <nav className="flex items-center gap-4 text-xs text-slate-500">
            <a href="/studio" className="underline-offset-4 hover:underline">
              studio →
            </a>
            <ReturnButton look="workshop" />
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
                Three states, not two: a kit that has never reached the library
                is not the same as one saved and untouched since, and calling
                the first "saved" would be the indicator itself telling a lie.
              */}
              <span className="text-xs text-slate-500">
                {!published.some((face) => face.id === kit.id)
                  ? 'not saved yet'
                  : dirty
                    ? 'unsaved changes'
                    : 'saved to library'}
              </span>
            </div>

            {/*
              What the panel below the boxes used to open with, reduced to the
              line it always was, and carrying the two facts the dropdowns
              carried besides a choice: which model the spending goes to, and
              what it costs an image. It stays a floor and stays saying so — the
              input image's own tokens are billed separately and are not
              reported in a form worth modelling.
            */}
            <p className="text-xs text-slate-500">
              <span className="tabular-nums">{money(kit.spentUsd)}</span> spent on this kit — a
              floor, excluding the input image&rsquo;s own tokens. Every generation runs on{' '}
              {findImageModel(MODEL_KEY)?.label} at {money(findImageModel(MODEL_KEY)?.usdPerImage ?? 0)}
              /image; rates read {IMAGE_RATES_READ_ON}.
            </p>

            {modelUnverified && (
              <p className="text-xs text-amber-400/80">
                Marked unverified: neither the model id nor the rate has yet been confirmed by a
                call that returned an image. Clear the flag in imageModels.ts once one has.
              </p>
            )}

            {/*
              Shown only when it is on, which is the whole of what the page owes
              anyone about it. Off, there is nothing to say and no control to
              explain. On, a run is being generated under an ordering no other
              kit in this repo was made with, and that should not be a surprise
              when the thumbnails come back. See `imageFirst` above.
            */}
            {imageFirst && (
              <p className="text-xs text-sky-400/80">
                Picture-first ordering is on for this session, so every generation sends the
                portrait ahead of the instruction and each candidate below says so. Drop{' '}
                <code>?imagefirst=1</code> from the URL for the ordering every other kit was made
                under.
              </p>
            )}

            {/*
              The first step, at the top, where it used to be a button in a
              provider panel below the boxes. Everything under it is drawn onto
              whatever this leaves behind, and pressing it discards whatever has
              been cut already — so it belongs above the work it invalidates
              rather than beside a model dropdown.
            */}
            <div className="space-y-3 rounded-xl border border-slate-800 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-slate-300">Base</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(busy['base:neutralise'] || busy['base:smile'] || eyewearCandidate)}
                    onClick={() => void neutralise()}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  >
                    {busy['base:neutralise']
                      ? `Neutralising${busyMark(busy['base:neutralise'])}`
                      : 'Neutralise base'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy['base:neutralise'] || busy['base:smile'] || eyewearCandidate)}
                    onClick={() => void smile()}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
                  >
                    {busy['base:smile'] ? `Smiling${busyMark(busy['base:smile'])}` : 'Smile base'}
                  </button>
                </div>
              </div>

              {situation && (
                <Guidance label="How to frame a situation">
                  Chest-up, not full-length. The person can be at a desk with the room behind
                  them and the props that say who they are — that is the whole point of this
                  page — but the head still has to be a large part of the picture, because
                  every mouth pose is drawn by sending this entire frame to the model and
                  cropping the result back. A face that is a tenth of the picture gets a tenth
                  of the drawing, and the narrow shapes go first.
                  <br />
                  <br />
                  Square, and it will be made square whether or not it arrives that way: an
                  upload is fitted inside a 1024 square and centred, so a wide photograph comes
                  in letterboxed with empty bands above and below, and the head inside it ends
                  up smaller than the crop it deserved. Crop to a square before uploading.
                  <br />
                  <br />
                  Face forward, eyes open, mouth closed and neutral. Same rules as a portrait,
                  for the same reasons — every pose is drawn over the resting mouth, and a
                  three-quarter head makes a mouth box that is a rectangle over a curve.
                  <br />
                  <br />
                  The mouth box will tell you whether the framing worked, in pixels, under the
                  Regions picker below. Read it before generating anything: it is the one
                  number that cannot be fixed after the fact, because the only fix is a
                  different picture.
                </Guidance>
              )}

              <Guidance label="What the two buttons do">
                Neutralise sets the resting mouth every later pose is drawn over, and clears any
                poses cut for the old one — worth doing first if the portrait arrived smiling.
                Smile draws the same face beaming and keeps it beside the neutral one; it never
                becomes the base, and no call ever wears it. It is the picture this face is
                offered by, in the library and the face picker — the smile a conversation
                actually shows is the Smile pose below. Both run against the picture you
                uploaded, so pressing again is another attempt rather than an edit of the last
                one.
              </Guidance>
            </div>

            <EyewearPanel
              kit={kit}
              candidate={eyewearCandidate}
              busy={busy['eyewear:remove'] ?? 0}
              onGenerate={(box) => void removeGlasses(box)}
              onAccept={acceptEyewear}
              onDiscardCandidate={() => setEyewearCandidate(null)}
              onRetune={retuneEyewear}
              onRestore={restoreGlasses}
            />

            {/*
              Four cells rather than two columns, placed explicitly, so that the
              headings share a grid row and the two pictures share the next one.
              The left column carries a base toggle the right one has no
              counterpart to, and stacking that inside a column put the picker a
              row lower than the strip it exists to be compared against.
              Placement is `md:` only: in one column the cells fall back to
              source order, which is heading, picker, heading, strip.
            */}
            <section className="grid gap-x-5 gap-y-3 md:grid-cols-2">
              <div className="flex flex-col justify-end gap-2 md:col-start-1 md:row-start-1">
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

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Base shown
                  </span>
                  <div className="flex gap-1 rounded-lg border border-slate-800 p-0.5 text-xs">
                    {BASE_KINDS.map((option) => {
                      const has = Boolean(kit.bases?.[option.kind]);
                      const active = shownBase === option.kind;
                      return (
                        <button
                          key={option.kind}
                          type="button"
                          disabled={!has}
                          title={
                            has
                              ? `Show the ${option.label.toLowerCase()} base`
                              : 'Not generated yet'
                          }
                          onClick={() => showBase(option.kind)}
                          className={`rounded-md px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
                            active ? 'bg-slate-800 text-slate-100' : 'text-slate-500'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3 md:col-start-1 md:row-start-2">
                <BoxPicker
                  base={
                    shownBase
                      ? kit.bases?.[shownBase] ?? assembled ?? kit.base
                      : kit.eyewear && region !== 'mouth'
                        ? kit.bases?.neutral ?? kit.base
                      : assembled ?? kit.base
                  }
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
                          Remove · this brow stops moving
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                        <p className="text-xs text-slate-400">This brow does not move.</p>
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
                          className="rounded-md border border-violet-700/70 px-2 py-1 text-[11px] text-violet-300 hover:border-violet-500"
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
                    */}
                    <MotionPreview
                      kit={kit}
                      focus={previewFocus}
                      note="Neither brow is placed, so neither brow moves — what you can see here is the head motion, which every kit has."
                    />

                    <Guidance label="How to place a brow band">
                      Not a mask and not a crop — no generator ever sees this box, so it
                      never locks. Cover the brow, give it plenty of plain forehead{' '}
                      <em>above</em>, and end it on the last clear row of skin <em>below</em> the
                      brow{kit.eyewear ? '. The glasses are a separate layer and do not constrain this box' : ' and above the spectacle rim'} — that bottom
                      row is what gets stretched up to fill the gap the brow leaves. Then drag
                      the dashed line onto the <em>top of the brow</em>: the band above it is
                      the forehead this brow rises into, and it is what caps the travel. Take
                      the line to the bottom of the box and this brow holds still. There is one
                      box per brow because the two sides need not have the same clearance.
                      Where a fringe leaves no
                      clear row at all, leave the box unplaced. The second brow is placed at the
                      size of the first, and with its line at the same height, so only its{' '}
                      <em>position</em> needs the diagonal thought — until you size it yourself,
                      after which it holds what you gave it.
                    </Guidance>
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

                    {region === 'mouth' && (
                      <>
                        {/*
                          Framing first, because it is the earlier question and
                          the one with no way back: whether this picture gives
                          the mouth enough pixels at all, before where inside it
                          the chin sits.
                        */}
                        {situation && <FramingNote box={kit.boxes.mouth} />}
                        <ChinNote box={kit.boxes.mouth} locked={committed[region] > 0} />
                      </>
                    )}

                    <Guidance
                      label={
                        region === 'mouth' ? 'How to place the mouth box' : 'How to place an eye box'
                      }
                    >
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
                          dropped chin above the original, which reads as two chins. Then drag the
                          dashed line onto the <em>bottom of the chin at rest</em>, which is what
                          turns that instruction into a number: the band below it is the room the
                          jaw drops into, and it also holds the patch&rsquo;s bottom fade off the
                          face. Unlike a brow&rsquo;s line there is nothing to watch it do — it is
                          spent on the next generation, and this box fixes on the first.
                        </>
                      ) : (
                        <>
                          {' '}
                          {kit.eyewear ? (
                            <>
                              The working base has no glasses, so cover the whole eye and the skin
                              a closed lid needs. The detached frames are painted back over this
                              patch after it is composited.
                            </>
                          ) : (
                            <>
                              Keep it <em>inside</em> the lens. A box that catches a spectacle rim
                              invites the model to redesign the glasses; one that stops short of the
                              frame throws any such damage away with the rest of the crop.
                            </>
                          )}{' '}
                          Resizing
                          one eye resizes the other to match, about its own centre and without
                          moving it — until you size that one yourself, after which it keeps
                          what you gave it.
                        </>
                      )}
                    </Guidance>
                  </>
                )}
              </div>

              <div className="flex flex-col justify-end md:col-start-2 md:row-start-1">
                <h2 className="text-sm font-medium text-slate-300">In motion</h2>
              </div>

              <div className="space-y-3 md:col-start-2 md:row-start-2">
                <Filmstrip kit={kit} />
                <p className="text-xs text-slate-500">
                  Drift between generations is invisible in stills and obvious here. If the face
                  crawls, regenerate the offending slot rather than shipping it.
                </p>
              </div>
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
                const busyKey = `${entry.id}:${MODEL_KEY}`;
                /** Every measured distance for one thumbnail, and the subset that counts as a copy. */
                const near = (index: number | 'kept') => distances[twinKey(entry.id, index)] ?? [];
                const copies = (index: number | 'kept') =>
                  near(index).filter((other) => other.share < SAME_MOUTH);

                return (
                  <div
                    key={entry.id}
                    className="grid gap-3 rounded-xl border border-slate-800 p-3 sm:grid-cols-[10rem_1fr]"
                  >
                    <div className="space-y-1.5">
                      <p className="text-sm text-slate-200">{entry.label}</p>
                      <p className="text-[11px] capitalize text-slate-600">{entry.region}</p>
                      {/*
                        One button, where there was one per picked model. Its
                        label was the model's `short` name, which existed only
                        to tell two such buttons apart — with one model on the
                        list it read as "pro", a word for a choice nobody was
                        being offered. It says what pressing it does instead.
                      */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          type="button"
                          disabled={Boolean(busy[busyKey] || eyewearCandidate)}
                          onClick={() => void run(entry.id, MODEL_KEY)}
                          title={findImageModel(MODEL_KEY)?.label}
                          className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 disabled:opacity-40"
                        >
                          {busy[busyKey] ? busyMark(busy[busyKey]) : current ? 'Again' : 'Generate'}
                        </button>
                      </div>
                      {entry.id === 'laugh' && (
                        <div className="space-y-1.5 pt-2">
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">
                            Variation
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {LAUGH_VARIATIONS.map((option) => {
                              const active = laughVariation === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  disabled={Boolean(busy[busyKey])}
                                  onClick={() => setLaughVariation(option.id)}
                                  title={option.hint}
                                  className={`rounded-md border px-1.5 py-1 text-[10px] disabled:opacity-40 ${
                                    active
                                      ? 'border-violet-500 text-violet-300'
                                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="max-w-[9rem] text-[10px] leading-4 text-slate-500">
                            {laughVariationOption(laughVariation).hint} Applies to the next attempt.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-start gap-2">
                      {current && (
                        <figure className="space-y-1">
                          <img
                            src={current}
                            alt=""
                            title={distanceNote(near('kept'))}
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
                              const variation =
                                source?.laughVariation && laughVariationOption(source.laughVariation);
                              return `${from ? ` · ${from.short}` : ''}${
                                variation ? ` · ${variation.label.toLowerCase()}` : ''
                              }`;
                            })()}
                          </figcaption>
                          {copies('kept').length > 0 && (
                            <figcaption className="max-w-[7rem] text-[10px] text-amber-400">
                              {sameAs(copies('kept'))}
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
                        const duplicate = copies(index);
                        /*
                          The measured row goes on every candidate, not just the
                          flagged ones. A pose that cleared the threshold by a
                          hair is the same worry as one that failed it by a hair,
                          and only the tooltip can tell you which you are looking
                          at.
                        */
                        const measured = distanceNote(near(index));

                        return (
                          <figure key={`${candidate.modelKey}-${index}`} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => accept(entry.id, candidate)}
                              title={
                                duplicate.length
                                  ? `${sameAs(duplicate)} — accepting it would put the same drawing in two slots`
                                  : `Use this one — ${from?.label ?? candidate.modelKey}, attempt ${seen + 1}${
                                      measured ? `\n${measured}` : ''
                                    }`
                              }
                            >
                              <img
                                src={candidate.patch}
                                alt=""
                                className={`h-20 rounded-md border bg-slate-900 ${
                                  candidate.patch === current
                                    ? 'border-emerald-500'
                                    : duplicate.length
                                      ? 'border-amber-500/70 hover:border-amber-400'
                                      : 'border-slate-700 hover:border-slate-400'
                                }`}
                              />
                            </button>
                            <figcaption className="text-[10px] text-slate-500">
                              {seen > 0 ? `${name} ${seen + 1}` : name}
                              {candidate.imageFirst && (
                                <span className="text-sky-400/80"> · picture first</span>
                              )}
                              {candidate.laughVariation && (
                                <span className="text-violet-400/80">
                                  {' '}
                                  · {laughVariationOption(candidate.laughVariation).label.toLowerCase()}
                                </span>
                              )}
                            </figcaption>
                            {/*
                              The two numbers the comparison needs, and only on
                              the candidates that have them. Index 0 is the
                              control — there is nothing behind it to differ
                              from — and a cache count of zero on a first
                              attempt says nothing either, since there was
                              nothing cached to hit.
                            */}
                            {fromFirst[twinKey(entry.id, index)] !== undefined && (
                              <figcaption className="text-[10px] text-slate-500">
                                {percent(fromFirst[twinKey(entry.id, index)])} from the first
                                {candidate.cached > 0 && ` · ${candidate.cached} cached`}
                              </figcaption>
                            )}
                            {duplicate.length > 0 && (
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

            <PersonaPanel kit={kit} edit={edit} money={money} />

            <section className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => void use()}
                disabled={saving}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                Save and wear in studio
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                title="Writes this kit to the shared library, which is where it lives. Any browser signed in to this site can then open or wear it."
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save to library'}
              </button>
              {/*
                Next to the save buttons rather than up by the name, because it
                is read at the same moment they are pressed: this is the flag
                that decides whether the thing being saved turns up in front of
                a class, and it goes up with the save rather than separately.
              */}
              <label
                title="Ticked, this face is offered in studio's picker. Unticked it is a draft — saved and editable from any browser, but not put in front of anyone."
                className="flex items-center gap-1.5 text-sm text-slate-400"
              >
                <input
                  type="checkbox"
                  checked={ready}
                  onChange={(event) => setReadyFlag(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900"
                />
                Show in studio
              </label>
              <button
                type="button"
                onClick={exportKit}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
              >
                Download folder
              </button>
              {artwork > 0 && (
                <button
                  type="button"
                  onClick={restart}
                  title="Keeps the portrait you uploaded and the boxes you placed"
                  className="rounded-lg border border-amber-700/70 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500"
                >
                  Start again from the original · discards {artwork}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                title="Returns to the upload screen. The library is not affected."
                className="ml-auto text-xs text-slate-500 underline-offset-4 hover:underline"
              >
                close kit
              </button>
            </section>
          </>
        )}

        {(published.length > 0 || !seeded) && (
          <section className="space-y-2 border-t border-slate-800 pt-4">
            <h2 className="text-sm font-medium text-slate-300">Shared library</h2>
            <p className="max-w-prose text-xs text-slate-500">
              Every face there is, readable from any browser signed in to this site. Tap one
              to open it for editing — the artwork comes back from the library, so it works
              on a laptop that never authored it. A face stays a draft, and out of
              studio&apos;s picker, until you show it.
            </p>

            {/*
              Only while the library has no copy. Pressing it twice would
              overwrite whatever an administrator had since edited into the
              shipped face — the id is stable, so a second import replaces —
              and the honest guard against that is to stop offering it. See
              `seed`.
            */}
            {!seeded && (
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => void seed()}
                  disabled={seeding}
                  title="Copies public/faces/ into the library, where it becomes an ordinary face"
                  className="rounded-lg border border-sky-800 px-3 py-1.5 text-sm text-sky-300 hover:border-sky-600 disabled:cursor-wait disabled:opacity-50"
                >
                  {seeding ? 'Importing…' : 'Import the shipped face'}
                </button>
                <Guidance label="Why the shipped face is imported">
                  The face checked into <code>public/faces/</code> is the only kit that is
                  not in here, which is why pickers have had to offer it as an unnamed
                  &ldquo;default&rdquo; tile with no persona behind it. Import it once and it
                  becomes an ordinary face: visible in the strip, openable, and able to carry
                  a voice and a biography like the rest. Nothing else changes — it is the
                  same artwork, and it stays checked in as the fallback for a browser that
                  can reach no library at all.
                </Guidance>
              </div>
            )}

            {published.length > 0 && (
            <ul className="flex flex-wrap gap-3">
              {published.map((face) => {
                const draft = face.ready === false;
                /*
                  The shipped face, named as such rather than left to be guessed at.
                  It is an ordinary library entry after `seed` runs, which is the whole
                  point of importing it -- and that is exactly what makes it unfindable,
                  because the one thing distinguishing it is the one thing the strip does
                  not show. Its name is whatever public/faces/manifest.json says, so a
                  deployment with two faces of that name offers no way to tell them apart,
                  and the tile that needs opening is the one whose artwork is checked in.

                  Asked by id, not by name, for the reason bundledId exists: the name is
                  editable the moment this is an ordinary face and somebody will edit it.
                */
                const shipped = face.id === bundledId();
                return (
                  <li key={face.id} className="space-y-1 text-center">
                    <button
                      type="button"
                      onClick={() => void openPublished(face)}
                      disabled={opening !== null}
                      title={
                        shipped
                          ? 'The face checked into public/faces/, imported. Every browser that has chosen no face wears this one. Save when you are done to replace what the library holds — the checked-in copy is separate, and changes here do not reach it.'
                          : 'Open this face for editing. Save when you are done to replace what the library holds.'
                      }
                      className="disabled:cursor-wait"
                    >
                      <img
                        src={face.thumb}
                        alt=""
                        className={`h-24 w-24 rounded-lg border object-cover ${
                          opening === face.id ? 'animate-pulse ' : ''
                        }${
                          inUse === face.id
                            ? 'border-sky-500'
                            : 'border-slate-800 hover:border-slate-600'
                        } ${draft ? 'opacity-60' : ''}`}
                      />
                    </button>
                    <p className="max-w-24 truncate text-[11px] text-slate-400">{face.name}</p>
                    {shipped && (
                      <p className="text-[10px] text-sky-400/80" title="Its artwork is checked into the repository at public/faces/, and it is what a browser wears before anyone picks anything">
                        ships with the site
                      </p>
                    )}
                    {/*
                      A link rather than a checkbox, and it writes straight to
                      the index without touching the artwork — see ready.ts.
                      Routing it through a save would mean re-uploading a kit to
                      change one boolean, which is the difference between this
                      click and a minute of waiting.
                    */}
                    <button
                      type="button"
                      onClick={() =>
                        void setReady(face.id, draft)
                          .then(() => {
                            setPublished((current) =>
                              current.map((other) =>
                                other.id === face.id ? { ...other, ready: draft } : other,
                              ),
                            );
                            // The open kit and its tile are the same face; letting
                            // the checkbox disagree with the badge would make the
                            // next save silently undo this click.
                            if (kit?.id === face.id) setReadyFlag(draft);
                          })
                          .catch((cause: unknown) =>
                            setError(
                              cause instanceof Error ? cause.message : 'That face could not be marked',
                            ),
                          )
                      }
                      title={
                        draft
                          ? 'Shows this face in the studio’s picker'
                          : 'Hides it again. It stays saved, and editable from any browser.'
                      }
                      className={`text-[10px] underline-offset-4 hover:underline ${
                        draft ? 'text-amber-500' : 'text-slate-600'
                      }`}
                    >
                      {draft ? 'draft · show' : 'shown · hide'}
                    </button>
                    <br />
                    {/*
                      This deletes the artwork. It used to remove a shared copy
                      and leave the authored kit in this browser, which is why it
                      was a bare link and said so; there is no second copy now,
                      so it asks first and names what is going.
                    */}
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete ${face.name}? The library is the only place this kit lives, so its artwork goes with it.`,
                          )
                        ) {
                          return;
                        }
                        void deleteFace(face.id)
                          .then(() => {
                            setPublished((current) =>
                              current.filter((other) => other.id !== face.id),
                            );
                            if (inUse === face.id) {
                              selectFace(null);
                              setInUse(null);
                            }
                          })
                          .catch((cause: unknown) =>
                            setError(
                              cause instanceof Error ? cause.message : 'That face could not be deleted',
                            ),
                          );
                      }}
                      title="Deletes this face and its artwork, everywhere"
                      className="text-[10px] text-slate-600 underline-offset-4 hover:underline"
                    >
                      delete
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        )}

        {/*
          Last on the page and outside the kit branch on purpose: a run that
          failed is most worth reading after the kit it belonged to has been
          closed, and the log outlives the kit either way.
        */}
        <DiagnosticsPanel />
      </div>
    </div>
  );
}
