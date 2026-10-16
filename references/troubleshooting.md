# 踩坑记录与解决方法（2026-09-23 安装 + 首次发布全过程）

> 每条都是实际撞到的问题，❌ 标记的方案实测行不通、已从本 skill 移除；✅ 是最终生效的方案。

## 一、发布流程内的坑

### 1. xb CLI 路线整体行不通 → 弃用
- ❌ xb CLI（`xb.cjs`）本机虽存在但 `config show` 报未初始化，无法驱动
- ❌ 即使能用：`xb type` 对 Quill contenteditable 完全不生效；上传弹窗流程也无法覆盖
- ✅ 改用 **playwright-core 直连 CDP 9222**（与知乎发布 skill 同路线），登录态来自 profile，无需账号密码。
  （2026-10-12 起启动脚本统一为 `../isolated-browser/scripts/launch.js`，本 skill 自带的 `launch-cdp-chrome.js` 已删除）

### 2. 用户浏览器正在运行，不能 taskkill
- ❌ 原仓库脚本启动前 `taskkill /F /IM chrome.exe`（会杀掉用户所有 Chrome，共 34 个进程）
- ✅ 另起独立 profile 的隔离实例（`../isolated-browser/scripts/launch.js`），与用户浏览器共存；端口占用则复用

### 3. 搜狐号登录态失效
- 现象：mp.sohu.com 右上角显示「登录/注册」
- ✅ 在调试窗口打开 `https://www.sohu.com/ucenter/message/reply`（主站手机验证码登录），用户手动完成后与 mp.sohu.com 打通
- ❌ `mp.sohu.com/sso/login` 的 SSO 页「畅游登录」入口层级深，不好找

### 4. 上传配图：`button.ql-image` 不触发 filechooser
- ❌ `waitForEvent("filechooser")` 等不到（打开的是「本地上传/素材库」弹窗）
- ✅ 点按钮 → 弹窗内完成本地上传 → 等缩略图与「已成功上传」提示 → 点 `p.positive-button` 确定 → 轮询 `.ql-editor img[src^=http]` 确认落位

### 5. 「确定」按钮不是 `<button>`
- ❌ `button:has-text("确定")` 会定位到一个隐藏 button，点击无效、弹窗不关
- ✅ `p.positive-button:visible`（搜狐弹窗按钮是 `<p>` 元素）

### 6. 发布按钮是 `<li>`
- ❌ `button:has-text("发布")` 定位不到
- ❌ `evaluate` 中对叶子文本元素 `.click()` 无效（点到内层文本节点）
- ✅ `li.publish-report-btn:visible`（与 xb 路线的「listitem」结论互相印证）

### 7. 创作声明是必选项
- 现象：点发布后 toast「请添加必选声明」，页面不动
- ✅ 先勾「含有AI生成内容」（AI 撰写文章如实勾选），再点发布。声明选项：无需声明/虚构演绎/AI生成/营销信息/转载

### 8. 长文不能用 keyboard.type 打进 Quill
- ❌ `keyboard.type` 打长正文会卡死（知乎 skill 同款问题）
- ✅ `innerHTML` + 派发 `input`/`change` 事件（标题框 `fill()` 正常）

### 9. fullPage 截图超时
- 现象：`page.screenshot` 偶发 60s 超时挂住
- ✅ 非 fullPage + `type:'jpeg', quality:70`，探测/检查类截图一律降级

### 10. 刚发布的文章 curl 直取 403
- 现象：`https://www.sohu.com/a/<id>_<uid>` 返回 403
- 结论：反爬/审核中，属正常；以后台内容管理页状态为准

## 二、环境层面的坑（Windows + WorkBuddy 沙箱）

### 11. Bash PATH 残缺
- 现象：`ls`、`curl`、`unzip` 报 not found
- ✅ 每条命令前补 `export PATH="/c/Users/.../PortableGit/versions/1.2.0/mingw64/bin:/c/Users/.../PortableGit/versions/1.2.0/usr/bin:$PATH"`

### 12. git-bash 调 node 必须用 Windows 风格路径
- ❌ `node /c/Users/.../script.js` → MODULE_NOT_FOUND（被拼成 `c:\c\Users\...`）
- ✅ `node "C:/Users/.../script.js"`

