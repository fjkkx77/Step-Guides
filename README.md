# 图文步骤教程站

把手机截图 + 文字说明，做成「一步一屏」的教程，发一条链接给对方，点开就能跟着做。

线上两个地址（内容完全一样，随便用哪个）：
**<https://jc.wbztl.xyz/>**（自有域名，Vercel）· <https://fjkkx77.github.io/Step-Guides/>（GitHub Pages）

- 写作页：`/w/`（电脑、手机都能从头写）
- 教程库：`/mine/`
- 一份教程：`/t/<随机8位>/`
- 例子：`/t/qhftq5kz/`（随机路径，不是 demo——样例里有真人信息）

## 看教程时能做什么

- **一步一屏**左右翻；顶栏可切「长文」模式上下滑回看
- 顶栏 **▦ N 步** 打开全部步骤缩略图，点一下直接跳过去（手机从底部抽出，电脑贴左边）
- **点图放大**：电脑滚轮缩放 / 双击 / 按住拖动 / 点空白处关；
  手机双指捏合 / 双击 / 拖动查看 / **向下滑关闭**（Apple 相册的做法）
- 放大时工具栏会**自动淡出**，手机点一下画面唤回、电脑动一下鼠标唤回

## 第一次使用：建一个 token

发布要往这个仓库写文件，所以需要一个 GitHub token：

1. 打开 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）
2. **Repository access** 选 *Only select repositories* → 只勾这一个仓库
3. **Permissions → Repository permissions → Contents** 设为 **Read and write**
   （其它权限一个都不用给）
4. 有效期建议 90 天，到期再建一个
5. 生成后复制，打开 `/w/` 点右上角 ⚙，填 GitHub 用户名、仓库名、分支、token，保存

token 只存在这台设备的浏览器里（localStorage），不会上传到任何地方。
万一泄露，去 GitHub 上点一下吊销即可——它碰不到你其它仓库。

### 换一台设备（比如手机）怎么办

localStorage 按「设备 + 浏览器」隔离，所以每台设备要填一次。两条路：

1. **推荐**：在手机上单独建一个 token（名字写 `教程站-手机`）。手机丢了只吊销这一个。
2. **省事**：电脑上 ⚙ → 「📱 出码」；手机上 ⚙ → 「📷 扫码」**站内直接开摄像头**，
   不用另外开相机 App（iOS Safari / 安卓 Chrome 都行；**微信内置浏览器可能不给相机权限**，
   那就用 Safari/Chrome 打开，或者退回用系统相机扫）。
   设置放在 URL 的 `#` 后面，**`#` 之后的内容浏览器不会发给服务器、也不进 Referer**；
   手机读到后立刻把它从地址栏抹掉，确认框里 token 是打码显示的。
   代价是这张码等于仓库写权限，**别让旁人拍到、别截图外发**。

## 怎么写一份教程

1. 打开 `/w/`，填标题
2. 加图，三个入口：
   - 「＋ 选择图片」（手机就是相册多选）
   - 「📋 粘贴图片」（直接读剪贴板；iOS 会弹一个"粘贴"确认）
   - 下面那个虚线框：**手机上在框里长按 → 选「粘贴」**（没有 Ctrl+V 的设备走这条）
   - 电脑上还可以直接 `Ctrl+V`、或者把文件拖进页面
3. 每一步写说明（标题可不填）
4. 顺序不对，四种办法：
   - 卡片上的 `↑ ↓`
   - **点左上角那个序号**，选「移到第几步」
   - **按住卡片左下角的抓手 ⠿ 拖**（手机、电脑都行）
   - 手机上还可以**往左滑一张卡**，露出「删除」
5. 点「发布」，等 GitHub 构建完（通常几十秒），复制链接发出去

改已经发布的教程：`/mine/` → 编辑，改完重新发布，**链接不变**。

## 已知限制

