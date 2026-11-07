import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../i18n";

export function Icon({ d, size = 20, stroke = 1.8 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  pause: "M8 5v14M16 5v14",
  back: "M15 5l-7 7 7 7",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  play: "M7 4l13 8-13 8z",
  close: "M6 6l12 12M18 6L6 18",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
};

/** The player's arrowhead ship, tinted with the core's hue. */
export function CoreGlyph({ hue, size = 64, locked = false }: { hue: number; size?: number; locked?: boolean }) {
  const c = `hsl(${hue} 100% 66%)`;
  const id = `g${hue}-${size}`;
  return (
    <svg width={size} height={size} viewBox="-32 -32 64 64" aria-hidden="true" style={{ overflow: "visible", opacity: locked ? 0.5 : 1 }}>
      <defs>
        <filter id={id} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${id})`} transform="rotate(-90)">
        <circle r="24" fill="none" stroke={c} strokeWidth="1.2" opacity="0.6" />
        <path d="M18 0L-11 12L-5 0L-11 -12Z" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M8 0L-5 5L-2 0L-5 -5Z" fill="#fff" />
      </g>
    </svg>
  );
}

export function Pips({ level, max, next = false, color }: { level: number; max: number; next?: boolean; color?: string }) {
  const { t } = useI18n();
  const style = color ? ({ "--c": color } as CSSProperties) : undefined;
  return (
    <div className="pips" style={style} aria-label={t("common.pips", { level, max })}>
      {Array.from({ length: max }, (_, i) => {
        const on = i < level - (next ? 1 : 0);
        const isNext = next && i === level - 1;
        return <i key={i} className={isNext ? "next" : on ? "on" : ""} />;
      })}
    </div>
  );
}

export function Shards({ value }: { value: number }) {
  const { t, num } = useI18n();
  return (
    <span className="shards" aria-label={t("common.shards", { n: value })}>
      <span className="gem" />
      {num(value)}
    </span>
  );
}

export function ScreenHead({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="screen-head">
      {/* Focus starts on Back when a screen opens, so keyboard and gamepad users have a starting point. */}
      <button className="icon-btn" onClick={onBack} aria-label={t("common.back")} autoFocus>
        <Icon d={ICONS.back} />
      </button>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
