import { useEffect, useRef, useState } from "react";
import { useReducedMotion, useScrollReveal } from "@restaurant/ui";

/**
 * A small hand-rolled SVG line chart — same no-charting-library discipline as apps/admin's
 * AnalyticsPage.tsx TrendChart, just a line instead of bars. Draws itself in via stroke-dashoffset
 * once scrolled into view (useScrollReveal, same mechanism as AnimatedNumber/Reveal), settling to
 * its final drawn state immediately under reduced motion.
 */
export function MiniLineChart({
  points,
  width = 240,
  height = 64,
  className,
  strokeClassName = "stroke-primary",
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeClassName?: string;
}) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const pathRef = useRef<SVGPolylineElement>(null);
  const [length, setLength] = useState(0);
  const [drawn, setDrawn] = useState(reducedMotion);

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * height;
    return `${x},${y}`;
  });

  useEffect(() => {
    if (pathRef.current) setLength(pathRef.current.getTotalLength());
  }, [points, width, height]);

  useEffect(() => {
    if (!visible || reducedMotion) return;
    const t = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(t);
  }, [visible, reducedMotion]);

  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
        <polyline
          ref={pathRef}
          points={coords.join(" ")}
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeClassName}
          style={{
            strokeDasharray: length,
            strokeDashoffset: drawn ? 0 : length,
            transition: "stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </svg>
    </div>
  );
}
