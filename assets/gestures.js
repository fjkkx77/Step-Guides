/* 手机上的两个手势：长按拖动排序 + 左滑露出删除。
   左滑部分照搬自 references/组件_iOS手势（Schedule-Cards 出处），参数不动：
   死区 10 / 边缘 28 / 阈值 35% / 阻尼 0.3 / click 守卫 450ms 自过期。
   两个手势的分工（来自配方的仲裁表）：
     · 横向出死区 → 归左滑，同时取消长按计时
     · 原地按住 450ms → 归拖拽；有条目正滑开着时不起拖拽
     · 纵向 → 谁也不接，页面照常滚 */
(() => {
  'use strict';

  /* ═══════════ ① 左滑露出操作 ═══════════ */
  function SwipeActions(o) {
    const DEAD = 10, EDGE = 28, OVER = 0.3, OPEN_AT = 0.35;
    let g = null, open = null, eatUntil = 0;

    // 滑完浏览器可能补一个 click，守卫必须自己过期，否则会吃掉下一次真实点击
    const eat = () => { eatUntil = Date.now() + 450; };
    document.addEventListener('click', e => {
      if (eatUntil && Date.now() < eatUntil && !e.target.closest('.lsw-acts')) {
        eatUntil = 0; e.stopPropagation(); e.preventDefault();
      }
    }, true);

    function set(el, x, anim) {
      el.classList.toggle('lsw-anim', !!anim);
      el.style.transform = x ? `translate3d(${x.toFixed(1)}px,0,0)` : '';
    }

    // 按钮层只在滑动时临时插进 DOM，收回就拆，平时页面结构不变
    function mount(el) {
      const host = el.parentElement, list = o.actions(el);
      if (!host || !list || !list.length) return null;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const acts = document.createElement('div');
      acts.className = 'lsw-acts';
      list.forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lsw-btn ' + (a.cls || '');
        b.innerHTML = (a.icon || '') + '<span class="lsw-txt"></span>';
        b.querySelector('.lsw-txt').textContent = a.label;
        b.addEventListener('click', () => a.onClick(el));
        acts.appendChild(b);
      });
      acts.style.top = el.offsetTop + 'px';
      acts.style.height = el.offsetHeight + 'px';
      acts.style.right = (host.clientWidth - el.offsetLeft - el.offsetWidth) + 'px';
      host.insertBefore(acts, el);
      return { acts, w: acts.offsetWidth + 8 };
    }

    function close(anim) {
      if (!open) return;
      const x = open; open = null;
      x.acts.classList.remove('is-open');
      if (anim === false) { set(x.el, 0, false); x.acts.remove(); return; }
      set(x.el, 0, true);
      setTimeout(() => {
        if (open && open.acts === x.acts) return;
        x.el.classList.remove('lsw-anim');
        x.acts.remove();
      }, 320);
    }

    document.addEventListener('touchstart', e => {
      g = null;
      if (e.touches.length !== 1 || (o.blocked && o.blocked())) return;
      const t = e.target;
      if (open && t.closest('.lsw-acts')) return;
      let el = t.closest(o.item);
      if (el && !o.root().contains(el)) el = null;
      if (open && open.el !== el) { close(true); if (el) eat(); return; }
      if (!el || (o.canSwipe && !o.canSwipe(el, t))) return;
      const x = e.touches[0].clientX, vw = document.documentElement.clientWidth;
      const fromOpen = !!(open && open.el === el);
      if (!fromOpen && (x < EDGE || x > vw - EDGE)) return;
      g = { el, x0: x, y0: e.touches[0].clientY, fromOpen, locked: false, pos: 0, w: 0, acts: null };
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!g || !e.touches[0]) return;
      const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < DEAD && Math.abs(dy) < DEAD) return;
        if (Math.abs(dx) <= Math.abs(dy)) { if (g.fromOpen) close(true); g = null; return; }
        if (!g.fromOpen && dx > 0) { g = null; return; }
        g.locked = true;
        if (o.onLock) o.onLock();                       // 让宿主取消长按计时
        if (g.fromOpen) { g.acts = open.acts; g.w = open.w; open = null; }
        else { const m = mount(g.el); if (!m) { g = null; return; } g.acts = m.acts; g.w = m.w; }
        g.acts.classList.remove('is-open');
      }
      e.preventDefault();
      let pos = (g.fromOpen ? -g.w : 0) + dx;
      if (pos > 0) pos = pos * OVER;
      else if (pos < -g.w) pos = -g.w + (pos + g.w) * OVER;
      g.pos = pos;
      set(g.el, pos, false);
    }, { passive: false });

    function end(cancel) {
      if (!g) return;
      const x = g; g = null;
      if (!x.locked) { if (x.fromOpen && !cancel) { close(true); eat(); } return; }
      eat();
      const stay = !cancel && (x.fromOpen ? x.pos < -x.w * (1 - OPEN_AT) : x.pos < -x.w * OPEN_AT);
      open = { el: x.el, acts: x.acts, w: x.w };
      if (stay) { set(x.el, -x.w, true); x.acts.classList.add('is-open'); }
      else close(true);
    }
    document.addEventListener('touchend', () => end(false), { passive: true });
    document.addEventListener('touchcancel', () => end(true), { passive: true });
    addEventListener('scroll', () => { if (open && !g) close(true); }, { passive: true });
    addEventListener('resize', () => close(false));

    return {
      close,
      forget() { open = null; g = null; },          // 宿主重建列表 DOM 后调用
      active() { return !!(g && g.locked); },
      isOpen() { return !!open; }
    };
  }

  /* ═══════════ ② 长按拖动排序 ═══════════ */
  function LongPressDrag(o) {
    const HOLD = 450;        // 和配方一致：450ms 才算长按，短了会和滚动/点击打架
    const DEAD = 10;         // 按住后手指抖动超过这个距离就当是滚动，取消长按
    const EDGE = 64;         // 离屏幕上下这么近时自动滚动
    let timer = 0, st = null;

    const cancelHold = () => { clearTimeout(timer); timer = 0; };

    function begin(el, y, id) {
      const items = [...o.root().querySelectorAll(o.item)];
      st = {
        el, from: items.indexOf(el), y0: y, dy: 0, id,
        h: el.getBoundingClientRect().height,
        lastScroll: scrollY
      };
      el.classList.add('lpd-drag');
      document.body.classList.add('lpd-on');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* 忽略 */ } }
      o.onStart && o.onStart(el);
    }

    /** 拖到哪儿了：跟上下相邻项的中线比 */
    function shuffle(clientY) {
      const el = st.el;
      const sibs = [...o.root().querySelectorAll(o.item)].filter(x => x !== el);
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const before = s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
        if (before && clientY < mid) { move(s, true); return; }     // 往上挪到 s 前面
        if (!before && clientY > mid) { move(s, false); return; }   // 往下挪到 s 后面
      }
    }

    function move(target, before) {
      const el = st.el;
      const oldTop = el.getBoundingClientRect().top;
      target.parentElement.insertBefore(el, before ? target : target.nextSibling);
      // DOM 一动，元素的静态位置就变了；把基准同步挪回来，视觉上才不会跳
      const newTop = el.getBoundingClientRect().top - st.dy;
      st.y0 += (newTop - (oldTop - st.dy));
      apply();
    }

    const apply = () => { st.el.style.transform = `translate3d(0,${st.dy}px,0)`; };

    function autoScroll(clientY) {
      const vh = innerHeight;
      let d = 0;
      if (clientY < EDGE) d = -(EDGE - clientY) / 4;
      else if (clientY > vh - EDGE) d = (clientY - (vh - EDGE)) / 4;
      if (!d) return;
      scrollBy(0, d);
      // 补偿交给上面的 scroll 监听统一做，这里只管触发滚动，避免补两次
    }

    document.addEventListener('touchstart', e => {
      cancelHold();
      if (e.touches.length !== 1 || (o.blocked && o.blocked())) return;
      const t = e.target;
      const onHandle = !!(o.handle && t.closest(o.handle));
      // 输入框和按钮上不起拖拽（否则没法选字/点按钮）；但专门的抓手例外
      if (!onHandle && t.closest('button, input, textarea, a, .lsw-acts')) return;
      const el = t.closest(o.item);
      if (!el || !o.root().contains(el)) return;
      const t0 = e.touches[0];
      const y = t0.clientY, x = t0.clientX, id = t0.identifier;
      // 抓手上按住＝明确表达了"我要拖"，不用等满 450ms；别处按住才需要长按确认
      timer = setTimeout(() => { timer = 0; begin(el, y, id); }, onHandle ? 90 : HOLD);
      st = st || null;
      document._lpdStart = { x, y };
    }, { passive: true });

    /** 在所有触点里找出正在拖的那一根 */
    const mine = touches => {
      for (const t of touches) if (t.identifier === st.id) return t;
      return null;
    };

    document.addEventListener('touchmove', e => {
      if (timer && document._lpdStart) {
        const t = e.touches[0];
        if (!t) return;
        const d = Math.hypot(t.clientX - document._lpdStart.x, t.clientY - document._lpdStart.y);
        if (d > DEAD) cancelHold();                 // 还没按满就动了 = 想滚动，不是想拖
        return;
      }
      if (!st) return;
      const t = mine(e.touches);
      if (!t) return;                                // 动的是别的手指，交给浏览器（就是下面那条）

      // 只有单指时才拦截。两根手指在屏幕上时放行，让另一根手指照常滚页面——
      // 步骤多的时候，一只手按着卡片、另一只手滚到目标位置，比等自动滚快得多
      if (e.touches.length === 1) {
        e.preventDefault();
        autoScroll(t.clientY);                       // 单指时才需要靠边缘自动滚
      }
      st.dy = t.clientY - st.y0;
      apply();
      shuffle(t.clientY);
    }, { passive: false });

    /* 页面被另一根手指滚动时，卡片的静态位置跟着变了。
       把基准同量补偿回去，卡片才继续贴在手指下面而不是跟着页面跑 */
    addEventListener('scroll', () => {
      if (!st) return;
      const d = scrollY - st.lastScroll;
      st.lastScroll = scrollY;
      if (!d) return;
      st.y0 -= d;
      st.dy += d;
      apply();
    }, { passive: true });

    function drop(cancel) {
      cancelHold();
      if (!st) return;
      const el = st.el;
      el.classList.remove('lpd-drag');
      el.style.transform = '';
      document.body.classList.remove('lpd-on');
      const items = [...o.root().querySelectorAll(o.item)];
      const to = items.indexOf(el);
      const from = st.from;
      st = null;
      if (!cancel && to >= 0 && to !== from) o.onDrop(from, to);
      else o.onDrop(from, from);                     // 顺序没变也要重绘一次，清掉行内样式
    }
    const ended = e => {
      if (!st) { cancelHold(); return false; }
      for (const t of e.changedTouches) if (t.identifier === st.id) return true;
      return false;                      // 抬起的是另一根手指（刚才在滚页面），拖动继续
    };
    document.addEventListener('touchend', e => { if (ended(e)) drop(false); else cancelHold(); },
                              { passive: true });
    document.addEventListener('touchcancel', e => { if (ended(e)) drop(true); }, { passive: true });

    return { cancelHold, active: () => !!st };
  }

  window.SGGestures = { SwipeActions, LongPressDrag };
})();
