/**
 * The Orbit mark: an open orbit around a nucleus, with two satellites. Drawn in currentColor so it
 * follows the theme. Geometry matches docs/assets/orbit-mark.svg, the source of build/icon.png.
 */
export function OrbitMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M 52.67 24.47 A 22 22 0 1 1 43.00 13.95" />
      <circle cx="32" cy="32" r="7" strokeWidth={3.5} />
      <circle cx="48.85" cy="17.86" r="4.5" fill="currentColor" stroke="none" />
      <circle cx="15.15" cy="46.14" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
