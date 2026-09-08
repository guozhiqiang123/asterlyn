const paths: Record<string, string> = {
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 15c6 0 8-2 8-5"/>',
  changes:
    '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="11" cy="18" r="1.6"/>',
  history:
    '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2M4.7 5.4 3 5.2l.2 1.7"/>',
  refresh:
    '<path d="M18.4 8A7 7 0 1 0 19 14M18.5 4.5V8h-3.6"/>',
  folder:
    '<path d="M3.5 7.5h6l2-2h9v13h-17z"/><path d="M3.5 9h17"/>',
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
};

export function icon(name: keyof typeof paths, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
