import { useEffect, useRef, useState } from 'react';
import { proposeEyewearMatte, type EyewearMatteSettings } from './canvas';
import { CANVAS_EDGE } from './imageModels';
import { clampBox, type Box, type FaceKit } from './kit';

export interface EyewearCandidate {
  source: string;
  bare: string;
  box: Box;
}

interface EyewearPanelProps {
  kit: FaceKit;
  candidate: EyewearCandidate | null;
  busy: number;
  onGenerate: (box: Box) => void;
  onAccept: (candidate: EyewearCandidate, frame: string) => void;
  onDiscardCandidate: () => void;
  onRetune: () => void;
  onRestore: () => void;
}

const defaultBox = (): Box => ({
  x: Math.round(CANVAS_EDGE * 0.2),
  y: Math.round(CANVAS_EDGE * 0.25),
  width: Math.round(CANVAS_EDGE * 0.6),
  height: Math.round(CANVAS_EDGE * 0.32),
});

const DEFAULT_MATTE: EyewearMatteSettings = {
  threshold: 28,
  softness: 10,
  grow: 1,
  feather: 0.75,
};

function RectPicker({ image, box, onChange, locked }: {
  image: string;
  box: Box;
  onChange: (box: Box) => void;
  locked?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);

  const begin = (event: React.PointerEvent, resize: boolean) => {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    const node = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY, box };
    const scale = CANVAS_EDGE / (frame.current?.getBoundingClientRect().width ?? 1);
    node.setPointerCapture(event.pointerId);

    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) * scale;
      const dy = (next.clientY - start.y) * scale;
      onChange(
        clampBox(
          resize
            ? { ...start.box, width: start.box.width + dx, height: start.box.height + dy }
            : { ...start.box, x: start.box.x + dx, y: start.box.y + dy },
        ),
      );
    };
    const done = () => {
      node.releasePointerCapture(event.pointerId);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', done);
      node.removeEventListener('pointercancel', done);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', done);
    node.addEventListener('pointercancel', done);
  };

  const percent = (value: number) => `${(value / CANVAS_EDGE) * 100}%`;
  return (
    <div ref={frame} className="relative aspect-square overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <img src={image} alt="" draggable={false} className="pointer-events-none h-full w-full" />
      <div
        onPointerDown={(event) => begin(event, false)}
        className={`absolute border-2 border-cyan-400 ${locked ? 'border-dashed' : 'cursor-move'}`}
        style={{ left: percent(box.x), top: percent(box.y), width: percent(box.width), height: percent(box.height) }}
      >
        <span className="absolute -top-6 left-0 text-xs font-medium text-cyan-300">glasses</span>
        {!locked && (
          <button
            type="button"
            aria-label="Resize glasses region"
            onPointerDown={(event) => begin(event, true)}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-sm border border-cyan-200 bg-cyan-500"
          />
        )}
      </div>
    </div>
  );
}

function MatteEditor({ candidate, frame, restoreFrame, onChange }: {
  candidate: EyewearCandidate;
  frame: string;
  restoreFrame: string;
  onChange: (frame: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const restoreSource = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [radius, setRadius] = useState(18);
  const [view, setView] = useState<'composite' | 'bare' | 'original'>('composite');

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let live = true;
    const overlay = new Image();
    const restore = new Image();
    overlay.onload = () => {
      if (!live) return;
      target.width = candidate.box.width;
      target.height = candidate.box.height;
      target.getContext('2d')?.drawImage(overlay, 0, 0, target.width, target.height);
    };
    restore.onload = () => {
      if (live) restoreSource.current = restore;
    };
    overlay.src = frame;
    restore.src = restoreFrame;
    return () => {
      live = false;
    };
  }, [candidate, frame, restoreFrame]);

  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = canvas.current;
    const restore = restoreSource.current;
    if (!target || !restore) return;
    event.preventDefault();
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);

    const dab = (clientX: number, clientY: number) => {
      const bounds = node.getBoundingClientRect();
      const x = ((clientX - bounds.left) / bounds.width) * target.width;
      const y = ((clientY - bounds.top) / bounds.height) * target.height;
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      if (mode === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(restore, 0, 0, target.width, target.height);
      }
      ctx.restore();
    };

    dab(event.clientX, event.clientY);
    const move = (next: PointerEvent) => dab(next.clientX, next.clientY);
    const done = () => {
      node.releasePointerCapture(event.pointerId);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', done);
      node.removeEventListener('pointercancel', done);
      onChange(target.toDataURL('image/png'));
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', done);
    node.addEventListener('pointercancel', done);
  };

  const percent = (value: number) => `${(value / CANVAS_EDGE) * 100}%`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(['composite', 'bare', 'original'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => setView(choice)}
            className={`rounded-md border px-2 py-1 capitalize ${view === choice ? 'border-emerald-500 text-emerald-200' : 'border-slate-700 text-slate-400'}`}
          >
            {choice}
          </button>
        ))}
        <span className="h-5 border-l border-slate-700" />
        {(['erase', 'restore'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => setMode(choice)}
            className={`rounded-md border px-2 py-1 ${mode === choice ? 'border-cyan-500 text-cyan-200' : 'border-slate-700 text-slate-400'}`}
          >
            {choice === 'erase' ? 'Erase false pixels' : 'Restore frame pixels'}
          </button>
        ))}
        <label className="flex items-center gap-2 text-slate-400">
          Brush
          <input type="range" min={4} max={50} value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
          {radius}px
        </label>
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        <img
          src={view === 'original' ? candidate.source : candidate.bare}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full"
        />
        <canvas
          ref={canvas}
          onPointerDown={view === 'composite' ? paint : undefined}
          className={`absolute touch-none ${view === 'composite' ? 'cursor-crosshair' : 'pointer-events-none opacity-0'}`}
          style={{ left: percent(candidate.box.x), top: percent(candidate.box.y), width: percent(candidate.box.width), height: percent(candidate.box.height) }}
        />
      </div>
    </div>
  );
}

