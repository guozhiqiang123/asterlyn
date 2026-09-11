const paths: Record<string, string> = {
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 15c6 0 8-2 8-5"/>',
  changes:
    '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="11" cy="18" r="1.6"/>',
  history:
    '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2M4.7 5.4 3 5.2l.2 1.7"/>',
  head: '<path d="M5 20V5m0 1h10l4 4-4 4H5"/>',
  refresh:
    '<path d="M18.4 8A7 7 0 1 0 19 14M18.5 4.5V8h-3.6"/>',
  revert:
    '<path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  diff:
    '<path d="M8 5v14M5 8l3-3 3 3M16 19V5m-3 11 3 3 3-3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  locate:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  expand:
    '<path d="m8 6 4 4 4-4M8 12l4 4 4-4"/>',
  collapse:
    '<path d="m8 12 4-4 4 4M8 18l4-4 4 4"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  sync: '<path d="M7 7h11l-3-3M17 17H6l3 3M18 7l-3 3M6 17l3-3"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
  folder:
    '<path d="M3.5 7.5h6l2-2h9v13h-17z"/><path d="M3.5 9h17"/>',
  file: '<path d="M6 3.5h8l4 4V20H6z"/><path d="M14 3.5V8h4"/>',
  eye: '<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/>',
  tag: '<path d="M4 5v6.5L12.5 20 20 12.5 11.5 4H5a1 1 0 0 0-1 1Z"/><circle cx="8" cy="8" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevron: '<path d="m9 7 5 5-5 5"/>',
  commit:
    '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  minimize: '<path d="M6 16h12"/>',
  maximize: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  restore:
    '<path d="M8 9V6h10v10h-3"/><rect x="5" y="9" width="10" height="10" rx="1"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "chevron-down": '<path d="m7 9 5 5 5-5"/>',
  sort: '<path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
};

export function icon(name: keyof typeof paths, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
