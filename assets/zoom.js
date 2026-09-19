/* 图片放大查看器（阅读页和写作页共用）
   电脑：滚轮缩放（以光标为中心）、双击在「适应屏幕 ↔ 2.5 倍」之间切、按住拖动、Esc 关闭
   手机：双指捏合、双击、单指拖动
   一套指针事件同时覆盖鼠标和触摸，不分叉两套实现。 */
(() => {
  'use strict';

  const MIN = 1, MAX = 8, DBL = 2.5;      // 倍率区间：1 = 适应屏幕；上限 8 倍够看清界面小字

  function mount(dlg) {
    const box = dlg.querySelector('.box');
    const img = dlg.querySelector('img');
    let scale = 1, tx = 0, ty = 0;
    const pts = new Map();                 // 当前按下的指针，用来分辨单指拖动 / 双指捏合
    let startDist = 0, startScale = 1, startMid = null, lastTap = 0;

    const apply = () => {
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      box.classList.toggle('zoomed', scale > 1.01);
      const pct = dlg.querySelector('.zpct');
      if (pct) pct.textContent = Math.round(scale * 100) + '%';
    };

    /** 把可视范围限制住，别让图被拖到屏幕外找不回来 */
    function clamp() {
      const r = box.getBoundingClientRect();
      const w = img.clientWidth * scale, h = img.clientHeight * scale;
      const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    }

    /** 以某个点为中心缩放：那个点在画面里的位置保持不动 */
    function zoomAt(clientX, clientY, next) {
      next = Math.min(MAX, Math.max(MIN, next));
      const r = box.getBoundingClientRect();
      const cx = clientX - r.left - r.width / 2;
      const cy = clientY - r.top - r.height / 2;
      const k = next / scale;
      tx = cx - (cx - tx) * k;
      ty = cy - (cy - ty) * k;
      scale = next;
      if (scale <= 1.001) { tx = ty = 0; }
      clamp(); apply();
    }

    const reset = () => { scale = 1; tx = ty = 0; apply(); };

    box.addEventListener('wheel', e => {
      e.preventDefault();
      // 触控板的惯性滚动步长很小，用指数变化保证手感一致
      zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY / 420));
    }, { passive: false });

    box.addEventListener('dblclick', e => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, scale > 1.01 ? 1 : DBL);
    });

    box.addEventListener('pointerdown', e => {
      box.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        startDist = Math.hypot(a.x - b.x, a.y - b.y);
        startScale = scale;
        startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      // 双击/双触：手机上没有 dblclick 的可靠触发，自己认
      if (e.pointerType !== 'mouse') {
        const now = Date.now();
        if (now - lastTap < 300) zoomAt(e.clientX, e.clientY, scale > 1.01 ? 1 : DBL);
        lastTap = now;
      }
    });

    box.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const prev = { x: p.x, y: p.y };
      p.x = e.clientX; p.y = e.clientY;

      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (startDist > 0) zoomAt(startMid.x, startMid.y, startScale * (d / startDist));
        return;
      }
      if (scale > 1.01) {                 // 只有放大了才拖动，否则会误触
        tx += e.clientX - prev.x;
        ty += e.clientY - prev.y;
        clamp(); apply();
      }
    });

    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) startDist = 0;
    };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);

    dlg.addEventListener('close', reset);

    return {
      open(src, alt) {
        img.src = src;
        img.alt = alt || '';
        reset();
        if (!dlg.open) dlg.showModal();
      },
      reset
    };
  }

  window.SGZoom = { mount };
})();
