import { React } from "../react";
import type { Priority, PullRequest, StateType } from "../linear/types";

type IconProps = { size?: number; className?: string };

/** The three bars of the MEGATECH mark. */
export function BrandMark({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mtl-mark">
      <rect width="32" height="32" fill="#06060a" />
      <rect x="6" y="8" width="20" height="3" fill="#00d4ff" />
      <rect x="6" y="14.5" width="14" height="3" fill="#e9eef4" />
      <rect x="6" y="21" width="20" height="3" fill="#e9eef4" />
    </svg>
  );
}

/** The same mark as a data URL, for the page's entry in navigation and search. */
export const MARK_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#06060a"/><rect x="6" y="8" width="20" height="3" fill="#00d4ff"/><rect x="6" y="14.5" width="14" height="3" fill="#e9eef4"/><rect x="6" y="21" width="20" height="3" fill="#e9eef4"/></svg>',
  );

/** Linear's workflow-state glyphs: dashed backlog, open circle, part-filled started, tick, cross. */
export function StatusIcon({
  type,
  color,
  fraction = 0.5,
  size = 14,
}: { type: StateType; color: string; fraction?: number } & IconProps) {
  const c = 7;
  const common = { width: size, height: size, viewBox: "0 0 14 14", "aria-hidden": true as const, className: "mtl-status" };
  switch (type) {
    case "backlog":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="5.5" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.9 1.9" />
        </svg>
      );
    case "unstarted":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case "started":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
          <path d={pie(c, c, 3, fraction)} fill={color} />
        </svg>
      );
    case "completed":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="7" fill={color} />
          <path d="M4 7.2l2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "canceled":
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="7" fill={color} />
          <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r="7" fill={color} />
          <path d="M3.8 7.5h2l.6 1.2h1.2l.6-1.2h2M4.4 5.4h5.2l.9 2.1v2.1H3.5V7.5z" fill="none" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** A wedge from twelve o'clock, clockwise, covering `fraction` of a circle of radius `r`. */
function pie(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.min(Math.max(fraction, 0), 1);
  if (f >= 1) return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  if (f <= 0) return "";
  const angle = f * 2 * Math.PI;
  const x = cx + r * Math.sin(angle);
  const y = cy - r * Math.cos(angle);
  return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}z`;
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority } & IconProps) {
  if (priority === 1)
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="mtl-priority" data-urgent="">
        <rect width="14" height="14" rx="3" fill="#f2994a" />
        <rect x="6.1" y="3" width="1.8" height="5.4" rx=".9" fill="#fff" />
        <rect x="6.1" y="9.6" width="1.8" height="1.8" rx=".9" fill="#fff" />
      </svg>
    );
  const lit = priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="mtl-priority">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={9 - i * 3}
          width="2.6"
          height={3 + i * 3}
          rx=".6"
          fill="currentColor"
          opacity={i < lit ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

export function PullRequestIcon({ status, size = 13 }: { status: PullRequest["status"] } & IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="mtl-pr-icon" data-status={status}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="4" cy="3.5" r="1.7" />
        <circle cx="4" cy="12.5" r="1.7" />
        <circle cx="12" cy="12.5" r="1.7" />
        <path d="M4 5.2v5.6M12 10.8V6.5a2 2 0 0 0-2-2H8.2M9.6 2.8L8 4.5l1.6 1.7" />
      </g>
    </svg>
  );
}

/** A ring filled clockwise by how much of the work is done. */
export function ProgressIcon({ done, total, size = 13 }: { done: number; total: number } & IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="mtl-progress-icon">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <path d={pie(7, 7, 3, total ? done / total : 0)} fill="currentColor" />
    </svg>
  );
}

export function ProjectIcon({ color, size = 13 }: { color: string } & IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" className="mtl-project-icon">
      <path d="M7 1.4l5 2.8v5.6L7 12.6 2 9.8V4.2z" fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.2 4.3L7 7l4.8-2.7M7 7v5.4" fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function UserIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="mtl-user-icon">
      <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
      <circle cx="9" cy="7.2" r="2.1" fill="currentColor" />
      <path d="M4.8 13.4c.8-2 2.4-2.8 4.2-2.8s3.4.8 4.2 2.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.4 2.2v2.6h-2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ExternalIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9v3.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