export default function EyewearPanel({
  kit,
  candidate,
  busy,
  onGenerate,
  onAccept,
  onDiscardCandidate,
  onRetune,
  onRestore,
}: EyewearPanelProps) {
  const neutral = kit.bases?.neutral ?? kit.base;
  const [box, setBox] = useState<Box>(kit.eyewear?.box ?? defaultBox());
  const [settings, setSettings] = useState(DEFAULT_MATTE);
  const [proposal, setProposal] = useState<string | null>(kit.eyewear?.frame ?? null);
  const [frame, setFrame] = useState<string | null>(kit.eyewear?.frame ?? null);
  const [coverage, setCoverage] = useState<number | null>(null);

  useEffect(() => setBox(kit.eyewear?.box ?? defaultBox()), [kit.id, kit.eyewear?.box]);

  useEffect(() => {
    if (!candidate) return;
    let live = true;
    setFrame(null);
    proposeEyewearMatte(candidate.source, candidate.bare, candidate.box, settings)
      .then((result) => {
        if (!live) return;
        setProposal(result.image);
        setFrame(result.image);
        setCoverage(result.coverage);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [candidate, settings]);

  const update = (field: keyof EyewearMatteSettings, value: number) =>
    setSettings((current) => ({ ...current, [field]: value }));

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Detachable glasses</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Remove the glasses from the working base, then keep only their visible pixels in a layer painted over every expression.
          </p>
        </div>
        {kit.eyewear && !candidate && (
          <div className="flex gap-2">
            <button type="button" onClick={onRetune} disabled={!kit.glassed} className="rounded-md border border-cyan-800 px-2 py-1 text-xs text-cyan-300 disabled:opacity-40">
              Refine matte
            </button>
            <button type="button" onClick={onRestore} className="rounded-md border border-amber-800 px-2 py-1 text-xs text-amber-300">
              Restore baked-in glasses
            </button>
          </div>
        )}
      </div>

      {!candidate && !kit.eyewear && (
        <div className="grid gap-4 md:grid-cols-2">
          <RectPicker image={neutral} box={box} onChange={setBox} />
          <div className="space-y-3 text-xs text-slate-400">
            <p>
              Cover every visible rim, bridge and arm, with clear padding around the outside. This box locks to the generated result; changing it later requires rebuilding the layer.
            </p>
            <p>
              The generated face behind the glasses is a proposal. Judge the reconstructed eyes and eyebrows before accepting the matte.
            </p>
            <button
              type="button"
              disabled={busy > 0}
              onClick={() => onGenerate(box)}
              className="rounded-lg border border-cyan-700 px-3 py-1.5 text-cyan-200 hover:border-cyan-500 disabled:opacity-40"
            >
              {busy ? 'Removing glasses…' : 'Remove glasses and build matte'}
            </button>
          </div>
        </div>
      )}

      {kit.eyewear && !candidate && (
        <div className="grid gap-4 md:grid-cols-2">
          <RectPicker image={neutral} box={kit.eyewear.box} onChange={() => undefined} locked />
          <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <img src={neutral} alt="" className="h-full w-full" />
            <img
              src={kit.eyewear.frame}
              alt=""
              className="absolute"
              style={{
                left: `${(kit.eyewear.box.x / CANVAS_EDGE) * 100}%`,
                top: `${(kit.eyewear.box.y / CANVAS_EDGE) * 100}%`,
                width: `${(kit.eyewear.box.width / CANVAS_EDGE) * 100}%`,
                height: `${(kit.eyewear.box.height / CANVAS_EDGE) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {candidate && frame && proposal && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-slate-400">Threshold {settings.threshold}<input className="block w-full" type="range" min={4} max={100} value={settings.threshold} onChange={(event) => update('threshold', Number(event.target.value))} /></label>
            <label className="text-xs text-slate-400">Softness {settings.softness}<input className="block w-full" type="range" min={0} max={30} value={settings.softness} onChange={(event) => update('softness', Number(event.target.value))} /></label>
            <label className="text-xs text-slate-400">Grow {settings.grow}px<input className="block w-full" type="range" min={0} max={6} value={settings.grow} onChange={(event) => update('grow', Number(event.target.value))} /></label>
            <label className="text-xs text-slate-400">Feather {settings.feather}px<input className="block w-full" type="range" min={0} max={4} step={0.25} value={settings.feather} onChange={(event) => update('feather', Number(event.target.value))} /></label>
          </div>
          <p className="text-xs text-slate-500">
            The automatic proposal covers {coverage === null ? '…' : `${(coverage * 100).toFixed(1)}%`} of the box. Dark reconstructed brows and lashes can look like frame pixels; erase them before accepting.
            Use Bare and Original above to judge the reconstructed eyes and eyebrows before judging the matte. Accepting detachment also discards any old smile thumbnail because it has the glasses baked into it.
          </p>
          <MatteEditor
            candidate={candidate}
            frame={frame}
            restoreFrame={proposal}
            onChange={setFrame}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onAccept(candidate, frame)} className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600">
              Accept bare base and glasses layer
            </button>
            <button type="button" onClick={onDiscardCandidate} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400">
              Discard this attempt
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
