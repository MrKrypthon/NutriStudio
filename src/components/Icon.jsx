// Inline SVG icons (24×24, stroke = currentColor), keyed by name so the sidebar can request them
// by key instead of relying on inconsistent unicode glyphs. Accepts a plain string child (a name)
// or arbitrary children as a fallback.
const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.8V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.8" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 3v3M16 3v3" /></>,
  users: <><path d="M15.5 20v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="8.8" cy="7" r="3.2" /><path d="M16.6 4.2a3.2 3.2 0 0 1 0 6.2M22 20v-1.6a4 4 0 0 0-3-3.8" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M8.7 10h6.6M8.7 14h6.6M8.7 18h4" /></>,
  bell: <><path d="M6.2 9.3a5.8 5.8 0 0 1 11.6 0c0 4.8 2 5.9 2 5.9H4.2s2-1.1 2-5.9Z" /><path d="M10 19.6a2 2 0 0 0 4 0" /></>,
  layout: <><rect x="3" y="3" width="8" height="8" rx="1.6" /><rect x="13" y="3" width="8" height="5" rx="1.6" /><rect x="13" y="10" width="8" height="11" rx="1.6" /><rect x="3" y="13" width="8" height="8" rx="1.6" /></>,
  recipes: <><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" /><path d="M12 11V6.5M8.4 7.7c0-1.9 1.4-3 2-4.2M15.6 7.7c0-1.9-1.4-3-2-4.2" /></>,
  leaf: <><path d="M5 19c9 1 14-4 14-13-9 0-14 4-14 13Z" /><path d="M5 19c2.2-4.2 5.2-7.2 9-9.2" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  cap: <><path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z" /><path d="M7 11.6V16c0 1.5 2.2 2.5 5 2.5s5-1 5-2.5v-4.4M21 9.5V15" /></>,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
}

export default function Icon({ children }) {
  const paths = typeof children === 'string' ? ICONS[children] : null
  if (!paths) return <span className="icon">{children}</span>
  return <svg className="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
}