### 13. 沙箱回收 detached 子进程
- 现象：脚本里 spawn 的 Chrome（detached+unref）在命令结束后被杀
- ✅ `run_in_background` 跑 `node ../isolated-browser/scripts/launch.js && sleep 7200` 保活

### 14. 写 D 盘会被沙箱杀
- 现象：exit 1、日志戛然而止
- ✅ D 盘写入操作 `dangerouslyDisableSandbox: true`（或用 Write/Edit 文件工具直接写）

### 15. GitHub 下载超时/失败
- ✅ 依次尝试：`codeload.github.com/<owner>/<repo>/zip/refs/heads/main` → `gh-proxy.com/https://github.com/...` 镜像

### 16. 上游仓库凭据泄露（安全）
- 原仓库 SKILL.md / login.js / publish.js / workflow.md / commands.md 五处硬编码了作者本人手机号+密码
- ✅ 安装前全文件审查，全部清洗为「运行时读取环境变量/config.json」；凭据路线后来整体弃用，登录态走 profile

---

## 三、多图（3 张）改造（2026-10-12 实测）

**新增能力**：`--image` 支持**重复传参**；另新增 `--keyword` / `--tags` / `--image-top` / `--image-dir` / `--no-image`。
不给 `--image` 时由共享工具 `../../isolated-browser/scripts/post_images.js` 的 `planImages()` 自动挑 3 张并算锚点；
多张时**倒序插入**（避免段落索引漂移）。

### 17.【关键】上传后必须点弹窗「确定」，图才真正落进正文
- **现象**：`setInputFiles` 成功、弹窗里有缩略图，但编辑器正文里没有图。
- **原因**：搜狐的插图是**两段式**——先上传进 `.win-mask` 上传弹窗（此时图只在弹窗里），
  必须点弹窗的 **「确定」** 才写入正文。原先"等编辑器出现 `img[src^=http]`"的判据根本等不到。
- **解决**（现行实现）：
  1. 点 `button.ql-image` → 等 `.win-mask` 弹窗出现（**它本身不触发系统文件框**）；
  2. 弹窗内走「继续上传」+ `filechooser`，兜底直接喂 `.win-mask input[type=file]`；
  3. 轮询**弹窗内** `img` 数 > 0（缩略图出现 = 上传完成）；
  4. 点弹窗 **`.win-mask .positive-button`**（⚠️ 是 `<p>` 不是 `<button>`，须 `:visible` 过滤）；
  5. 轮询「弹窗已关 **且** 编辑器 `img` 数增加」才算成功，否则报错。
- **注意**：多图必须**逐张**走完整的 1~5 步，不能一次传 3 个文件。

### 18. 发布按钮点不到 —— 按钮在视口外，坐标点击落空
- **解决**：改用 `li.publish-report-btn:visible` + `scrollIntoViewIfNeeded()` + Playwright `click()`
  （locator 会自动滚动到可视区），不要再手算坐标。

### 19. 点「发布」没反应 —— 创作声明是必选项（历史坑 #7 复现）
- **现象**：点发布后 toast 一闪而过「请添加必选声明」，页面不动。
- **解决**：发布前**先勾**「含有AI生成内容」：
  `page.locator('label.el-radio:has-text("含有AI生成内容")').first().scrollIntoViewIfNeeded().click()`。
- 确认框改为**循环处理最多 3 层**（可能连续弹多个「确定/确认」）。

### 实测结果（2026-10-12）
3 张配图 + 创作声明 + 发布成功（走共享隔离实例，profile `~/.chrome_qclaw_stable`）。
《婚车租车全攻略：主车怎么选、车队怎么排、费用怎么算》15:22 提交，状态「审核中」。

### 20. 内容管理页整页空白 + `document.body.innerText` 为 0 —— 腾讯防水墙滑块验证码（2026-10-12 晚新坑）
- **现象**：`firstpagemanage` 主框架 `htmlLen≈84022` 但 `bodyLen=0`、`#app` 只有 ~225 字符空壳，
  任何文本选择器都取不到内容，看似「页面僵死」。
