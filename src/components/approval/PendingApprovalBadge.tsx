/**
 * Small yellow dot indicator that flags pending approval activity.
 * Used inline next to stock cells, row identifiers, or sidebar entries
 * whenever there is at least one `pending` approval request related to
 * the surrounding context.
 *
 *   <PendingApprovalBadge />                       // bare dot
 *   <PendingApprovalBadge count={3} />             // dot replaced with count pill
 *   <PendingApprovalBadge count={12} tooltip="…" />// caps at 9+ visually
 */
interface PendingApprovalBadgeProps {
  /** If > 0, render as a count pill; if absent or 0, render as a bare dot. */
  count?: number;
  /** Hover text (defaults to a localised description when count is provided). */
  tooltip?: string;
  /** Visual scale — `sm` is for inline cells, `md` for sidebar links. */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: { dot: 'w-2 h-2', pill: 'min-w-[18px] h-[18px] text-caleo-10 px-1' },
  md: { dot: 'w-2.5 h-2.5', pill: 'min-w-[20px] h-5 text-caleo-11 px-1.5' },
} as const;

export default function PendingApprovalBadge({
  count,
  tooltip,
  size = 'sm',
  className,
}: PendingApprovalBadgeProps) {
  const showCount = typeof count === 'number' && count > 0;
  const title =
    tooltip ?? (showCount ? `${count} permintaan menunggu` : 'Ada permintaan menunggu');
  const dims = SIZES[size];
  const base = `inline-flex items-center justify-center rounded-full bg-amber-400 ${className ?? ''}`;

  if (!showCount) {
    return (
      <span
        title={title}
        aria-label={title}
        className={`${base} ${dims.dot}`}
      />
    );
  }
  const label = (count as number) > 9 ? '9+' : String(count);
  return (
    <span
      title={title}
      aria-label={title}
      className={`${base} ${dims.pill} font-extrabold text-amber-900`}
    >
      {label}
    </span>
  );
}
