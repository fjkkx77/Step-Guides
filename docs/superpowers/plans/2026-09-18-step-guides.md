# 图文步骤教程站 实施计划

> **For agentic workers:** 本计划用 superpowers:executing-plans 逐任务执行，步骤用 `- [ ]` 跟踪。

**Goal：** 做出一个「写完点发布就出一条链接、对方在手机上一步一屏跟着做」的图文教程站。

**Architecture：** 纯静态站（无构建、无框架、无依赖），GitHub Pages 托管。
阅读器只有一份 `assets/reader.js`，每个教程是 `/t/<id>/` 下的 `data.json` + `i/*.webp` + 三行壳子。
发布走 GitHub Git Data API，一次 commit 原子提交。

**Tech Stack：** 原生 HTML/CSS/JS（ES2020）、Canvas/WebP 压缩、Web Crypto（随机 id）、
GitHub REST Git Data API；验证用零依赖 headless Chrome + CDP 脚手架。

**设计稿：** `docs/superpowers/specs/2026-09-18-step-guides-design.md`

**测试策略（本项目没有 node 测试框架，也不引入）：**
- 纯函数（压缩规则、id、tree 组装、排序）→ `tests/selftest.html`，双击即跑，逐条显示 PASS/FAIL
- 版式/触摸/溢出 → `tools/verify.js`，真实视口 320/390/430 跑断言 + 截图
- 真机手感 → 用户确认，不由我声称

---

## Chunk 1：骨架与阅读器

### Task 1：仓库骨架 + 开发用样例教程

**Files:**
- Create: `robots.txt`, `assets/base.css`, `.gitignore`
- Create: `t/demo/data.json`, `t/demo/index.html`, `t/demo/i/01.webp … 12.webp`
- Create: `tools/cdp.js`, `tools/mock.js`（从 references 脚手架复制）

- [ ] **Step 1: 放 robots.txt**（`User-agent: *` / `Disallow: /`），根目录
- [ ] **Step 2: base.css** 定义配色变量（深浅两套）、正文 16px、`[hidden]{display:none}` 兜底
- [ ] **Step 3: 把桌面「临时」里 12 张 PNG 压成 WebP 存进 `t/demo/i/`**（用 node 一次性脚本，压完删脚本）
- [ ] **Step 4: 写 `t/demo/data.json`**：title、steps[{img,w,h,title,text}]，文字用设计稿里已写好的 12 段
- [ ] **Step 5: 复制验证脚手架到 `tools/`**，跑 `node tools/selftest.js` 确认 7 条自检通过
- [ ] **Step 6: Commit** `chore: 仓库骨架 + 样例教程数据`

### Task 2：阅读器 D 模式（一步一屏）

**Files:** Create: `assets/reader.css`, `assets/reader.js`；Modify: `t/demo/index.html`

- [ ] **Step 1:** `t/demo/index.html` 写成三行壳子：`<div id="app">` + 引 `/assets/reader.css` `/assets/reader.js`，
      带 `<meta viewport ... viewport-fit=cover>`、深浅两个 `theme-color`、`<meta name="robots" content="noindex">`
- [ ] **Step 2:** `reader.js`：`fetch('data.json')` → 渲染 N 个 `.page`，`scroll-snap-type:x mandatory`
- [ ] **Step 3:** 图片容器按 data.json 里的 w/h 预留宽高比（`aspect-ratio`），避免加载跳动
- [ ] **Step 4:** 顶部「第 n 步 / 共 N 步」+ 进度条，滚动时更新（`scrollend` 不可靠，用 `scroll` + rAF 节流）
- [ ] **Step 5:** 底部「上一步/下一步」按钮，高 48px，`touch-action:manipulation`，首尾禁用态
- [ ] **Step 6:** 最后一屏加「做完啦 🎉」
- [ ] **Step 7:** 用 `node tools/verify.js 390` 截图肉眼确认；断言 `scrollWidth<=390`
- [ ] **Step 8: Commit** `feat: 阅读器 D 模式`

### Task 3：A 模式（长文流）+ 放大层

**Files:** Modify: `assets/reader.js`, `assets/reader.css`

- [ ] **Step 1:** 顶栏加「逐步 / 长文」切换按钮（≥44px），状态存 `localStorage.readMode`
- [ ] **Step 2:** A 模式：卡片流，图 `max-height:42vh`，文字在下
- [ ] **Step 3:** 切换时保持「当前在第几步」——D 的第 n 屏 ↔ A 的第 n 张卡滚动位置
- [ ] **Step 4:** 点图开全屏层：`<dialog>` + `touch-action:pinch-zoom`，点任意处关闭
- [ ] **Step 5:** 深色模式下图片垫白底（`--shot-bg:#fff` 两套主题都是白）
- [ ] **Step 6:** `node tools/verify.js` 跑 320/390/430 三档 × 深浅两色 = 6 张截图
- [ ] **Step 7: Commit** `feat: 长文模式与图片放大`

---

## Chunk 2：写作与发布

### Task 4：图片压缩 `assets/img.js`

**Files:** Create: `assets/img.js`, `tests/selftest.html`

- [ ] **Step 1:** 先写自检用例（先测后写）：
      `pickSize(412,915)` → 不缩放，返回 `{w:412,h:915,scaled:false}`；
      `pickSize(1170,2532)` → 长边缩到 1600：`{w:739,h:1600,scaled:true}`；
      `pickSize(3000,1000)` → `{w:1600,h:533,scaled:true}`
