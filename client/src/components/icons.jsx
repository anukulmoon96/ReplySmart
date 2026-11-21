import { PLATFORM_LABELS } from '../lib.js';

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path
        d="M9 9.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-7.5L11 25v-3.5H9A2.5 2.5 0 0 1 6.5 19v-7A2.5 2.5 0 0 1 9 9.5z"
        fill="#fff"
      />
      <path d="M16 12.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="var(--primary)" />
    </svg>
  );
}

export function PlatformBadge({ platform }) {
  return (
    <span className={`platform-badge ${platform}`}>
      <span className="platform-dot" aria-hidden="true" />
      {PLATFORM_LABELS[platform] ?? 'Chat'}
    </span>
  );
}

export function PlatformDot({ platform }) {
  return <span className={`platform-dot ${platform}`} title={PLATFORM_LABELS[platform]} aria-hidden="true" />;
}

export function Spinner({ label }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-ring" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}
