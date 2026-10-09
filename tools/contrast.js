/* 对比度检查（作为表达式在页面里执行，返回 JSON 字符串）：
   所有直接含文字、看得见、没禁用的元素，文字颜色对「实际背景」（逐层往上合成）的对比度，按 WCAG 2 公式算。
   正文要 4.5:1，大字（≥24px，或 ≥18.66px 且粗体）要 3:1。背景是渐变的跳过（算不准）。 */
(() => {
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const t = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * t(c.r) + 0.7152 * t(c.g) + 0.0722 * t(c.b); };
  const bgOf = el => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { grad: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) chain.push(c);
      if (c && c.a >= 1) break;
    }
    let b = { r: 255, g: 255, b: 255, a: 1 };
    if (!chain.length || chain[chain.length - 1].a < 1) { const root = parse(getComputedStyle(document.body).backgroundColor); if (root && root.a) b = root; }
    for (let i = chain.length - 1; i >= 0; i--) b = over(chain[i], b);
    return b;
  };
  const modal = document.querySelector('dialog[open]');
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (modal && !modal.contains(el)) continue;               // 弹层打开时只看弹层里的
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    if (!/\S/.test(own)) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (el.closest('dialog:not([open]), [hidden], button:disabled')) continue;
    const bg = bgOf(el); if (bg.grad) continue;
    let fg = parse(cs.color); if (!fg) continue; fg = over(fg, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
    if (ratio < need) out.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''), text: el.textContent.trim().slice(0, 14), ratio: +ratio.toFixed(2), need });
  }
  return JSON.stringify(out);
})()
