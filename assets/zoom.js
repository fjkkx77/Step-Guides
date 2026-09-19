/* 图片放大查看器（阅读页和写作页共用）
   电脑：滚轮缩放（以光标为中心）、双击切 1×↔2.5×、按住拖动、点空白处或 Esc 关闭
   手机：双指捏合、双击、拖动查看、**向下滑关闭**（Apple 在相册里的做法）

   三个踩过的坑，改动前先读：
   ① `will-change: transform` 会让 GPU 按当前倍率栅格化一次再拉伸 —— 放大后必糊。
      只在手势进行中开，手指一松就摘掉，让浏览器按新倍率重新栅格化（这是清晰度的关键）。
   ② 双击判定必须限定「只有一根手指」。第二根手指落下时若还在 300ms 内，
      会被当成双击而突然跳变 —— 这就是"双指放上去的一瞬间闪一下"的原因。
   ③ 捏合要跟着**当前**两指中点走，不能锚在起手那个中点，否则手指一移就抖。 */
(() => {
  'use strict';

  const MIN = 1, MAX = 8, DBL = 2.5;
  const TAP_MOVE = 8;        // 手指移动超过这个距离就不算"点"
  const TAP_MS = 500;        // 按下到抬起多久之内算"点"。260 太严：手指按一下停顿再抬
                             // 就判不成点了（自动化里两次往返也会超）。500 仍远低于长按
  const DBL_MS = 300;        // 两次点击间隔在这之内算双击
  const CHROME_MS = 3000;    // 刚打开时工具栏停留多久再自动淡出（只有这一次是自动的）
  const DISMISS_AT = 110;    // 下滑多少距离就关闭
  const FLING = 0.55;        // 甩动速度阈值 px/ms（参考自己的手势配方，慢拉不关、快甩就关）

  function mount(dlg) {
    const box = dlg.querySelector('.box');
    const img = dlg.querySelector('img');

    let scale = 1, tx = 0, ty = 0;
    let dy = 0;                         // 下滑关闭时的位移
    const pts = new Map();
    let pinch = null, last = null, lastTap = 0, down = null, dismiss = null;
    let chromeTimer = 0;

    /* ── 画面 ───────────────────────────────────── */
    const paint = () => {
      const k = dismiss ? Math.max(0.82, 1 - Math.abs(dy) / 1400) : 1;
      img.style.transform =
        `translate(${tx}px, ${ty + dy}px) scale(${(scale * k).toFixed(4)})`;
      box.classList.toggle('zoomed', scale > 1.01);
      const pct = dlg.querySelector('.zpct');
      if (pct) pct.textContent = Math.round(scale * 100) + '%';
      if (dismiss) dlg.style.setProperty('--zfade', String(Math.max(0, 1 - Math.abs(dy) / 320)));
      else dlg.style.removeProperty('--zfade');
    };

    /** 平滑变化用（双击、还原、回弹）；手势进行中不要用，会拖慢跟手 */
    function animate(fn) {
      img.classList.add('zanim');
      fn();
      paint();
      clearTimeout(animate._t);
      animate._t = setTimeout(() => img.classList.remove('zanim'), 260);
    }

    /** 手势期间才开 will-change：开着能跟手，关掉才会按新倍率重新栅格化（清晰） */
    const gpu = on => { img.style.willChange = on ? 'transform' : ''; };

    function clamp() {
      const r = box.getBoundingClientRect();
      const w = img.clientWidth * scale, h = img.clientHeight * scale;
      const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    }

    /** 以某点为中心缩放：那个点在画面里的位置保持不动 */
    function zoomAt(cx, cy, next) {
      next = Math.min(MAX, Math.max(MIN, next));
      const r = box.getBoundingClientRect();
      const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
      const k = next / scale;
      tx = px - (px - tx) * k;
      ty = py - (py - ty) * k;
      scale = next;
      if (scale <= 1.001) { scale = 1; tx = ty = 0; }
      clamp();
    }

    const reset = () => { dismiss = null; dy = 0; animate(() => { scale = 1; tx = ty = 0; }); };

    /* ── 工具栏自动隐藏 ─────────────────────────── */
    /** auto=true 才会自动淡出。用户主动唤回的（点一下画面）就一直留着，
        等他再点一下才收 —— 自动收会出现"还没来得及点就没了"（用户反馈） */
    function showChrome(auto) {
      dlg.classList.remove('chrome-off');
      clearTimeout(chromeTimer);
      if (auto) chromeTimer = setTimeout(() => dlg.classList.add('chrome-off'), CHROME_MS);
    }
    const toggleChrome = () => {
      if (dlg.classList.contains('chrome-off')) showChrome(false);   // 点出来的就别再自动收
      else { clearTimeout(chromeTimer); dlg.classList.add('chrome-off'); }
    };

    /* ── 电脑：滚轮 / 双击 / 鼠标移动唤回工具栏 ──── */
    box.addEventListener('wheel', e => {
      e.preventDefault();
      gpu(true);
      zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY / 420));
      paint();
      clearTimeout(box._wheelEnd);
      box._wheelEnd = setTimeout(() => gpu(false), 160);   // 停下来就摘掉，画面回到清晰
      showChrome(true);
    }, { passive: false });

    box.addEventListener('dblclick', e => {
      e.preventDefault();
      gpu(false);
      animate(() => zoomAt(e.clientX, e.clientY, scale > 1.01 ? 1 : DBL));
    });

    /* 触摸之后浏览器会补发一串兼容鼠标事件（ghost）。
       不挡住的话：轻点 → 补发的 mousemove 触发"动鼠标就唤回" → 300ms 后我们自己的
       切换又把它收回去，表现成"点了没反应"。踩过，这里按时间窗口忽略。 */
    let lastTouchAt = 0;
    const ghost = () => Date.now() - lastTouchAt < 700;

    box.addEventListener('mousemove', () => { if (!ghost()) showChrome(true); });

    /* ── 指针事件：一套覆盖鼠标和触摸 ───────────── */
    box.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') lastTouchAt = Date.now();
      box.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gpu(true);

      if (pts.size === 1) {
        down = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
        last = { x: e.clientX, y: e.clientY };
        // 没放大时，单指下滑＝关闭（Apple 相册的做法）；放大了就是拖动查看
        dismiss = (e.pointerType !== 'mouse' && scale <= 1.01)
          ? { y0: e.clientY, t: Date.now(), vy: 0, lastY: e.clientY, lastT: Date.now() } : null;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y),
                  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        dismiss = null; dy = 0; down = null;     // 双指上来就不再算"点"，避免误判成双击
        lastTap = 0;
        paint();
      }
    });

    box.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;

      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch.dist > 0) zoomAt(m.x, m.y, scale * (d / pinch.dist));
        tx += m.x - pinch.mid.x;                 // 跟着两指中点平移，手感才连贯
        ty += m.y - pinch.mid.y;
        pinch = { dist: d, mid: m };
        clamp(); paint();
        return;
      }

      if (dismiss) {
        const now = Date.now();
        const d = now - dismiss.lastT;
        if (d > 0) dismiss.vy = (e.clientY - dismiss.lastY) / d;
        dismiss.lastY = e.clientY; dismiss.lastT = now;
        dy = e.clientY - dismiss.y0;
        if (dy < 0) dy = dy * 0.3;               // 往上拉给阻尼，不让它飞走
        paint();
        return;
      }

      if (scale > 1.01 && last) {
        tx += e.clientX - last.x;
        ty += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        clamp(); paint();
      }
    });

    function endPointer(e) {
      if (e.pointerType !== 'mouse') lastTouchAt = Date.now();
      const had = pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!had) return;

      // 双指变单指的瞬间：剩下那根手指的"上一次位置"还停留在它按下时的坐标，
      // 下一次 move 会拿几百像素的差值去平移 —— 这就是"松手时图片跳一下"。
      // 把基准重置成它现在的位置，接着拖才是连续的。
      if (pts.size === 1) {
        const [only] = [...pts.values()];
        last = { x: only.x, y: only.y };
        down = null;                       // 也不再把它当成"点"
      }

      // 先判"这一下算不算轻点"：手机上没放大时每次按下都会进入下滑关闭的分支，
      // 若在这里直接 return，轻点就永远走不到下面的「切换工具栏」（踩过）
      const isTap = !!down && Date.now() - down.t < TAP_MS &&
                    Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_MOVE;

      if (dismiss && pts.size === 0 && !isTap) {
        const far = dy > DISMISS_AT, fast = dismiss.vy > FLING && dy > 30;
        dismiss = null;
        if (far || fast) { dlg.close(); return; }
        animate(() => { dy = 0; });               // 没够阈值就弹回去
        gpu(false);
        return;
      }
      if (dismiss && isTap) { dismiss = null; dy = 0; paint(); }

      if (pts.size === 0) {
        // 收尾时把越界的位移用动画收回去（直接改会看到"啪"一下）
        const bx = tx, by = ty;
        clamp();
        if (Math.abs(bx - tx) > 0.5 || Math.abs(by - ty) > 0.5) animate(() => {});
        gpu(false);                               // 手一松就摘掉 will-change，画面重新栅格化
        // 点（没怎么移动、时间也短）：双击＝缩放，单击＝显示/隐藏工具栏
        if (isTap) {
          const now = Date.now();
          // 先把要用的值取出来：下面 setTimeout 触发时 down 已经被置空，
          // 在回调里读 down.type 会抛 TypeError，工具栏就永远切不了（踩过）
          const kind = down.type, px = e.clientX, py = e.clientY, tgt = e.target;
          if (kind !== 'mouse' && now - lastTap < DBL_MS) {
            lastTap = 0;
            clearTimeout(box._tapT);
            animate(() => zoomAt(px, py, scale > 1.01 ? 1 : DBL));
          } else {
            lastTap = now;
            clearTimeout(box._tapT);
            box._tapT = setTimeout(() => {        // 等一下，确认不是双击的第一下
              if (kind === 'mouse') {
                if (ghost()) return;                 // 触摸补发的假鼠标事件，不当成点击
                if (tgt !== img) dlg.close();        // 电脑：点空白处关闭
              } else {
                toggleChrome();                      // 手机：点一下收起/唤回工具栏
              }
            }, DBL_MS);
          }
        }
        down = null; last = null;
      }
    }
    box.addEventListener('pointerup', endPointer);
    box.addEventListener('pointercancel', e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (dismiss && pts.size === 0) { dismiss = null; animate(() => { dy = 0; }); }
      if (pts.size === 0) gpu(false);
    });

    dlg.addEventListener('close', () => {
      clearTimeout(chromeTimer);
      scale = 1; tx = ty = 0; dy = 0; dismiss = null; pinch = null; pts.clear();
      gpu(false);
      img.classList.remove('zanim');
      paint();
    });

    return {
      open(src, alt) {
        img.src = src;
        img.alt = alt || '';
        scale = 1; tx = ty = 0; dy = 0; dismiss = null; pinch = null; pts.clear();
        img.classList.remove('zanim');
        paint();
        if (!dlg.open) dlg.showModal();
        showChrome(true);                          // 开场露一下工具栏，随后自动淡出
      },
      reset
    };
  }

  window.SGZoom = { mount };
})();
