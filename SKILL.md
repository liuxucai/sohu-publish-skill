---
name: sohu-publisher
description: 搜狐号（mp.sohu.com）文章自动发布流程。playwright-core 直连 Chrome CDP（9222），完成登录态检查、填标题、填正文、上传配图、勾创作声明、发布验证。适用于 Windows + Chrome 环境。触发词：搜狐号发布、sohu、发布文章到搜狐号。
agent_created: true
---

# 搜狐号文章自动发布 Skill

> **来源与安全说明**：源自开源仓库 https://github.com/liuxucai/sohu-publish-skill，安装时已做安全清洗：
> 移除了原作者硬编码在源码中的搜狐账号密码（上游仓库曾公开泄露手机号与密码），删除了依赖 xb CLI 的旧路线（本机实测不可用）。
> 若从上游更新，务必重新检查凭据泄露问题；**禁止**把真实账号密码写进任何文件或提交到仓库。

## 技术路线（2026-09-23 本机实测发布成功）

**playwright-core 直连 Chrome CDP**，不用 xb CLI（未初始化、不支持上传弹窗流程），不需要账号密码（登录态来自调试 profile）。

### 环境依赖

| 依赖 | 位置 | 说明 |
|------|------|------|
| Chrome 正式版 | 自动探测（`SOHU_CHROME_PATH` 可覆盖） | 不杀用户浏览器，另起独立 profile 实例 |
| playwright-core | `~/.workbuddy/binaries/node/workspace/node_modules` | 设 `OPENCLAW_NODE_MODULES` 指向该目录 |
| 搜狐号登录态 | 调试 profile（`~/.workbuddy/skills/sohu-publisher/profiles/chrome`） | 失效时在窗口中用手机验证码重登 |

### 完整流程（4 步）

```bash
# 1. 启动独立调试 Chrome（端口占用则自动复用，绝不 taskkill 用户浏览器）
node scripts/launch-cdp-chrome.js --port 9222
# WorkBuddy 沙箱环境需保活：node scripts/launch-cdp-chrome.js && sleep 7200（run_in_background）

# 2. 探测登录态 + 发布页结构（未登录则打开登录页让用户手动完成）
#    登录入口（手机验证码，与 mp.sohu.com 打通）：https://www.sohu.com/ucenter/message/reply
node scripts/sohu_probe.js --cdp 9222

# 3.（可选）标签匹配 + 配图挑选
node scripts/match-tags.js <article.json> <tag.txt> <pic-tag.txt> --pic-dir <图片目录> --out <report.json>

# 4. 填稿发布（先试运行，确认截图后再加 --publish）
node scripts/sohu_publish_pw.js --article articles/current.json --image <配图.jpg> --image-at 3
node scripts/sohu_publish_pw.js --article articles/current.json --image <配图.jpg> --publish
```

### 文章 JSON 格式

```json
{ "title": "文章标题（5-72 字）", "body": ["第一段", "第二段", "..."] }
```

参考 [templates/article.json](templates/article.json)（模板）与 [articles/current.json](articles/current.json)（最近发布实例）。

## DOM 关键定位（实测沉淀，见 references/workflow.md）

| 元素 | 定位 | 坑 |
|------|------|-----|
| 标题输入框 | `input[placeholder*="请输入标题"]` | `fill()` 有效 |
| 正文编辑器 | `.ql-editor`（Quill） | `innerHTML` + input 事件；`keyboard.type` 会卡死 |
| 配图按钮 | 工具栏 `button.ql-image` | **不是** filechooser，打开「本地上传/素材库」弹窗 |
| 上传弹窗确定 | `p.positive-button` | ⚠️ 是 `<p>` 不是 `<button>`，须 `:visible` 过滤 |
| 发布按钮 | `li.publish-report-btn` | ⚠️ 是 listitem 不是 button |
| 创作声明 | 文本「含有AI生成内容」的叶子元素 | **必选**，不勾 toast 报「请添加必选声明」 |
| 成功判断 | URL 离开 `addarticle` → `contentManagement/first/page` | — |

## 失败处理（详见 references/troubleshooting.md）

| 现象 | 解决 |
|------|------|
| 未能进入发布页（URL 跳登录） | 登录态失效 → 在调试窗口打开 `sohu.com/ucenter/message/reply` 手机验证码登录 |
| 点「发布」无反应/报必选声明 | 先勾选创作声明「含有AI生成内容」，再点 `li.publish-report-btn` |
| 点不到「确定」 | 用 `p.positive-button:visible`，不是 `button` |
| 配图上传失败 | `button.ql-image` → 弹窗 → `p.positive-button` 确认 → 轮询 `.ql-editor img[src^=http]` |
| `connect ECONNREFUSED 9222` | Chrome 调试实例没起 → 跑 `launch-cdp-chrome.js` |
| 找不到 playwright-core | 设 `OPENCLAW_NODE_MODULES=~/.workbuddy/binaries/node/workspace/node_modules` |

## 配套资源

- [scripts/launch-cdp-chrome.js](scripts/launch-cdp-chrome.js) — 启动独立调试 Chrome（不杀用户浏览器）
- [scripts/sohu_probe.js](scripts/sohu_probe.js) — 登录态 + 发布页结构探测
- [scripts/sohu_publish_pw.js](scripts/sohu_publish_pw.js) — 主发布脚本（填稿/传图/发布/验证）
- [scripts/match-tags.js](scripts/match-tags.js) — 文章标签匹配 + 配图加权挑选（不匹配则随机）
- [references/workflow.md](references/workflow.md) — 完整流程与 DOM 定位细节
- [references/troubleshooting.md](references/troubleshooting.md) — 全部踩坑记录与解决方法
- [SECURITY-AUDIT.md](SECURITY-AUDIT.md) — 安装时的安全审查记录