| 限制 | 影响 | 怎么绕 |
|---|---|---|
| GitHub Pages 每小时最多 10 次构建（软限） | 一小时内反复发布会被卡 | 草稿只存本地，点发布才提交；别把发布当保存用 |
| 发布要能连上 `api.github.com` | 国内网络下手机可能发不出去 | 挂代理；或先存草稿，回电脑再发。失败不会丢草稿，也不会在仓库里留下半个教程 |
| 两台设备同时发布 | 后一个会撞上「分支被推进了」 | 已自动处理：换新基准重来一轮，图片不用重传 |
| Pages 站点必然是公开可访问的 | 拿到链接的人都能看 | 链接是随机 8 位、`noindex` + `robots.txt` 禁收录；真正敏感的内容不要放 |
| 单个仓库建议 ≤1GB | 约三千份教程 | 一份教程（12 张截图）压缩后约 0.3MB |

## 本地开发

```bash
node tools/mock.js "<仓库目录>" 8879 &   # 本地静态服务（目录->index.html，跟 Pages 行为一致）
node tools/selftest.js                   # 纯函数 + 压缩自检（16 条）
node tools/verify.js t/qhftq5kz/ --shots      # 阅读页三档真实视口
node tools/verify.js t/qhftq5kz/ --mode=long  # 长文模式
node tools/verify-writer.js               # 写作页三档
node tools/verify.js t/qhftq5kz/ --base=https://fjkkx77.github.io/Step-Guides/   # 直接验线上
node tools/smoke-publish.js               # 真发一次再删掉（验原子提交+跨域+删除路径）
node tools/verify-qr.js                   # 出码：用独立解码器 jsQR 交叉验 + 链接导入流程
node tools/verify-scan.js                 # 扫码：静态图喂给真正的解码函数（不开摄像头，见下）
node tools/verify-paste.js                # 手机粘贴的两条路径
node tools/verify-editor.js               # 预览 / 换图 / 缩略图放大 / 离开逻辑
node tools/verify-zoom.js                 # 放大器（滚轮/双击/拖动/关闭）
node tools/verify-gestures.js             # 左滑删除 + 长按拖动（真实触摸事件）
node tools/verify-nav.js [站点地址]        # 返回/主页键落在哪（每个场景一个干净浏览器）
node tools/verify-steps.js                # 「全部步骤」面板（手机/窄屏/电脑三档）
node tools/verify-delete.js               # 删除已发布的教程（真发一份再删，不留痕）
```

写测试时的两个教训（都栽过）：**别用固定 sleep 等页面**，等条件成立；
**别拿 `window.SGWriter` 当"脚本就绪"信号**——它在 `boot()` 之前就挂上了，
那时按钮还没绑事件，点了等于没点。要等就等 `btn.onclick` 真的有值。

> **测试红线：不跑任何会申请摄像头/麦克风的自动化测试。**
> 2026-09-18 试过用 Chrome 的「假摄像头」参数做端到端测试，那个参数没生效，
> 打开的是本机真摄像头、拍到了真人画面。现在 `verify-scan.js` 改成把**静态二维码图片**
> 喂给扫码时真正用的那个解码函数，摄像头本身能不能开、扫得顺不顺，**由人在真机上确认**——
> 那才是这功能的实际运行环境，本机测出来的结论对手机也不作数。

`assets/vendor/qrcode.js` 是 qrcode-generator 2.0.4（MIT）原样放进来的，不走 CDN。
`assets/vendor/jsqr.js` 是 jsQR 1.4.0（Apache-2.0）：手机扫码时**按需加载**（iOS Safari 没有
`BarcodeDetector`，只能走它；安卓 Chrome 有就直接用系统解码器，不下这个包）。
它同时也是验证时的交叉校验器——用生成器自己验自己没意义。

根目录的 `.nojekyll` 不能删：GitHub Pages 默认跑 Jekyll，而 Jekyll 的默认排除列表里有 `vendor/`，
删了它 `assets/vendor/*.js` 线上会 404。

验证用的是真实窄屏视口（headless Chrome + CDP），不是注入 CSS 假装断点。

## 结构

```
assets/reader.js    阅读器（全站唯一一份，改它所有历史教程一起生效）
assets/writer.js    写作页
assets/img.js       图片压缩（长边>1600 才缩，绝不放大）
assets/github.js    Git Data API 原子发布
assets/store.js     草稿（IndexedDB）
t/<id>/             一份教程：index.html 壳子 + data.json + i/*.webp
list.json           教程索引
```
