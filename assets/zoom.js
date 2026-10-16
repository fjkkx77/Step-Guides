/* 图片放大查看器（阅读页和写作页共用）
   电脑：滚轮缩放（以光标为中心）、双击切 1×↔2.5×、按住拖动、点空白处或 Esc 关闭
   手机：双指捏合、双击、拖动查看、**向下滑关闭**（Apple 在相册里的做法）

   三个踩过的坑，改动前先读：
   ① `will-change: transform` 会让 GPU 按当前倍率栅格化一次再拉伸 —— 放大后必糊。
      只在手势进行中开，手指一松就摘掉，让浏览器按新倍率重新栅格化（这是清晰度的关键）。
   ② 双击判定必须限定「只有一根手指」。第二根手指落下时若还在 300ms 内，
      会被当成双击而突然跳变 —— 这就是"双指放上去的一瞬间闪一下"的原因。
   ③ 捏合要跟着**当前**两指中点走，不能锚在起手那个中点，否则手指一移就抖。

   2026-09-26「手感拖沓、不跟手、放大不动缩小不动」的四个根因（改之前也读）：
   ④ 手势进行中**不能硬夹**：以前每一帧都把倍率夹在 1~8×、把位移夹在图片边界内，
      一夹，"手指下面那一点始终在手指下面"就破了 → 图从手指底下溜走（不跟手）；
      到了边界直接顶死（放大不动/缩小不动），缩到 1× 那一下还会突然吸回正中。
      现在跟 iPhone 相册一样：手势中**越界给阻力（橡皮筋）**，松手再弹回合法范围。
   ⑤ 回弹动画的过渡类 .zanim 会在松手后挂 260ms。这期间再按下去，每一下移动
      都要走 0.24s 缓动 → "慢慢跟上来"。现在按下时**从当前画面位置接住**并立即摘掉过渡。
   ⑥ 拖动松手就停死，没有惯性。现在按 UIKit 的正常减速率（0.998/ms）滑行。
   ⑦ 电脑触控板捏合（ctrl+滚轮）增量很小，旧的 /420 灵敏度下捏半天才动一点。

   2026-10-10「缩放过程中有点掉帧、卡卡的」量出来的两个原因（tools/verify-zoom-smooth.js 守着）：
   ⑧ 鼠标滚轮一格就把倍率直接跳过去：滚 6 格，90 帧里只有 6 帧画面在变、每帧跳 17%——
      看着像掉帧，其实是根本没有中间帧。现在滚轮只改"目标倍率"，画面每帧追过去（见 wheelTo）。
   ⑨ 每个 pointermove 都写一次 transform 再读一次布局（getBoundingClientRect）：两根手指、
      高回报率下一帧要写 4 次读 4 次，慢的手机上一帧的时间全花在这。现在一帧只写一次（schedule），
      框和图的尺寸缓存起来（measure），手势中不再读布局。 */
