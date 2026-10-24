export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="var(--olive)" />
      <circle cx="26" cy="32" r="13" fill="none" stroke="var(--on-olive)" strokeWidth="4" />
      <circle cx="38" cy="32" r="13" fill="none" stroke="var(--wood-soft)" strokeWidth="4" />
    </svg>
  );
}
