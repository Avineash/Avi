import type { ReactNode, SVGProps } from 'react';

const P: Record<string, ReactNode> = {
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'x-circle': <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  roster: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  logout: <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  save: <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v6h8V3M7 21v-7h10v7" />,
  publish: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  reset: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  type: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  sliders: <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M10 10v4M16 16v4" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 9" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  building: <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M3 21h18M8 8h2M8 12h2M8 16h2" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5M16 6a3 3 0 0 1 0 6M18 14c2 .6 3 2.4 3 5" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

export type IconName = keyof typeof P;
export const STATUS_ICON = { approved: 'check-circle', pending: 'clock', rejected: 'x-circle', cancelled: 'ban' } as const;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {P[name]}
    </svg>
  );
}