(() => {
  'use strict';

  const MIN = 1, MAX = 8, DBL = 2.5;
  const TAP_MOVE = 8;        // 手指移动超过这个距离就不算"点"
  const TAP_MS = 500;        // 按下到抬起多久之内算"点"。260 太严：手指按一下停顿再抬
                             // 就判不成点了（自动化里两次往返也会超）。500 仍远低于长按
  const DBL_MS = 300;        // 两次点击间隔在这之内算双击（手指）
  const DBL_MOUSE = 500;     // 鼠标：Windows 默认双击时间 500ms（微软 SetDoubleClickTime 文档原文）。
                             // 浏览器的 dblclick 按系统设置判定，我们等得比它短，慢一点的双击第一下就会先被当成单击关掉
  const DISMISS_AT = 110;    // 下滑多少距离就关闭
  const FLING = 0.55;        // 甩动速度阈值 px/ms（参考自己的手势配方，慢拉不关、快甩就关）

  /* 橡皮筋：越界量 x 在尺度 d 上显示成 (1 - 1/(x·c/d + 1))·d —— 越往外拉越拉不动，但永远不会顶死。
     公式和 c=0.55 来自对 UIScrollView 的逆向分析（Ilya Lobanov《Scrolling mechanics of UIScrollView》），
     不是 Apple 公开的规范 */
  const RB = 0.55;
  const DECEL = 0.998;       // 惯性每毫秒保留的速度比例：UIKit UIScrollView.DecelerationRate.normal（Apple 文档）
  const DECEL_OUT = 0.985;   // 惯性冲出边界后衰减得快得多，冲一小段就弹回来（自己调的值）
  const V_MIN = 0.02;        // px/ms，低于这个速度就算停了
  const V_MAX = 5;           // px/ms，防止极端一甩飞出十几屏
  const V_FLICK = 0.1;       // px/ms，松手速度超过它才滑行（慢慢拖着松手就停在原地）
  const S_UNDER = 0.45;      // 缩到 1× 以下的阻力尺度：再怎么捏也只能到 ~0.6×（自己调的值）
  const S_OVER = MAX * 0.5;  // 放到 8× 以上的阻力尺度
  const WHEEL_TAU = 70;      // ms，滚轮缩放追目标的时间常数：约 0.2 秒走完 95%（自己调的值：再短看不出过程，再长觉得拖）
  const WHEEL_STEP = 40;     // 滚轮增量小于它＝触控板/平滑滚轮，本来就是连续的，直接跟（再追一遍反而滞后）

  const rubber = (x, d) => (1 - 1 / (x * RB / d + 1)) * d;
  const unrubber = (y, d) => { y = Math.min(y, d * 0.999); return d / RB * (1 / (1 - y / d) - 1); };
  /** 位移：边界 ±m 以内原样，超出部分走橡皮筋 */
  const rubPos = (v, m, d) => { const a = Math.abs(v); return a <= m ? v : Math.sign(v) * (m + rubber(a - m, d)); };
  const unrubPos = (v, m, d) => { const a = Math.abs(v); return a <= m ? v : Math.sign(v) * (m + unrubber(a - m, d)); };
  /** 倍率：MIN~MAX 以内原样，两头走橡皮筋 */
  const rubScale = s => s < MIN ? MIN - rubber(MIN - s, S_UNDER) : s > MAX ? MAX + rubber(s - MAX, S_OVER) : s;
  const unrubScale = s => s < MIN ? MIN - unrubber(MIN - s, S_UNDER) : s > MAX ? MAX + unrubber(s - MAX, S_OVER) : s;

  function mount(dlg) {
    const box = dlg.querySelector('.box');
    const img = dlg.querySelector('img');

    let scale = 1, tx = 0, ty = 0;
    let dy = 0;                         // 下滑关闭时的位移
    const pts = new Map();
    let pinch = null, last = null, lastTap = 0, down = null, dismiss = null;
    let chromeTimer = 0;
    let raw = null;                     // 拖动时手指"真实走过"的位移（显示值是它过一遍橡皮筋）
    let rawS = 1;                       // 捏合时手指"真实捏出"的倍率
    let wasPinch = false;               // 这一轮手势里有没有捏过（捏过的松手不走惯性）
    let lastMid = null;                 // 最后一次捏合的两指中点：松手回弹时以它为锚
    let samples = [];                   // 最近 100ms 的指针位置，算松手速度用
    let glide = 0;                      // 惯性动画的 rAF id
    let wheel = null;                   // 滚轮缩放正在追的目标 { target, x, y, raf, t }
    let pending = 0;                    // 排着队等下一帧画的 rAF id
    let geo = null;                     // 框和图的尺寸缓存（见 measure）
    let zoomedCls = false, faded = false;
    let touchDblAt = 0;                 // 上一次手指双击缩放的时刻（挡浏览器补发的 dblclick）

    /* ── 画面 ───────────────────────────────────── */
    const paint = () => {
      if (pending) { cancelAnimationFrame(pending); pending = 0; }
      const k = dismiss ? Math.max(0.82, 1 - Math.abs(dy) / 1400) : 1;
      img.style.transform =
        `translate(${tx}px, ${ty + dy}px) scale(${(scale * k).toFixed(4)})`;
      const z = scale > 1.01;
      if (z !== zoomedCls) { zoomedCls = z; box.classList.toggle('zoomed', z); }
      if (dismiss) { faded = true; dlg.style.setProperty('--zfade', String(Math.max(0, 1 - Math.abs(dy) / 320))); }
      else if (faded) { faded = false; dlg.style.removeProperty('--zfade'); }
    };
    /** 手势跟随用：一帧里来多少次 move 都只画一次（见文件头 ⑨）。要立刻生效的地方直接调 paint() */
    const schedule = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; paint(); }); };

    /** 框和图的尺寸。手势中反复要用，而它们只在换图、图片加载完、窗口变化时才会变，所以量一次存着。
        图还没加载出来（宽 0）时不存，下次再量 */
    function measure() {
      if (geo) return geo;
      const r = box.getBoundingClientRect();
      const g = { left: r.left, top: r.top, w: r.width, h: r.height, iw: img.clientWidth, ih: img.clientHeight };
      if (g.w && g.iw) geo = g;
      return g;
    }
    const remeasure = () => { geo = null; };
    img.addEventListener('load', remeasure);
    addEventListener('resize', remeasure);

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

    /** 某倍率下，位移允许的范围 ±mx / ±my（图比框小的那一边是 0） */
    function limits(s = scale) {
      const g = measure();
      return { mx: Math.max(0, (g.iw * s - g.w) / 2),
               my: Math.max(0, (g.ih * s - g.h) / 2), w: g.w, h: g.h };
    }
    function clamp() {
      const { mx, my } = limits();
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    }

    /** 以某点为中心缩放：那个点在画面里的位置保持不动。
        free=true 用于手势进行中：不夹倍率、不夹位移（夹了手指下那一点就会溜走，见文件头 ④） */
    function zoomAt(cx, cy, next, free) {
      if (!free) next = Math.min(MAX, Math.max(MIN, next));
      const g = measure();
      const px = cx - g.left - g.w / 2, py = cy - g.top - g.h / 2;
      const k = next / scale;
      tx = px - (px - tx) * k;
      ty = py - (py - ty) * k;
      scale = next;
      if (free) return;
      if (scale <= 1.001) { scale = 1; tx = ty = 0; }
      clamp();
    }

    /* ── 惯性滑行 ─────────────────────────────────
       松手时的速度按 0.998/ms 衰减（UIKit 正常减速率）。冲出边界就衰减得快得多，停下后弹回边界 */
    function stopWheel() { if (wheel) { cancelAnimationFrame(wheel.raf); wheel = null; } }
    /** 停掉所有自己在跑的动画（惯性滑行、滚轮追目标）。停在哪算哪：状态变量就是画面上的样子 */
    function stopGlide() {
      if (glide) { cancelAnimationFrame(glide); glide = 0; }
      stopWheel();
    }

    /* ── 滚轮缩放：只改目标，画面每帧追过去（见文件头 ⑧） ─────────
       按倍率的对数追，放大和缩小的快慢才一样；光标底下那一点全程不动 */
    function wheelTo(cx, cy, factor) {
      const base = wheel ? wheel.target : scale;
      const target = Math.min(MAX, Math.max(MIN, base * factor));
      if (wheel) { wheel.target = target; wheel.x = cx; wheel.y = cy; return; }
      wheel = { target, x: cx, y: cy, t: performance.now(), raf: 0 };
      const step = now => {
        const w = wheel;
        if (!w) return;
        const dt = Math.min(34, Math.max(0, now - w.t)); w.t = now;
        const gap = Math.log(w.target / scale);
        const done = Math.abs(gap) < 0.002;
        zoomAt(w.x, w.y, done ? w.target : scale * Math.exp(gap * (1 - Math.exp(-dt / WHEEL_TAU))));
        paint();
        if (done) { wheel = null; wheelEnd(); return; }
        w.raf = requestAnimationFrame(step);
      };
      wheel.raf = requestAnimationFrame(step);
    }
    /** 滚轮停下来 160ms 后摘掉 will-change，画面按新倍率重新栅格化（清晰） */
    function wheelEnd() {
      clearTimeout(box._wheelEnd);
      box._wheelEnd = setTimeout(() => { if (!wheel && !pts.size && !glide) gpu(false); }, 160);
    }
    const calm = matchMedia('(prefers-reduced-motion: reduce)');

    function startGlide(vx, vy) {
      stopGlide();
      const sp = Math.hypot(vx, vy);
      if (sp > V_MAX) { vx *= V_MAX / sp; vy *= V_MAX / sp; }
      let t0 = performance.now();
      const step = now => {
        const dt = Math.min(34, Math.max(0, now - t0)); t0 = now;
        const { mx, my } = limits();
        tx += vx * dt; ty += vy * dt;
        vx *= Math.pow(Math.abs(tx) > mx ? DECEL_OUT : DECEL, dt);
        vy *= Math.pow(Math.abs(ty) > my ? DECEL_OUT : DECEL, dt);
        paint();
        if (Math.hypot(vx, vy) < V_MIN) {
          glide = 0;
          settle();
          gpuOffLater();
          return;
        }
        glide = requestAnimationFrame(step);
      };
      gpu(true);
      glide = requestAnimationFrame(step);
    }
    /** 回弹过渡跑完再摘 will-change（中途摘会在动画中间重新栅格化一次，卡一下） */
    function gpuOffLater() {
      clearTimeout(gpuOffLater._t);
      gpuOffLater._t = setTimeout(() => { if (!pts.size && !glide) gpu(false); }, 270);
    }

    /** 从"现在屏幕上看到的样子"接住：回弹/双击过渡进行到一半被按住时，
        状态变量里存的已经是终点，画面还在半路。不接住就会"啪"地跳到终点，
        而且那层过渡还挂着，接下来每一下移动都带 0.24s 缓动（见文件头 ⑤） */
    function catchNow(keepWheel) {
      if (keepWheel) { if (glide) { cancelAnimationFrame(glide); glide = 0; } }   // 滚轮连着滚：上一格还没追完的目标要留着
      else stopGlide();
      clearTimeout(animate._t);
      if (!img.classList.contains('zanim')) return;
      const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(img).transform || '');
      img.classList.remove('zanim');
      if (m) {
        const v = m[1].split(',').map(Number);
        scale = v[0]; tx = v[4]; ty = v[5] - dy;
      }
      paint();
    }

    /** 松手后把越界的倍率/位移弹回合法范围（带过渡）。anchor = 倍率回弹时保持不动的那一点 */
    function settle(anchor) {
      const g = measure();
      const a = anchor || { x: g.left + g.w / 2, y: g.top + g.h / 2 };
      const s0 = scale, x0 = tx, y0 = ty;
      if (scale < MIN || scale > MAX) zoomAt(a.x, a.y, scale);   // 不带 free：夹回 MIN~MAX
      if (scale <= 1.001) { scale = 1; tx = ty = 0; }
      clamp();
      const moved = Math.abs(s0 - scale) > 0.0005 || Math.abs(x0 - tx) > 0.5 || Math.abs(y0 - ty) > 0.5;
      if (!moved) return false;
      const s1 = scale, x1 = tx, y1 = ty;
      animate(() => { scale = s1; tx = x1; ty = y1; });
      return true;
    }

    /** 开始（或接着）单指拖动：把当前显示位移反推回"手指真实位移"，接着拖才连续 */
    function beginDrag(x, y) {
      const { mx, my, w, h } = limits();
      raw = { x: unrubPos(tx, mx, w), y: unrubPos(ty, my, h) };
      last = { x, y };
      samples = [{ x, y, t: performance.now() }];
    }

    const reset = () => { stopGlide(); dismiss = null; dy = 0; animate(() => { scale = 1; tx = ty = 0; }); };

    /* ── 控件显示/隐藏：照 iPhone「照片」 ──────────
       Apple 官方说明：「轻点照片隐藏屏幕上的控件，再轻点一次显示」——不会自己消失。
       隐藏时背景转成纯黑（沉浸看图），显示时背景跟系统外观走（浅色白 / 深色黑），见 zoom.css */
    function showChrome() {
      dlg.classList.remove('chrome-off');
      clearTimeout(chromeTimer);
    }
    const toggleChrome = () => {
      if (dlg.classList.contains('chrome-off')) showChrome();
      else { clearTimeout(chromeTimer); dlg.classList.add('chrome-off'); }
    };

    /* ── 电脑：滚轮 / 双击 / 鼠标移动唤回工具栏 ──── */
    box.addEventListener('wheel', e => {
      e.preventDefault();
      catchNow(true);
      gpu(true);
      /* 鼠标滚轮一格 deltaY≈100 → /420 约 27%/格；
         触控板捏合（浏览器报成 ctrl+滚轮）每个事件只有几个单位，/420 要捏很久才动，改 /100。
         Firefox 可能按"行"报（deltaMode=1），换算成像素 */
      const dw = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const factor = Math.exp(-dw / (e.ctrlKey ? 100 : 420));
      clearTimeout(box._wheelEnd);
      if (e.ctrlKey || Math.abs(dw) < WHEEL_STEP || calm.matches) {
        // 触控板捏合 / 平滑滚轮：增量本来就细，直接跟；「减弱动态效果」开着时也不追
        stopWheel();
        zoomAt(e.clientX, e.clientY, scale * factor);
        schedule();
        wheelEnd();
      } else {
        wheelTo(e.clientX, e.clientY, factor);    // 鼠标滚轮一格一格的：画面追过去，追到了再摘 will-change
      }
      showChrome();
    }, { passive: false });

    box.addEventListener('dblclick', e => {
      e.preventDefault();
      clearTimeout(box._tapT);           // 浏览器认定是双击了：第一下排着的「点空白关闭」作废
      // 手指双击已经在指针事件里缩放过；若浏览器还补发一个 dblclick，再切一次就缩回去了。
      // 只认「刚刚手指双击过」，不用 ghost()（那个窗口太宽，触摸后紧跟的真双击也会被吞）
      if (Date.now() - touchDblAt < 700) return;
      catchNow();
      gpu(false);
      animate(() => zoomAt(e.clientX, e.clientY, scale > 1.01 ? 1 : DBL));
    });

    /* 触摸之后浏览器会补发一串兼容鼠标事件（ghost）。
       不挡住的话：轻点 → 补发的 mousemove 触发"动鼠标就唤回" → 300ms 后我们自己的
       切换又把它收回去，表现成"点了没反应"。踩过，这里按时间窗口忽略。 */
    let lastTouchAt = 0;
    const ghost = () => Date.now() - lastTouchAt < 700;

    box.addEventListener('mousemove', () => { if (!ghost()) showChrome(); });

    /* ── 指针事件：一套覆盖鼠标和触摸 ───────────── */
    box.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') lastTouchAt = Date.now();
      // 合成出来的指针事件（自检脚本、某些辅助工具）没有"活动指针"，这里会抛，兜住
      try { box.setPointerCapture(e.pointerId); } catch (err) { /* 不影响后面的逻辑 */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { catchNow(); remeasure(); wasPinch = false; lastMid = null; }   // 回弹/滑行中也能一把接住；尺寸每轮手势重量一次
      gpu(true);

      if (pts.size === 1) {
        down = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
        beginDrag(e.clientX, e.clientY);
        // 没放大时，单指下滑＝关闭（Apple 相册的做法）；放大了就是拖动查看
        dismiss = (e.pointerType !== 'mouse' && scale <= 1.01)
          ? { y0: e.clientY, t: Date.now(), vy: 0, lastY: e.clientY, lastT: Date.now() } : null;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y),
                  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        rawS = unrubScale(scale);
        wasPinch = true;
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
        // 手指捏出的"真实倍率"累乘；显示倍率是它过一遍橡皮筋（越界越捏不动，但不会顶死）
        // 先以**上一帧**的中点为锚缩放，再把整张图平移"中点走过的距离"——
        // 这样上一帧中点底下那一点，这一帧正好落在新中点底下。
        // （以前是以新中点为锚缩放再平移，平移量被多算一遍，边捏边挪时实测会偏 6.5px）
        if (pinch.dist > 0 && d > 0) { rawS *= d / pinch.dist; zoomAt(pinch.mid.x, pinch.mid.y, rubScale(rawS), true); }
        tx += m.x - pinch.mid.x;
        ty += m.y - pinch.mid.y;
        pinch = { dist: d, mid: m };
        lastMid = m;
        schedule();                              // 手势中不夹（见文件头 ④），松手再 settle
        return;
      }

      if (dismiss) {
        const now = Date.now();
        const d = now - dismiss.lastT;
        if (d > 0) dismiss.vy = (e.clientY - dismiss.lastY) / d;
        dismiss.lastY = e.clientY; dismiss.lastT = now;
        dy = e.clientY - dismiss.y0;
        if (dy < 0) dy = dy * 0.3;               // 往上拉给阻尼，不让它飞走
        schedule();
        return;
      }

      if (scale > 1.01 && last && raw) {
        raw.x += e.clientX - last.x;
        raw.y += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        const { mx, my, w, h } = limits();
        tx = rubPos(raw.x, mx, w);               // 边界内 1:1 跟手，出了边界走橡皮筋
        ty = rubPos(raw.y, my, h);
        const now = performance.now();
        samples.push({ x: e.clientX, y: e.clientY, t: now });
        while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
        schedule();
      }
    });

    function endPointer(e) {
      if (e.pointerType !== 'mouse') lastTouchAt = Date.now();
      const had = pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!had) return;
      if (pending) paint();                // 最后一下移动还排着队：松手时立刻画掉，不拖到下一帧

      // 双指变单指的瞬间：剩下那根手指的"上一次位置"还停留在它按下时的坐标，
      // 下一次 move 会拿几百像素的差值去平移 —— 这就是"松手时图片跳一下"。
      // 把基准（含"真实位移"）重置成它现在的位置，接着拖才是连续的。
      if (pts.size === 1) {
        const [only] = [...pts.values()];
        beginDrag(only.x, only.y);
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
        gpuOffLater();
        return;
      }
      if (dismiss && isTap) { dismiss = null; dy = 0; paint(); }

      if (pts.size === 0) {
        // 松手：拖得快、没捏过 → 惯性滑行；否则把越界的倍率/位移弹回去
        const now = performance.now();
        const s0 = samples[0], s1 = samples[samples.length - 1];
        const fresh = !!s1 && now - s1.t < 60;    // 手指停住了再抬起不算甩
        const span = s0 && s1 ? s1.t - s0.t : 0;
        const vx = span > 0 ? (s1.x - s0.x) / span : 0, vy = span > 0 ? (s1.y - s0.y) / span : 0;
        samples = []; raw = null;
        if (!isTap && !wasPinch && scale > 1.01 && fresh && Math.hypot(vx, vy) > V_FLICK) {
          startGlide(vx, vy);                     // will-change 由滑行结束时摘
        } else if (settle(lastMid)) {
          gpuOffLater();                          // 回弹过渡跑完再摘，画面重新栅格化（清晰）
        } else {
          gpu(false);                             // 手一松就摘掉 will-change，画面重新栅格化
        }
        // 点（没怎么移动、时间也短）：双击＝缩放，单击＝显示/隐藏工具栏
        if (isTap) {
          const now2 = Date.now();
          // 先把要用的值取出来：下面 setTimeout 触发时 down 已经被置空，
          // 在回调里读 down.type 会抛 TypeError，工具栏就永远切不了（踩过）
          /* 点在不在图上，要按坐标重新命中：pointerdown 里 setPointerCapture 过，
             pointerup 的 e.target 永远是 .box —— 以前拿它判断，电脑上每一下单击（含双击的两下）
             都被当成「点空白」，300ms 后把查看器关掉（2026-10-16 用户报「双击放大/缩小会闪退」） */
          const kind = down.type, px = e.clientX, py = e.clientY;
          const tgt = document.elementFromPoint(px, py);
          const win = kind === 'mouse' ? DBL_MOUSE : DBL_MS;
          if (now2 - lastTap < win) {
            // 双击的第二下：撤掉第一下排着的单击动作，自己也不再排。
            // 手机在这里缩放；鼠标的缩放交给浏览器的 dblclick 事件（上面），这里不重复做
            // 鼠标：三连击的第三下也算「接着双击」，不当成新的单击去排关闭（第二轮审查）
            lastTap = kind === 'mouse' ? now2 : 0;
            clearTimeout(box._tapT);
            if (kind !== 'mouse') { touchDblAt = Date.now(); animate(() => zoomAt(px, py, scale > 1.01 ? 1 : DBL)); }
          } else {
            lastTap = now2;
            clearTimeout(box._tapT);
            box._tapT = setTimeout(() => {        // 等一下，确认不是双击的第一下
              if (kind === 'mouse') {
                if (ghost()) return;                 // 触摸补发的假鼠标事件，不当成点击
                if (tgt !== img) dlg.close();        // 电脑：点空白处关闭
              } else {
                toggleChrome();                      // 手机：点一下收起/唤回工具栏
              }
            }, win);
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
      if (pts.size === 1) { const [only] = [...pts.values()]; beginDrag(only.x, only.y); }
      if (pts.size === 0) { raw = null; samples = []; down = null; last = null; settle(lastMid); gpuOffLater(); }
    });

    dlg.addEventListener('close', () => {
      stopGlide();
      clearTimeout(chromeTimer);
      scale = 1; tx = ty = 0; dy = 0; dismiss = null; pinch = null; pts.clear();
      raw = null; samples = [];
      gpu(false);
      img.classList.remove('zanim');
      paint();
    });

    return {
      open(src, alt) {
        stopGlide();
        remeasure();
        img.src = src;
        img.alt = alt || '';
        // 顶部标题：「第 3 步的截图」→「第 3 步」（照片在这个位置显示拍摄时间）
        const t = dlg.querySelector('.ztitle');
        if (t) { t.textContent = (alt || '').replace(/的(截)?图$/, ''); t.hidden = !t.textContent; }
        scale = 1; tx = ty = 0; dy = 0; dismiss = null; pinch = null; pts.clear();
        raw = null; samples = [];
        img.classList.remove('zanim');
        paint();
        if (!dlg.open) dlg.showModal();
        showChrome();                              // 打开时显示控件，轻点画面才隐藏（照片的做法）
      },
      reset
    };
  }

  window.SGZoom = { mount };
  /* 顶栏标记：左上角返回键 + 居中标题 + 右侧占位（让标题真正居中）。阅读页 reader.js 里有同一份 */
  window.SGZoomBar = '<button class="zclose" type="button" aria-label="关闭">' +
    '<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2L2 10l8 8"/></svg></button>' +
    '<span class="ztitle"></span><span class="zspacer" aria-hidden="true"></span>';
})();
