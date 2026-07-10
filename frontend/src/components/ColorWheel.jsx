import React, { useCallback, useEffect, useRef, useState } from "react";

/* ── color-space conversions ────────────────────────────────────────────── */
export function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) =>
    Math.round(255 * (L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (
    "#" +
    [f(0), f(8), f(4)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function hexToHsl(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.substr(0, 2), 16) / 255;
  const g = parseInt(h.substr(2, 2), 16) / 255;
  const b = parseInt(h.substr(4, 2), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let H = 0;
  let S = 0;
  const L = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: H = (g - b) / d + (g < b ? 6 : 0); break;
      case g: H = (b - r) / d + 2; break;
      default: H = (r - g) / d + 4;
    }
    H /= 6;
  }
  return { h: Math.round(H * 360), s: Math.round(S * 100), l: Math.round(L * 100) };
}

/**
 * Hue+Saturation wheel with a vertical lightness slider.
 *   hsl:      { h: 0-359, s: 0-100, l: 0-100 }
 *   onChange: called continuously while dragging
 */
export default function ColorWheel({ hsl, onChange, size = 160 }) {
  const wheelRef = useRef(null);
  const sliderRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'wheel' | 'slider' | null
  const [hexDraft, setHexDraft] = useState(hslToHex(hsl.h, hsl.s, hsl.l));

  // keep the hex box in sync when the wheel/slider drives change
  useEffect(() => {
    setHexDraft(hslToHex(hsl.h, hsl.s, hsl.l));
  }, [hsl.h, hsl.s, hsl.l]);

  /* Pointer → hue + saturation on the wheel */
  const pointerToHS = useCallback((e) => {
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx;
    const dy = e.clientY - rect.top - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const sat = Math.min(1, dist / cx);
    // hue: 0 at top (12 o'clock), increasing clockwise
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    return { h: Math.round(angle), s: Math.round(sat * 100) };
  }, []);

  const handleWheelMove = useCallback(
    (e) => {
      const { h, s } = pointerToHS(e);
      onChange({ h, s, l: hsl.l });
    },
    [pointerToHS, onChange, hsl.l],
  );

  const startWheelDrag = (e) => {
    e.preventDefault();
    setDragging("wheel");
    e.currentTarget.setPointerCapture?.(e.pointerId);
    handleWheelMove(e);
  };

  /* Pointer → lightness on the slider */
  const pointerToL = useCallback((e) => {
    const rect = sliderRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = Math.max(0, Math.min(1, y / rect.height));
    return Math.round((1 - ratio) * 100);
  }, []);

  const handleSliderMove = useCallback(
    (e) => {
      const l = pointerToL(e);
      onChange({ h: hsl.h, s: hsl.s, l });
    },
    [pointerToL, onChange, hsl.h, hsl.s],
  );

  const startSliderDrag = (e) => {
    e.preventDefault();
    setDragging("slider");
    e.currentTarget.setPointerCapture?.(e.pointerId);
    handleSliderMove(e);
  };

  const stopDrag = () => setDragging(null);

  /* Wheel marker position */
  const rad = (hsl.h * Math.PI) / 180;
  const distPct = hsl.s; // percentage of radius
  const markerX = 50 + Math.sin(rad) * (distPct / 2);
  const markerY = 50 - Math.cos(rad) * (distPct / 2);

  /* Slider thumb position */
  const thumbTop = (1 - hsl.l / 100) * 100;

  const previewColor = `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`;

  const onHexSubmit = (val) => {
    setHexDraft(val);
    const parsed = hexToHsl(val);
    if (parsed) onChange(parsed);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        {/* Hue/saturation wheel */}
        <div
          ref={wheelRef}
          data-testid="color-wheel"
          onPointerDown={startWheelDrag}
          onPointerMove={(e) => dragging === "wheel" && handleWheelMove(e)}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="relative rounded-full select-none touch-none cursor-crosshair"
          style={{
            width: size,
            height: size,
            background: [
              "radial-gradient(circle, white 0%, rgba(255,255,255,0) 70%)",
              "conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)",
            ].join(", "),
            boxShadow: "inset 0 0 0 1px hsl(var(--border))",
          }}
        >
          <div
            aria-hidden
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white pointer-events-none"
            style={{
              left: `${markerX}%`,
              top: `${markerY}%`,
              background: previewColor,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)",
            }}
          />
        </div>

        {/* Lightness slider */}
        <div
          ref={sliderRef}
          data-testid="color-lightness"
          onPointerDown={startSliderDrag}
          onPointerMove={(e) => dragging === "slider" && handleSliderMove(e)}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="relative w-4 rounded-full select-none touch-none cursor-pointer"
          style={{
            height: size,
            background: `linear-gradient(to bottom, hsl(${hsl.h} ${hsl.s}% 100%), hsl(${hsl.h} ${hsl.s}% 50%), hsl(${hsl.h} ${hsl.s}% 0%))`,
            boxShadow: "inset 0 0 0 1px hsl(var(--border))",
          }}
        >
          <div
            aria-hidden
            className="absolute -left-0.5 h-2 w-5 rounded-sm border border-white -translate-y-1/2 pointer-events-none"
            style={{
              top: `${thumbTop}%`,
              background: previewColor,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      </div>

      {/* Preview + hex input */}
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="h-7 w-7 rounded-md border border-border shrink-0"
          style={{ background: previewColor }}
        />
        <input
          data-testid="color-hex"
          value={hexDraft}
          onChange={(e) => onHexSubmit(e.target.value)}
          spellCheck={false}
          className="flex-1 h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs font-mono uppercase tracking-wider focus:outline-none focus:ring-1 focus:ring-[hsl(var(--maroon))]"
          maxLength={7}
        />
      </div>
    </div>
  );
}
