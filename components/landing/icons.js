// Stroke icons for the marketing pages. All decorative: every use sits beside a
// text label, so each is aria-hidden.

function Svg({ className = "h-5 w-5", children }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const L = {
  Mail: (p) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </Svg>
  ),
  Search: (p) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  ),
  Question: (p) => (
    <Svg {...p}>
      <path d="M4 5h16v11H9l-5 4V5z" />
      <path d="M10 9.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.3" />
      <path d="M12 14.2h.01" />
    </Svg>
  ),
  Document: (p) => (
    <Svg {...p}>
      <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Svg>
  ),
  Check: (p) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  UserCheck: (p) => (
    <Svg {...p}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c.8-3.5 3.3-5.5 6.5-5.5 1.3 0 2.5.3 3.5 1" />
      <path d="m15 18 2 2 4-4" />
    </Svg>
  ),
  Database: (p) => (
    <Svg {...p}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </Svg>
  ),
  Truck: (p) => (
    <Svg {...p}>
      <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </Svg>
  ),
  Pulse: (p) => (
    <Svg {...p}>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </Svg>
  ),
  Hash: (p) => (
    <Svg {...p}>
      <path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16" />
    </Svg>
  ),
  Layers: (p) => (
    <Svg {...p}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </Svg>
  ),
  Chain: (p) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  ),
  Clock: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  Quote: (p) => (
    <Svg {...p}>
      <path d="M4 18V8h5v6H6M13 18V8h5v6h-3" />
    </Svg>
  ),
  Plus: (p) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Arrow: (p) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  Menu: (p) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  Close: (p) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Replay: (p) => (
    <Svg {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4.5h4.5" />
    </Svg>
  ),
  Send: (p) => (
    <Svg {...p}>
      <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z" />
    </Svg>
  ),
};

/** The app's mark (app/icon.svg) as a component, plus the wordmark. */
export function Logo({ dark = false }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="h-7 w-7" fill="none">
        <rect width="32" height="32" rx="8" fill="#f26522" />
        <path d="M16 6l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V9l7-3z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12.5 16l2.5 2.5 4.5-4.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-display text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>
        CertFlow
      </span>
    </span>
  );
}
