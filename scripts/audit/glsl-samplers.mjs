// Оголошені семплери GLSL після препроцесора — для BUDGET-1 (guard.mjs).
// Розбирає #define, #ifdef/#ifndef/#else/#endif. `#if <вираз>` свідомо не
// обчислюється: краще впасти, ніж порахувати не ту гілку.

/** @param {string} source текст шейдера @returns {string[]} імена семплерів */
export function declaredSamplers(source) {
  const defines = new Set(), stack = [], names = [];
  const active = () => stack.every(Boolean);
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^#define\s+(\w+)/))) { if (active()) defines.add(m[1]); continue; }
    if ((m = line.match(/^#ifdef\s+(\w+)/))) { stack.push(defines.has(m[1])); continue; }
    if ((m = line.match(/^#ifndef\s+(\w+)/))) { stack.push(!defines.has(m[1])); continue; }
    if (/^#else\b/.test(line)) { stack.push(!stack.pop()); continue; }
    if (/^#endif\b/.test(line)) { stack.pop(); continue; }
    if (/^#if\b/.test(line)) throw new Error(`#if без розбору: ${line}`);
    if (!active()) continue;
    m = line.match(/^uniform\s+(?:(?:lowp|mediump|highp)\s+)?[iu]?sampler\w*\s+([^;]+);/);
    if (m) names.push(...m[1].split(',').map(n => n.trim().replace(/\[.*$/, '')));
  }
  if (stack.length) throw new Error('незакритий #if');
  return names;
}
