// The subject icons of the product's own buttons (STORY-QUEST-SPEC §4.2a; story-quest Q9): «На берег»
// acts on the walker, the backpack's «У рюкзак» / «У руки» on a frame's miniature. «Затихнути»,
// the language and the panel have no subject of the list — no icon.
//
// The four drawings are the scene's (src/walker/icons.js) — products/** may not import src/**
// (INVARIANTS BOUNDARY-5), so they are copied here and tests/products.test.js holds the two equal.

/** @typedef {'frame' | 'raft' | 'walker' | 'kite'} Subject */

/** @type {Readonly<Record<Subject, string>>} */
export const ICONS = Object.freeze({
  frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/></svg>',
  raft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h16v4H4z"/><path d="M9 10v4M15 10v4"/><path d="M2 18.5c2 0 2-1.2 4-1.2s2 1.2 4 1.2 2-1.2 4-1.2 2 1.2 4 1.2 2-1.2 4-1.2"/></svg>',
  walker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.8" r="2.2"/><path d="M12 8v6.5M12 14.5l-3.2 5.5M12 14.5l3.2 5.5M7 10.8h10"/></svg>',
  kite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5C6 4.5 18 4.5 21 9.5"/><path d="M3 9.5l9 11M21 9.5l-9 11M8 7.2l4 13.3M16 7.2l-4 13.3"/></svg>',
});

/** The product's buttons → their subject; a button of the product without a row is a test failure. */
/** @type {Readonly<Record<string, Subject>>} */
export const SUBJECTS = Object.freeze({ toShore: 'walker', stow: 'frame', unpack: 'frame' });

/** The product's buttons with no subject of the list. */
export const NO_SUBJECT = Object.freeze(new Set(['quietDown']));

/**
 * `button` says `text` with the icon of `name`'s subject before it (aria-hidden); textContent stays the word.
 * @param {HTMLElement} button @param {string} name @param {string} text
 */
export function sayWithIcon(button, name, text) {
  const subject = SUBJECTS[name];
  const nodes = [];
  if (subject) {
    const span = Object.assign(document.createElement('span'), { className: 'cmd-icon' });
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = ICONS[subject];
    nodes.push(span);
  }
  button.replaceChildren(...nodes, document.createTextNode(text));
}
