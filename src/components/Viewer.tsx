import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { errorMessage } from "../api/client";
import type { ViewerInfo, ViewerLabel } from "../types/api";
import {
  cached,
  clearSlices,
  colorize,
  encodeLabels,
  labelColor,
  loadSlice,
  prefetch,
  renameLabels,
  sendSlice,
  stamp,
  type SliceData,
} from "./viewer/slices";

type Tool = "pan" | "brush" | "eraser";

const PRESETS = [
  { name: "Soft tissue", level: 40, width: 400 },
  { name: "Lung", level: -600, width: 1500 },
  { name: "Bone", level: 400, width: 1800 },
  { name: "Brain", level: 40, width: 80 },
];
const UNDO_DEPTH = 12;

export function Viewer({
  caseId,
  info,
  canEdit,
  dirty,
  busy,
  version,
  onDirty,
  onSave,
  onDiscard,
}: {
  caseId: string;
  info: ViewerInfo;
  canEdit: boolean;
  dirty: boolean;
  busy: boolean;
  version: number;
  onDirty: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const [axis, setAxis] = useState(info.axes[0].index);
  const current = useMemo(
    () => info.axes.find((item) => item.index === axis) || info.axes[0],
    [info.axes, axis],
  );
  const [index, setIndex] = useState(() => Math.floor(info.axes[0].count / 2));
  const [level, setLevel] = useState(info.level);
  const [width, setWidth] = useState(info.width);
  const [tool, setTool] = useState<Tool>("pan");
  const [brush, setBrush] = useState(8);
  const [labels, setLabels] = useState<ViewerLabel[]>(info.labels);
  const [label, setLabel] = useState(info.labels[0]?.value ?? 1);
  const [naming, setNaming] = useState(false);
  const [opacity, setOpacity] = useState(0.45);
  const [showMask, setShowMask] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sliceRef = useRef<SliceData | null>(null);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const layoutRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const undoRef = useRef<Uint8Array[]>([]);
  const queueRef = useRef<Promise<void> | null>(null);
  const pending = useRef(
    new Map<string, { axis: number; index: number; slice: SliceData }>(),
  );
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  const windowRef = useRef({ level: info.level, width: info.width, index: 0 });
  const gestureRef = useRef<{
    mode: "none" | "paint" | "pan" | "window" | "pinch";
    pointers: Map<number, { x: number; y: number }>;
    origin: { x: number; y: number; panX: number; panY: number };
    windowStart: { level: number; width: number };
    pinchStart: { distance: number; zoom: number };
  }>({
    mode: "none",
    pointers: new Map(),
    origin: { x: 0, y: 0, panX: 0, panY: 0 },
    windowStart: { level: 0, width: 1 },
    pinchStart: { distance: 1, zoom: 1 },
  });

  const painting = tool !== "pan";
  const span = Math.max(info.range[1] - info.range[0], 1);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const viewWidth = canvas.width / ratio;
    const viewHeight = canvas.height / ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#06090c";
    context.fillRect(0, 0, viewWidth, viewHeight);
    const slice = sliceRef.current;
    if (!slice) return;
    const millimetreWidth = slice.columns * current.column_mm;
    const millimetreHeight = slice.rows * current.row_mm;
    const fit = Math.min(
      viewWidth / millimetreWidth,
      viewHeight / millimetreHeight,
    );
    const scale = fit * viewRef.current.zoom;
    const drawWidth = millimetreWidth * scale;
    const drawHeight = millimetreHeight * scale;
    const x = (viewWidth - drawWidth) / 2 + viewRef.current.panX;
    const y = (viewHeight - drawHeight) / 2 + viewRef.current.panY;
    layoutRef.current = { x, y, width: drawWidth, height: drawHeight };
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(slice.image, x, y, drawWidth, drawHeight);
    if (showMask) {
      // Labels are categories, not intensities: blending them invents classes.
      context.imageSmoothingEnabled = false;
      context.globalAlpha = opacity;
      context.drawImage(slice.overlay, x, y, drawWidth, drawHeight);
      context.globalAlpha = 1;
      context.imageSmoothingEnabled = true;
    }
    const cursor = cursorRef.current;
    if (painting && cursor) {
      context.beginPath();
      context.arc(
        cursor.x,
        cursor.y,
        (brush * drawWidth) / slice.columns,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = tool === "eraser" ? "#ffffff" : labelColor(label);
      context.lineWidth = 1.5;
      context.stroke();
    }
  }, [current, showMask, opacity, painting, brush, tool, label]);

  const draw = useCallback(() => {
    try {
      paint();
    } catch {
      // A stale bitmap must not take down the page; the next load redraws.
      sliceRef.current = null;
    }
  }, [paint]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(frame.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(frame.clientHeight * ratio));
    draw();
  }, [draw]);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    draw();
  }, [draw, tick]);

  // Saving or discarding replaces the stored mask, so decoded slices must go.
  useEffect(() => {
    if (!version) return;
    // Clearing closes the cached bitmaps, so stop drawing the old slice first.
    sliceRef.current = null;
    clearSlices(caseId);
  }, [version, caseId]);

  useEffect(() => () => clearSlices(caseId), [caseId]);

  // Cached slices render immediately; only a fetch is debounced, which keeps the
  // window/level slider from issuing a request per keystroke.
  useEffect(() => {
    const controller = new AbortController();
    const ready = cached(caseId, axis, index, level, width);
    const windowed =
      windowRef.current.level !== level || windowRef.current.width !== width;
    const direction = Math.sign(index - windowRef.current.index) || 1;
    windowRef.current = { level, width, index };
    setError("");
    const timer = setTimeout(
      () => {
        if (!ready) setLoading(true);
        Promise.resolve(queueRef.current)
          .then(() =>
            loadSlice(caseId, axis, index, level, width, controller.signal),
          )
          .then((slice) => {
            if (controller.signal.aborted) return;
            sliceRef.current = slice;
            undoRef.current = [];
            setTick((value) => value + 1);
            prefetch(
              caseId,
              axis,
              index,
              level,
              width,
              direction,
              current.count,
            );
          })
          .catch((cause: unknown) => {
            if (!controller.signal.aborted)
              setError(errorMessage(cause, "Failed to load this slice."));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      ready || !windowed ? 0 : 40,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [caseId, axis, index, level, width, version, current.count]);

  useEffect(() => {
    viewRef.current.zoom = zoom;
    setTick((value) => value + 1);
  }, [zoom]);

  const step = useCallback(
    (delta: number) =>
      setIndex((value) =>
        Math.min(current.count - 1, Math.max(0, value + delta)),
      ),
    [current.count],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        setZoom((value) =>
          Math.min(12, Math.max(0.3, value * (event.deltaY > 0 ? 0.9 : 1.1))),
        );
        return;
      }
      step(event.deltaY > 0 ? 1 : -1);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [step]);

  // Strokes are sent one at a time and coalesced per slice: a stroke queued while
  // another is in flight replaces the pending payload for that slice instead of
  // chaining onto it, so one slow request can never block later edits.
  const pump = useCallback(async () => {
    if (queueRef.current) return queueRef.current;
    const run = (async () => {
      try {
        for (let job = pending.current.values().next().value; job;) {
          pending.current.delete(`${job.axis}:${job.index}`);
          await sendSlice(
            caseId,
            job.axis,
            job.index,
            await encodeLabels(job.slice),
          );
          onDirty();
          job = pending.current.values().next().value;
        }
      } catch (cause: unknown) {
        setError(errorMessage(cause, "Failed to save the brush stroke."));
      } finally {
        queueRef.current = null;
      }
    })();
    queueRef.current = run;
    return run;
  }, [caseId, onDirty]);

  const flush = useCallback(() => {
    const slice = sliceRef.current;
    if (!slice) return;
    pending.current.set(`${axis}:${index}`, { axis, index, slice });
    void pump();
  }, [axis, index, pump]);

  function pixelAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const slice = sliceRef.current;
    if (!canvas || !slice) return null;
    const rect = canvas.getBoundingClientRect();
    const { x, y, width: drawWidth, height: drawHeight } = layoutRef.current;
    return {
      canvasX: clientX - rect.left,
      canvasY: clientY - rect.top,
      column: ((clientX - rect.left - x) / drawWidth) * slice.columns,
      row: ((clientY - rect.top - y) / drawHeight) * slice.rows,
    };
  }

  function paintAt(column: number, row: number) {
    const slice = sliceRef.current;
    if (!slice) return;
    const value = tool === "eraser" ? 0 : label;
    const previous = strokeRef.current;
    const points: { x: number; y: number }[] = [];
    if (previous) {
      const distance = Math.hypot(column - previous.x, row - previous.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, brush / 2)));
      for (let i = 1; i <= steps; i++)
        points.push({
          x: previous.x + ((column - previous.x) * i) / steps,
          y: previous.y + ((row - previous.y) * i) / steps,
        });
    } else points.push({ x: column, y: row });
    let changed = false;
    for (const point of points) {
      const box = stamp(slice, point.x, point.y, brush, value);
      if (box) {
        colorize(slice.overlay, slice.labels, box);
        changed = true;
      }
    }
    strokeRef.current = { x: column, y: row };
    if (changed) draw();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    gesture.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    const position = pixelAt(event.clientX, event.clientY);
    if (!position) return;
    if (gesture.pointers.size === 2) {
      const [first, second] = [...gesture.pointers.values()];
      gesture.mode = "pinch";
      gesture.pinchStart = {
        distance: Math.max(
          1,
          Math.hypot(first.x - second.x, first.y - second.y),
        ),
        zoom: viewRef.current.zoom,
      };
      strokeRef.current = null;
      return;
    }
    gesture.origin = {
      x: event.clientX,
      y: event.clientY,
      panX: viewRef.current.panX,
      panY: viewRef.current.panY,
    };
    if (event.button === 2) {
      gesture.mode = "window";
      gesture.windowStart = { level, width };
      return;
    }
    if (event.button === 1 || !painting || !canEdit) {
      gesture.mode = "pan";
      return;
    }
    gesture.mode = "paint";
    const slice = sliceRef.current;
    if (slice) {
      undoRef.current = [
        ...undoRef.current.slice(-UNDO_DEPTH + 1),
        slice.labels.slice(),
      ];
      strokeRef.current = null;
      paintAt(position.column, position.row);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (gesture.pointers.has(event.pointerId))
      gesture.pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    const position = pixelAt(event.clientX, event.clientY);
    if (!position) return;
    cursorRef.current = { x: position.canvasX, y: position.canvasY };
    if (gesture.mode === "none") {
      if (painting) draw();
      return;
    }
    if (gesture.mode === "pinch" && gesture.pointers.size === 2) {
      const [first, second] = [...gesture.pointers.values()];
      const distance = Math.max(
        1,
        Math.hypot(first.x - second.x, first.y - second.y),
      );
      setZoom(
        Math.min(
          12,
          Math.max(
            0.3,
            (gesture.pinchStart.zoom * distance) / gesture.pinchStart.distance,
          ),
        ),
      );
      return;
    }
    if (gesture.mode === "paint") {
      paintAt(position.column, position.row);
      return;
    }
    if (gesture.mode === "pan") {
      viewRef.current.panX =
        gesture.origin.panX + (event.clientX - gesture.origin.x);
      viewRef.current.panY =
        gesture.origin.panY + (event.clientY - gesture.origin.y);
      draw();
      return;
    }
    if (gesture.mode === "window") {
      const scale = span / 1200;
      setLevel(
        Math.round(
          gesture.windowStart.level +
            (event.clientX - gesture.origin.x) * scale,
        ),
      );
      setWidth(
        Math.max(
          1,
          Math.round(
            gesture.windowStart.width +
              (event.clientY - gesture.origin.y) * scale,
          ),
        ),
      );
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    gesture.pointers.delete(event.pointerId);
    if (gesture.mode === "paint") flush();
    strokeRef.current = null;
    if (gesture.pointers.size === 0) gesture.mode = "none";
  }

  function undo() {
    const slice = sliceRef.current;
    const previous = undoRef.current.pop();
    if (!slice || !previous) return;
    slice.labels.set(previous);
    colorize(slice.overlay, slice.labels);
    draw();
    flush();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, () => void> = {
      ArrowUp: () => step(-1),
      ArrowDown: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      b: () => canEdit && setTool("brush"),
      e: () => canEdit && setTool("eraser"),
      v: () => setTool("pan"),
      "[": () => setBrush((value) => Math.max(1, value - 1)),
      "]": () => setBrush((value) => Math.min(60, value + 1)),
    };
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  const raster = info.axes.length === 1 && current.count === 1;

  async function commitLabels() {
    try {
      setLabels(await renameLabels(caseId, labels));
      setNaming(false);
    } catch (cause: unknown) {
      setError(errorMessage(cause, "Failed to save the label names."));
    }
  }

  return (
    <section className="panel viewer">
      <div className="viewer-bar">
        {info.axes.length > 1 && (
          <div className="segmented" role="group" aria-label="Plane">
            {info.axes.map((item) => (
              <button
                key={item.index}
                type="button"
                className={item.index === axis ? "" : "secondary"}
                onClick={() => {
                  setAxis(item.index);
                  setIndex(Math.floor(item.count / 2));
                  viewRef.current.panX = 0;
                  viewRef.current.panY = 0;
                  setZoom(1);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <div className="segmented" role="group" aria-label="Tool">
          <button
            type="button"
            className={tool === "pan" ? "" : "secondary"}
            onClick={() => setTool("pan")}
            title="Pan and zoom (V)"
          >
            Navigate
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                className={tool === "brush" ? "" : "secondary"}
                onClick={() => setTool("brush")}
                title="Brush (B)"
              >
                Brush
              </button>
              <button
                type="button"
                className={tool === "eraser" ? "" : "secondary"}
                onClick={() => setTool("eraser")}
                title="Eraser (E)"
              >
                Eraser
              </button>
            </>
          )}
        </div>
        {canEdit && (
          <button
            className="secondary"
            type="button"
            onClick={undo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
        )}
        <button
          className="secondary"
          type="button"
          onClick={() => {
            viewRef.current.panX = 0;
            viewRef.current.panY = 0;
            setZoom(1);
          }}
        >
          Fit
        </button>
        <span className="viewer-spacer" />
        {canEdit && (
          <>
            <button type="button" disabled={!dirty || busy} onClick={onSave}>
              {busy ? "Saving…" : "Save segmentation"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!dirty || busy}
              onClick={onDiscard}
            >
              Discard
            </button>
          </>
        )}
      </div>

      <div
        className={`viewer-stage tool-${tool}`}
        ref={frameRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="application"
        aria-label="Image viewer"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            cursorRef.current = null;
            draw();
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
        {loading && <p className="viewer-badge">Loading…</p>}
        {error && (
          <p className="viewer-badge error" role="alert">
            {error}
          </p>
        )}
        {dirty && <p className="viewer-badge unsaved">Unsaved changes</p>}
        <p className="viewer-readout">
          {current.name} {index + 1}/{current.count}
          {!raster && ` · W ${Math.round(width)} L ${Math.round(level)}`} ·{" "}
          {Math.round(zoom * 100)}%
        </p>
      </div>

      <div className="viewer-controls">
        <label className="control">
          <span>
            Slice <strong>{index + 1}</strong> / {current.count}
          </span>
          <div className="slice-row">
            <button
              className="secondary"
              type="button"
              disabled={index === 0}
              onClick={() => step(-1)}
              aria-label="Previous slice"
            >
              ‹
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, current.count - 1)}
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
              aria-label="Slice"
            />
            <button
              className="secondary"
              type="button"
              disabled={index >= current.count - 1}
              onClick={() => step(1)}
              aria-label="Next slice"
            >
              ›
            </button>
          </div>
        </label>
        {canEdit && (
          <label className="control">
            <span>
              Brush size <strong>{brush} px</strong>
            </span>
            <input
              type="range"
              min={1}
              max={60}
              value={brush}
              onChange={(event) => setBrush(Number(event.target.value))}
            />
          </label>
        )}
        <label className="control">
          <span>
            Overlay <strong>{Math.round(opacity * 100)}%</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(event) => setOpacity(Number(event.target.value) / 100)}
          />
        </label>
        <div className="control">
          <span>Segmentation</span>
          <div className="chips">
            <button
              type="button"
              className={`chip ${showMask ? "on" : ""}`}
              onClick={() => setShowMask(!showMask)}
            >
              {showMask ? "Visible" : "Hidden"}
            </button>
            {canEdit &&
              labels.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${label === item.value && tool !== "eraser" ? "on" : ""}`}
                  style={{ borderColor: labelColor(item.value) }}
                  onClick={() => {
                    setLabel(item.value);
                    setTool("brush");
                  }}
                  title={`Label value ${item.value}`}
                >
                  <span
                    className="swatch"
                    style={{ background: labelColor(item.value) }}
                  />
                  {item.name}
                </button>
              ))}
            {canEdit && (
              <button
                type="button"
                className="chip"
                onClick={() => setNaming(!naming)}
              >
                {naming ? "Close names" : "Rename…"}
              </button>
            )}
          </div>
          {canEdit && naming && (
            <div className="label-editor">
              {labels.map((item, position) => (
                <label key={item.value} className="label-row">
                  <span
                    className="swatch"
                    style={{ background: labelColor(item.value) }}
                  />
                  <span className="label-value">{item.value}</span>
                  <input
                    value={item.name}
                    maxLength={60}
                    aria-label={`Name for label ${item.value}`}
                    onChange={(event) =>
                      setLabels(
                        labels.map((entry, other) =>
                          other === position
                            ? { ...entry, name: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <div className="chips">
                <button
                  type="button"
                  className="chip"
                  disabled={
                    labels.length >= 16 || info.annotation_format === "COCO"
                  }
                  onClick={() => {
                    const next =
                      Math.max(0, ...labels.map((item) => item.value)) + 1;
                    if (next <= 255)
                      setLabels([
                        ...labels,
                        { value: next, name: `Label ${next}` },
                      ]);
                  }}
                >
                  + Add label
                </button>
                <button
                  type="button"
                  className="chip on"
                  onClick={() => void commitLabels()}
                >
                  Save names
                </button>
              </div>
              <p className="muted small">
                Names are stored with the case and written next to the saved
                segmentation as <code>labels.json</code>.
              </p>
            </div>
          )}
        </div>
        {!raster && (
          <label className="control">
            <span>
              Window <strong>WW {Math.round(width)}</strong> /{" "}
              <strong>WL {Math.round(level)}</strong>
            </span>
            <div className="window-row">
              <span>WW</span>
              <input
                type="number"
                value={Math.round(width)}
                min={1}
                max={Math.max(4000, info.range[1] - info.range[0])}
                step={10}
                aria-label="Window width"
                onChange={(event) =>
                  setWidth(Math.max(1, Number(event.target.value) || 1))
                }
              />
              <span>WL</span>
              <input
                type="number"
                value={Math.round(level)}
                min={info.range[0] - 1024}
                max={info.range[1] + 1024}
                step={10}
                aria-label="Window level"
                onChange={(event) => setLevel(Number(event.target.value) || 0)}
              />
            </div>
          </label>
        )}
        {!raster && (
          <div className="control">
            <span>Window presets</span>
            <div className="chips">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setLevel(preset.level);
                    setWidth(preset.width);
                  }}
                >
                  {preset.name}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setLevel(info.level);
                  setWidth(info.width);
                }}
              >
                Auto
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="muted small viewer-hint">
        Scroll to move through slices, Ctrl+scroll or pinch to zoom, drag with
        the right mouse button to window, middle button or Navigate to pan.
        {canEdit && " Brush and eraser paint directly on the segmentation."}
      </p>
    </section>
  );
}
