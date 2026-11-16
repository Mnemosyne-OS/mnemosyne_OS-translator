/**
 * icons — inline SVG icons, never emoji (skill style-cartouche §3). One object
 * so a screen reads `<Icon.swap />`.
 */
const S = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const Icon = {
  swap: () => <svg {...S}><path d="M3 5h10l-3-3M13 11H3l3 3" /></svg>,
  copy: () => <svg {...S}><rect x="5" y="5" width="8.5" height="8.5" /><path d="M3 10.5V2.5h8" /></svg>,
  save: () => <svg {...S}><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" /></svg>,
  chat: () => <svg {...S}><path d="M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z" /></svg>,
  memory: () => <svg {...S}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>,
  // A memory chip with an arrow leaving it: « give the memory back », never a bin (a bin reads « delete »).
  free: () => <svg {...S}><path d="M2.5 8.5h11v4.5h-11zM5 13v1.5M8 13v1.5M11 13v1.5M8 6.5V1.5M5.8 3.7 8 1.5l2.2 2.2" /></svg>,
  gear: () => <svg {...S}><circle cx="8" cy="8" r="2" /><path d="M6.9 1.5h2.2l.4 1.9 1.4.6 1.6-1.1 1.6 1.6-1.1 1.6.6 1.4 1.9.4v2.2l-1.9.4-.6 1.4 1.1 1.6-1.6 1.6-1.6-1.1-1.4.6-.4 1.9H6.9l-.4-1.9-1.4-.6-1.6 1.1-1.6-1.6 1.1-1.6-.6-1.4-1.9-.4V6.9l1.9-.4.6-1.4-1.1-1.6 1.6-1.6 1.6 1.1 1.4-.6z" /></svg>,
  close: () => <svg {...S}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>,
  play: () => <svg {...S}><path d="M4.5 3v10l8-5z" /></svg>,
  stop: () => <svg {...S}><rect x="4" y="4" width="8" height="8" /></svg>,
  file: () => <svg {...S}><path d="M4 1.5h5.5L12.5 4.5v10H4z" /><path d="M9.5 1.5v3h3" /></svg>,
  up: () => <svg {...S}><path d="M8 13V3M4 7l4-4 4 4" /></svg>,
  down: () => <svg {...S}><path d="M8 3v10M4 9l4 4 4-4" /></svg>,
  plus: () => <svg {...S}><path d="M8 3v10M3 8h10" /></svg>,
  globe: () => <svg {...S}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></svg>,
  book: () => <svg {...S}><path d="M2.5 3h4.5a1.5 1.5 0 0 1 1 .5 1.5 1.5 0 0 1 1-.5h4.5v10H9a1 1 0 0 0-1 1 1 1 0 0 0-1-1H2.5z" /></svg>,
  trash: () => <svg {...S}><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9" /></svg>,
};

