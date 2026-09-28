# 踩坑记录与解决方法（2026-09-23 安装 + 首次发布全过程）

> 每条都是实际撞到的问题，❌ 标记的方案实测行不通、已从本 skill 移除；✅ 是最终生效的方案。

## 一、发布流程内的坑

### 1. xb CLI 路线整体行不通 → 弃用
- ❌ xb CLI（`xb.cjs`）本机虽存在但 `config show` 报未初始化，无法驱动
- ❌ 即使能用：`xb type` 对 Quill contenteditable 完全不生效；上传弹窗流程也无法覆盖
- ✅ 改用 **playwright-core 直连 CDP 9222**（与知乎发布 skill 同路线），登录态来自 profile，无需账号密码

### 2. 用户浏览器正在运行，不能 taskkill
- ❌ 原仓库脚本启动前 `taskkill /F /IM chrome.exe`（会杀掉用户所有 Chrome，共 34 个进程）
- ✅ 另起独立 profile 的调试实例（`launch-cdp-chrome.js`），与用户浏览器共存；端口占用则复用

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
- ✅ `run_in_background` 跑 `node scripts/launch-cdp-chrome.js && sleep 7200` 保活

### 14. 写 D 盘会被沙箱杀
- 现象：exit 1、日志戛然而止
- ✅ D 盘写入操作 `dangerouslyDisableSandbox: true`（或用 Write/Edit 文件工具直接写）

### 15. GitHub 下载超时/失败
- ✅ 依次尝试：`codeload.github.com/<owner>/<repo>/zip/refs/heads/main` → `gh-proxy.com/https://github.com/...` 镜像

### 16. 上游仓库凭据泄露（安全）
- 原仓库 SKILL.md / login.js / publish.js / workflow.md / commands.md 五处硬编码了作者本人手机号+密码
- ✅ 安装前全文件审查，全部清洗为「运行时读取环境变量/config.json」；凭据路线后来整体弃用，登录态走 profile
