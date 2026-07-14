import React, { useEffect, useMemo, useRef, useState } from "react";

const TICK = 14; // px between ticks

/* Horizontal ruler / scale picker — drag or flick to pick a number.
   Controlled: `value` may be null (shows `fallback` centered) until the user
   actually scrolls, at which point onChange fires with a real number. */
export default function ScalePicker({ min, max, step = 1, value, onChange, unit = "", fallback, majorEvery = 10 }) {
  const scrollRef = useRef(null);
  const initRef = useRef(false);
  const [half, setHalf] = useState(0);

  const count = Math.round((max - min) / step);
  const values = useMemo(
    () => Array.from({ length: count + 1 }, (_, i) => +(min + i * step).toFixed(2)),
    [min, count, step]
  );
  const shown = value ?? fallback ?? min;

  // Measure width so the end spacers let any value reach the centre line.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setHalf(el.clientWidth / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Centre the starting value once the width is known.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !half || initRef.current) return;
    const idx = Math.round((shown - min) / step);
    el.scrollLeft = idx * TICK;
    initRef.current = true;
  }, [half, shown, min, step]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(count, Math.round(el.scrollLeft / TICK)));
    const v = +(min + idx * step).toFixed(2);
    if (v !== value) onChange(v);
  };

  const pad = Math.max(0, half - TICK / 2);

  return (
    <div className="relative select-none">
      <div className="text-center mb-5">
        <span className="text-6xl font-semibold tracking-tight tabular-nums">{shown}</span>
        {unit && <span className="text-xl text-muted-foreground ml-1.5">{unit}</span>}
      </div>

      {/* centre pointer */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-1 z-10 flex flex-col items-center">
        <div className="h-0 w-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-maroon" />
        <div className="h-16 w-0.5 bg-maroon" />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex items-end h-20 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        <div style={{ minWidth: pad }} className="shrink-0" />
        {values.map((v, i) => {
          const major = i % majorEvery === 0;
          return (
            <div
              key={v}
              style={{ width: TICK, scrollSnapAlign: "center" }}
              className="shrink-0 flex flex-col items-center justify-end"
            >
              {major && <span className="text-[10px] text-muted-foreground mb-1 tabular-nums">{v}</span>}
              <div className={major ? "h-6 w-0.5 bg-foreground/50" : "h-3 w-px bg-foreground/25"} />
            </div>
          );
        })}
        <div style={{ minWidth: pad }} className="shrink-0" />
      </div>
    </div>
  );
}
