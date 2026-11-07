(() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  };
  const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const chain = (el) => { const a = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) a.push(e); return a; };
  const bgOf = (el, skipSelf) => {
    let c = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (c[3] === 0) c = [1, 1, 1, 1];
    const els = chain(el).reverse();
    for (const e of els) {
      if (skipSelf && e === el) continue;
      const s = getComputedStyle(e);
      const op = parseFloat(s.opacity);
      const b = rgba(s.backgroundColor);
      if (b[3] > 0) c = over([b[0], b[1], b[2], b[3] * op], c);
    }
    return c;
  };
  const opacityOf = (el) => chain(el).reduce((a, e) => a * parseFloat(getComputedStyle(e).opacity), 1);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3; };
  const kind = (el) => {
    const c = el.classList;
    if (c.contains('btn')) return 'btn' + (c.contains('pri') ? '.pri' : c.contains('ghost') ? '.ghost' : c.contains('danger') ? '.danger' : c.contains('dpri') ? '.dpri' : c.contains('link') ? '.link' : '') + (el.hasAttribute('disabled') ? '[disabled]' : '');
    if (c.contains('iconbtn')) return 'iconbtn';
    if (el.closest('.seg')) return 'seg' + (c.contains('on') ? '.on' : '');
    if (el.closest('.tabs')) return 'tab' + (c.contains('on') ? '.on' : '');
    if (el.closest('.mtab') || el.closest('.bnav')) return 'bottomnav' + (c.contains('on') ? '.on' : '');
    if (el.closest('.nav')) return 'navitem' + (c.contains('on') ? '.on' : '');
    if (c.contains('chip')) return 'chip' + (c.contains('on') ? '.on' : '');
    if (el.closest('.os')) return 'ostile' + (c.contains('on') ? '.on' : '');
    return el.tagName.toLowerCase();
  };
  const ctxOf = (el) => {
    const m = [['.modal', 'dialog'], ['.sheet', 'sheet'], ['.mtab,.bnav', 'bottomnav'], ['.li', 'list-row'], ['table', 'table'], ['.top,.toolbar', 'toolbar'], ['.card', 'card'], ['.nav', 'nav']];
    for (const [s, n] of m) if (el.closest(s)) return n;
    return 'page';
  };
  const SEL = '.btn, .iconbtn, .seg > span, .tabs > span, .mtab > span, .bnav > span, .nav a, .chip, .os > span, button, [role=button]';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const op = opacityOf(el);
    const bg = bgOf(el, false);
    const outer = bgOf(el, true);
    const texts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const p = n.parentElement;
      const ps = getComputedStyle(p);
      const f = rgba(ps.color);
      const pbg = bgOf(p, false);
      const fg = over([f[0], f[1], f[2], f[3] * opacityOf(p)], pbg);
      texts.push({ t: t.slice(0, 28), fg: hex(fg), bg: hex(pbg), ratio: +ratio(fg, pbg).toFixed(2), size: parseFloat(ps.fontSize), weight: +ps.fontWeight });
    }
    const icon = el.querySelector('svg');
    let iconRatio = null;
    if (icon && !texts.length) {
      const f = rgba(getComputedStyle(icon).color);
      const fg = over([f[0], f[1], f[2], f[3] * op], bg);
      iconRatio = +ratio(fg, bg).toFixed(2);
    }
    const bc = rgba(s.borderTopColor);
    const bw = parseFloat(s.borderTopWidth);
    const fill = rgba(s.backgroundColor);
    const k = kind(el);
    let boundary = null;
    const host = el.parentElement && el.parentElement.classList.contains('seg') ? el.parentElement : el;
    if (!/ghost|link|navitem|tab|bottomnav|iconbtn|^a$/.test(k) && !(host !== el && !el.classList.contains('on'))) {
      const hostBg = bgOf(host, false), hostOuter = bgOf(host, true);
      const fillR = host !== el ? Math.max(ratio(bg, hostBg), ratio(hostBg, hostOuter)) : (fill[3] > 0 ? ratio(bg, outer) : 1);
      const bordR = bw > 0 && bc[3] > 0 ? ratio(over([bc[0], bc[1], bc[2], bc[3] * op], outer), outer) : 1;
      boundary = +Math.max(fillR, bordR).toFixed(2);
    }
    const r = el.getBoundingClientRect();
    const minText = texts.length ? Math.min(...texts.map((x) => x.ratio)) : iconRatio;
    const large = texts.some((x) => x.size >= 24 || (x.size >= 18.66 && x.weight >= 700));
    out.push({ kind: k, ctx: ctxOf(el), label: (texts[0] && texts[0].t) || el.getAttribute('aria-label') || '(icon)', minText, boundary, texts, w: Math.round(r.width), h: Math.round(r.height), large });
  }
  const pre = document.createElement('script');
  pre.type = 'application/json';
  pre.id = 'audit-out';
  pre.textContent = JSON.stringify({ vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth, items: out });
  document.body.appendChild(pre);
})();