- [ ] **Step 2:** 打开 `tests/selftest.html` 确认三条全红（函数还不存在）
- [ ] **Step 3:** 实现 `pickSize(w,h,max=1600)`：`max` 是参数不是写死值
- [ ] **Step 4:** 确认三条全绿
- [ ] **Step 5:** 实现 `compress(file)`：`createImageBitmap` → canvas → `toBlob('image/webp',0.85)`，
      返回 `{blob,w,h}`；**不支持 WebP 时退回 JPEG 0.85**（老安卓）
- [ ] **Step 6:** 自检页加一条真实压缩用例：拿 `t/demo/i/01.webp` 压一遍，断言产出 ≤200KB 且宽高不变
- [ ] **Step 7: Commit** `feat: 图片压缩`

### Task 5：GitHub 发布 `assets/github.js`

**Files:** Create: `assets/github.js`；Modify: `tests/selftest.html`

- [ ] **Step 1:** 写 `buildTree(files)` 的自检：给 3 个文件，断言产出的 tree 数组每项是
      `{path,mode:'100644',type:'blob',sha}`，且 path 不带前导斜杠
- [ ] **Step 2:** 实现 `buildTree`，自检转绿
- [ ] **Step 3:** 实现 `publish({token,repo,files,message})`：
      `GET /git/ref/heads/main` → `POST /git/blobs`（逐个，base64）→ `POST /git/trees`（base_tree=当前）
      → `POST /git/commits` → `PATCH /git/refs/heads/main`
- [ ] **Step 4:** 每一步失败都 `throw` 带接口名和 HTTP 状态的错误（发布失败要能看懂是哪一步断的）
- [ ] **Step 5:** 实现 `waitLive(url,{timeout:180000})`：轮询到 200 才 resolve（Pages 构建延迟）
- [ ] **Step 6:** **真实冒烟测试**：往仓库 `t/_smoke/hello.txt` 发一次，确认 commit 只有一个、文件在线可访问，然后删掉
- [ ] **Step 7: Commit** `feat: Git Data API 原子发布`

### Task 6：写作页（电脑 + 手机）

**Files:** Create: `w/index.html`, `assets/writer.js`, `assets/writer.css`

- [ ] **Step 1:** 布局：顶部标题输入 + 步骤列表 + 底部操作条（发布/预览/导出）
- [ ] **Step 2:** 选图：`<input type="file" multiple accept="image/*">` +
      `paste` 事件（Ctrl+V）+ `dragover/drop`；三个入口走同一个 `addFiles()`
- [ ] **Step 3:** 选完自动按文件名排序建步；每步一张缩略图 + 自动增高 textarea
- [ ] **Step 4:** 排序：`matchMedia('(pointer:coarse)')` 为真（手机）→ 显示「上移/下移/移到第几步」按钮；
      为假（电脑）→ 启用 HTML5 拖拽
- [ ] **Step 5:** 草稿：每次输入 300ms 防抖写 `localStorage.draft`；进页面若有草稿，问「继续上次的吗」
- [ ] **Step 6:** token 首次输入后存 `localStorage.ghToken`，页面上给「清除 token」按钮
- [ ] **Step 7:** `node tools/verify.js --page /w/` 跑 320/390/430，断言无横向溢出、按钮热区 ≥44px
- [ ] **Step 8: Commit** `feat: 写作页`

### Task 7：发布接线 + 编辑已发布

**Files:** Modify: `assets/writer.js`

- [ ] **Step 1:** 点发布 → 逐张 `compress()`（显示「正在压缩 3/12」）
- [ ] **Step 2:** 生成随机 id：`crypto.getRandomValues` 取 8 位 base32（去掉易混的 0/o/1/l）
- [ ] **Step 3:** 组装文件清单：`t/<id>/index.html`（壳子）、`data.json`、`i/*.webp`、更新 `list.json`
- [ ] **Step 4:** 调 `publish()` → `waitLive()` → 显示链接 + 一键复制
- [ ] **Step 5:** 失败处理：保留草稿、显示哪一步失败、给「重试」和「导出文件夹」两个出口
- [ ] **Step 6:** `?edit=<id>`：拉 data.json 回填（图片用线上 URL，未改动的图不重新上传）
- [ ] **Step 7: Commit** `feat: 发布与再编辑`

### Task 8：教程库 `/mine/`

**Files:** Create: `mine/index.html`

- [ ] **Step 1:** 读 `/list.json` 列出全部教程（标题、步数、时间、链接）
- [ ] **Step 2:** 每项：打开 / 复制链接 / 编辑 / 删除（删除＝改 list.json 并删目录，走同一个 publish）
- [ ] **Step 3:** noindex；窄屏单列
- [ ] **Step 4: Commit** `feat: 教程库`

---

## Chunk 3：收尾

### Task 9：全站验收

- [ ] **Step 1:** `node tools/verify.js --all`：三档 × 三页（读/写/库）无横向溢出、字号 ≥16px、热区 ≥44px
- [ ] **Step 2:** 断网发布一次，确认仓库没有半个教程、草稿还在
- [ ] **Step 3:** 写 `README.md`：怎么建 token、怎么发布、限制（10 次构建/小时、api.github.com 可达性）
- [ ] **Step 4:** 推到 GitHub，开 Pages，线上核对样例教程能打开
- [ ] **Step 5:** 出「真机确认清单」交给用户（横滑跟手、双指放大、底部按钮不被指示条挡）
- [ ] **Step 6: Commit + push**

---

## 执行纪律（来自既有记忆与 CLAUDE.md）

- 每个 Task 结束**实际打开文件/跑脚本确认**，不靠退出码 0 下结论
- 管道会吞退出码，判成败不接 `| tail`
- 只 `git add` 本次改过的文件，禁止 `git add -A`
- 清理：一次性脚本用完即删，headless Chrome 只按本进程 `RUN_PREFIX` 清残留
- 移动端：注入 CSS 触发断点不算验证，必须真实窄屏视口
