# 图文步骤教程站 · 现状（交接文档）

> 换会话、过几个月回来改这个站，先读这份。改需求前再读 `docs/superpowers/specs/2026-09-18-step-guides-design.md`。
> 最后更新：2026-10-09（/sc 深审后全量修复）

## 一句话
手机截图 + 文字 → 「一步一屏」的教程 → 一条链接发出去。写作页里直接用 GitHub token 提交到本仓库（Git Data API，原子提交），
网站在 https://jc.wbztl.xyz/ （Vercel，主用）和 https://fjkkx77.github.io/Step-Guides/ （GitHub Pages，只用来看教程）。

## 结构
| 文件 | 干什么 | 改它要注意 |
|---|---|---|
| `assets/reader.js` + `reader.css` | 阅读器，全站唯一一份 | 改了所有历史教程一起生效，不用重发 |
| `assets/writer.js` | 写作页 | 草稿按份存（`slot`），见下 |
| `assets/store.js` | 草稿库（IndexedDB v2：`drafts` + `blobs` 两张表） | 改结构要写升级迁移，不能丢用户草稿 |
| `assets/github.js` | 发布/删除/读目录/报错翻译 | 目录 list.json 只能在提交那一轮里从仓库读（`index` 回调） |
| `assets/ui.js` | 站内提示/确认/复制框 | 页面里不许再出现浏览器原生的三个弹框（verify-audit 有静态检查） |
| `assets/primary.js` | github.io 上的写作页/教程库转到 jc.wbztl.xyz 并清掉那边的 token | 域名写在这里 |
| `mine/index.html` | 教程库：本机草稿 + 已发布（只在有 token 的设备上显示） | 拼页面一律 textContent，不拼 innerHTML |
| `t/<8位编号>/` | 一份教程：壳子 index.html + data.json + i/*.webp | 壳子由 writer.js 的 SHELL 生成 |
| `list.json` | 教程目录 | 只由发布/删除在提交里改 |

## 几条不显然的约定（踩过的）
- **草稿每份一个位置**：`new:<码>`（地址 `/w/?draft=<码>`）、`edit:<编号>`（地址 `/w/?edit=<编号>`）。保存、清除都只动自己那份。以前只有一个位置，编辑另一份会把没发完的草稿覆盖掉。
- **编号**：8 位，字母表 `abcdefghjkmnpqrstuvwxyz23456789`，`SGGitHub.isId` 校验。地址里的 `?edit=`、目录里的 id 都要先过它。
- **发布前先把编号存进草稿**：回应丢失、等构建时关页面，再发也是同一份。
- **成功的判据**：data.json 里有本次发布的 `rev`，线上读到同一个 `rev` 才报「发布成功」。
- **目录 list.json**：在提交那一轮里从仓库当前版本读（Contents API raw），读不到就中止，404 才算空目录。不能从线上网站读（会是旧的、会失败）。
- **base64**：用 `SGGitHub.b64`（分块）。`String.fromCharCode(...大数组)` 在 Chrome 约 12.5 万字节起会崩。
- **图片压缩**：按宽度 1440 限 + 600 万像素兜底，绝不放大（原理见记忆库 image-viewer 配方）。
- **全站相对路径**：Pages 在 `/Step-Guides/` 子路径下。教程地址少了结尾 `/` 时阅读器会自己补上（Vercel 不补）。
- **观感层** `?fx=a|b` 默认关（2026-09-20 回滚原因见阅读器注释），用户还没选档。
- `tools/smoke-publish.js`、`tools/verify-delete.js` 会写真仓库，要加 `--real` 才跑。

## 测试
`node tools/run-all.js`：一条命令跑全部本地测试（自己起服务、假 GitHub、不联网、不开摄像头）。
`node tools/verify-audit.js`：2026-10-09 审查的每条问题一个回归用例（编号对应审查报告）。

## 已知限制（不修）
- 仓库是公开的：拿到链接、或找到仓库的人都能看；删掉的教程在 Git 历史里还能取回。用户 2026-10-09 选择保持公开、只把教程库藏起来。
- Safari 连续 7 天没打开这个站会清掉本机的设置和草稿（钥匙串兜住设置，兜不住草稿 → 导出备份）。
- 手机发布依赖 `api.github.com` 可达。
- 用系统相机扫设置码打开的链接带着 token，会留在浏览器历史里；导入后会提示去删。站内扫码不会留。

## 待用户确认（我测不了）
- 微信里打开教程：会不会被拦、右滑翻页会不会误触微信的「返回」。
- iPhone 上切去「设置」再回来是否被重载（续读功能就是为它做的）。
- iPhone 上发布出来的图是 .webp 还是 .jpg；Safari「大小」放大到 150% 时的版式；国内不挂代理的打开速度。
- 存设置时会不会弹「存储密码」。
- 首页「看个例子」挂的样例教程（README 说含真人信息）要不要换成干净的示例。
