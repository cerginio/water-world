// The subject of each command button (STORY-QUEST-SPEC §4.2a; story-quest Q9): what the button
// acts on, drawn left of its word — the story's frame and its miniature, the frame on the water
// as a raft, the walker, the kite. A closed list; a button of stick.js's LABELS without a subject
// here (and not in NO_SUBJECT) fails tests/walker.test.js.
//
// The same four drawings are in products/shared/icons.js for the product's buttons: neither side
// may import the other (INVARIANTS BOUNDARY-4, BOUNDARY-5), tests/products.test.js holds them equal.
// Inline SVG in one colour (currentColor), aria-hidden: the word stays (access, language).

/** @typedef {'frame' | 'raft' | 'walker' | 'kite'} Subject */

/** @type {Readonly<Record<Subject, string>>} */
export const ICONS = Object.freeze({
  frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/></svg>',
  raft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h16v4H4z"/><path d="M9 10v4M15 10v4"/><path d="M2 18.5c2 0 2-1.2 4-1.2s2 1.2 4 1.2 2-1.2 4-1.2 2 1.2 4 1.2 2-1.2 4-1.2"/></svg>',
  walker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.8" r="2.2"/><path d="M12 8v6.5M12 14.5l-3.2 5.5M12 14.5l3.2 5.5M7 10.8h10"/></svg>',
  kite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5C6 4.5 18 4.5 21 9.5"/><path d="M3 9.5l9 11M21 9.5l-9 11M8 7.2l4 13.3M16 7.2l-4 13.3"/></svg>',
});

/** The scene's buttons (stick.js LABELS) → their subject (§4.2a table). */
/** @type {Readonly<Record<string, Subject>>} */
export const SUBJECTS = Object.freeze({
  take: 'frame', put: 'frame',
  release: 'frame', sink: 'frame', break: 'frame', call: 'frame', raise: 'frame', gather: 'frame', keep: 'frame',
  land: 'raft',
  stick: 'walker', leave: 'walker', enter: 'walker', fly: 'walker', water: 'walker', dive: 'walker', rise: 'walker',
  kite: 'kite', unkite: 'kite',
});

/** LABELS entries that are not buttons, or buttons without a subject of the list. */
export const NO_SUBJECT = Object.freeze(new Set(['keepNote']));

/** The icon's SVG for a button name, or null (no subject). */
export function iconOf(name) {
  const subject = SUBJECTS[name];
  return subject ? ICONS[subject] : null;
}