- **根因**：页面上有一个可见 iframe `https://turing.captcha.gtimg.com/1/template/drag_ele.html`
  （**腾讯防水墙滑块验证码**），正文渲染被它拦住。反复自动化访问后很容易触发。
- **✅ 处理**：验证码**必须人工拖动滑块**（不要尝试脚本绕过，会加重风控）。
  排查口诀：`bodyLen=0` 且 `htmlLen` 很大 → 先列**可见 iframe**，见 `turing.captcha.gtimg.com`
  即是验证码墙，别再在主框架里找选择器。
- **注意**：这不是登录态失效——URL 仍在 `mp.sohu.com` 工作台域内，
  `check-login.js` 的「域名 + 无登录关键词」判定**会误报 ✅**；必要时把
  `/turing\.captcha|drag_ele/` 加进该平台的登录特征正则。

### 已证伪（勿再试）
| 做法 | 为什么不行 |
|---|---|
| 上传后"等编辑器里出现 http img" | 图先进弹窗；不点「确定」永远不会进正文 |
| 一次 `setInputFiles` 传 3 个文件 | 该弹窗按单张处理，必须逐张上传 + 逐张确定 |
| `button:has-text("确定")` 定位弹窗确定键 | 它渲染成 `<p class="positive-button">` |
| 手算坐标点发布按钮 | 按钮常在视口外，坐标落空；应用 locator 自动滚动 |
| 不勾创作声明直接发布 | 被静默拦截，只闪一下 toast |
| 内容页空白时反复 goto / 找选择器 | 先查可见 iframe，若是 `turing.captcha.gtimg.com` 就是验证码墙，人工过 |
| 封面弹窗里找 `.win-mask` 两段式上传 | 封面弹窗是 `.el-dialog__wrapper.select-dialog`（正文图片/本地上传/素材库 三 Tab），与正文配图弹窗不同体系 |
| 封面用 `img` 选择器判验证 | 预览图是 `.pic-cover` 的 CSS background-image，`img` 判据永远为空 |
| 封面必走「本地上传」 | 封面=某张正文配图时，「正文图片」Tab 直接勾选零上传，且天然与正文一致 |

### 封面（2026-10-13 实测，已脚本化 --cover）
- **入口**：发布页封面区 `.cover-title`「封面」+ 提示「如不填，系统将自动从文中摘取图片作为封面」；
  点 `.cover-button`「上传图片」弹出选择弹窗（⚠️ 不是 filechooser，也不走 .win-mask 两段式）。
- **弹窗结构**：`.el-dialog__wrapper.select-dialog` 内三个 Tab——
  「**正文图片**」（默认选中，直接列出正文已插图）／「本地上传」／「素材库」；
  底部提示「最多可选择1张封面图，已选择0张」，`p.button.disable-button`「确定」在勾选前**禁用**。
- **✅ 推荐路线**（零上传）：`--cover` 与某张正文配图相同 → 「正文图片」Tab 直接点对应
  `.content-images .img-wrapper` 缩略图 → 等「确定」解除禁用 → 点「确定」。
  封面不是正文图时才走「本地上传」Tab + 弹窗内 `input[type=file]`（兜底）。
- **【关键坑】封面预览是 CSS 背景图不是 `<img>`**：预览渲染在 `.pic-cover`（164×108）的
  `background-image: url(https://res.mp.sohu.com/...)` 上——任何 `img` 选择器判据**永远为空**；
  正确判据：`getComputedStyle(.pic-cover).backgroundImage` 含 `url(`。
- **验证口径**：发布后回内容管理页，条目左侧显示封面缩略图（2026-10-13 11:39 首条实拍确认）。

### 21. 滑块验证码墙复现（2026-10-13，坑 #20 的复发确认）
- 发布完成回到 first/page 时截图正常；随后再次访问内容管理页即被 `turing.captcha.gtimg.com`
  滑块墙拦截（`bodyLen=0`）。确认：**反复自动化访问必然触发**，人工拖滑块前不要重试。
- 副作用：3 次试运行在草稿箱留了 3 条同名废稿（每次 `sohu_publish_pw.js` 填稿即自动存草稿，
  无论是否 `--publish`）——**试运行有留草稿的副作用**，正式发布后应回草稿箱清理；
  被滑块墙拦住时先人工过墙再删。
