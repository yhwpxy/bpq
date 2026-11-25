import type {ReactElement} from 'react';

interface IconProps {
  readonly size?: number;
  readonly className?: string;
}

const p = (size = 15, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export function FlowIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" />
      <path d="M6 9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9M12 14v1" />
    </svg>
  );
}

export function PlayIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

export function PauseIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function RotateCcwIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function FileTextIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function CpuIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

export function ShieldCheckIcon({
  size = 15,
  className,
}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function AlertIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function SearchIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function GlobeIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

export function LockIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PlusIcon({size = 14, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function HistoryIcon({size = 15, className}: IconProps): ReactElement {
  return (
    <svg {...p(size, className)}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
