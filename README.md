# 图文步骤教程站

把手机截图 + 文字说明，做成「一步一屏」的教程，发一条链接给对方，点开就能跟着做。

- 写作页：`/w/`（电脑、手机都能从头写）
- 教程库：`/mine/`
- 一份教程：`/t/<随机8位>/`
- 例子：`/t/qhftq5kz/`（随机路径，不是 demo——样例里有真人信息）

## 第一次使用：建一个 token

发布要往这个仓库写文件，所以需要一个 GitHub token：

1. 打开 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）
2. **Repository access** 选 *Only select repositories* → 只勾这一个仓库
3. **Permissions → Repository permissions → Contents** 设为 **Read and write**
   （其它权限一个都不用给）
4. 有效期建议 90 天，到期再建一个
5. 生成后复制，打开 `/w/` 点右上角 ⚙，填 GitHub 用户名、仓库名、分支、token，保存

token 只存在这台设备的浏览器里（localStorage），不会上传到任何地方。
换设备要重新填一次。万一泄露，去 GitHub 上点一下吊销即可——它碰不到你其它仓库。

## 怎么写一份教程

1. 打开 `/w/`，填标题
2. 加图：点「选择图片」／电脑上直接 `Ctrl+V` 粘贴／把文件拖进来
3. 每一步写说明（标题可不填）
4. 顺序不对：手机上用 `↑ ↓` 和 `⋯ → 移到第几步`；电脑上直接拖
5. 点「发布」，等 GitHub 构建完（通常几十秒），复制链接发出去

改已经发布的教程：`/mine/` → 编辑，改完重新发布，**链接不变**。

## 已知限制

| 限制 | 影响 | 怎么绕 |
|---|---|---|
| GitHub Pages 每小时最多 10 次构建（软限） | 一小时内反复发布会被卡 | 草稿只存本地，点发布才提交；别把发布当保存用 |
| 发布要能连上 `api.github.com` | 国内网络下手机可能发不出去 | 挂代理；或先存草稿，回电脑再发。失败不会丢草稿，也不会在仓库里留下半个教程 |
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
```

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
