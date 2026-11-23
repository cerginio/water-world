// Double tap (or double click) on the FPS panel copies its text: on a phone the HUD lines
// (GPU, profile, Measure sky) are hard to select by hand (SCENE-ENVIRONMENT E0).

/** Two pointer-ups close in time and place, not on a button. Pure, so it is unit-tested. */
export class DoubleTap {
  constructor({ maxMs = 350, maxPx = 30 } = {}) {
    this.maxMs = maxMs; this.maxPx = maxPx; this.last = null;
  }

  /** @param {{ t: number, x: number, y: number }} p @returns {boolean} true on the second tap */
  up(p) {
    const l = this.last;
    if (l && p.t - l.t <= this.maxMs && Math.hypot(p.x - l.x, p.y - l.y) <= this.maxPx) {
      this.last = null;
      return true;
    }
    this.last = p;
    return false;
  }
}

/** navigator.clipboard needs a secure context; the LAN dev stand (http://<IP>) is not one. */
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/** The panel's text as lines: what a person reads, with the browser for context. */
export function panelText(panel) {
  const lines = [];
  for (const el of panel.children) {
    if (el.tagName === 'CANVAS' || el.tagName === 'BUTTON') continue;
    const t = el.id === 'hud' ? el.textContent : el.innerText.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }
  lines.push(navigator.userAgent);
  return lines.join('\n');
}

export function bindPanelCopy(panel) {
  const tap = new DoubleTap();
  panel.addEventListener('pointerup', async (e) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (!tap.up({ t: e.timeStamp, x: e.clientX, y: e.clientY })) return;
    const ok = await copyText(panelText(panel));
    panel.dataset.copied = ok ? 'ok' : 'fail';
    setTimeout(() => delete panel.dataset.copied, 900);
  });
}
