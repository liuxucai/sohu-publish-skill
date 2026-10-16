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
> 已验证案例：2026-09-23 首发成功；2026-10-12 多图改造；《陪表弟订婚车跑了两周…》2026-10-13 11:39
> 发布成功（3 图 + 创作声明 + `--cover` 封面走「正文图片」Tab 勾选，列表封面缩略图生效，状态「审核中」）。

### 环境依赖

| 依赖 | 位置 | 说明 |
|------|------|------|
| Chrome 正式版 | 自动探测（`SOHU_CHROME_PATH` 可覆盖） | 不杀用户浏览器，另起独立 profile 实例 |
| playwright-core | 由 `isolated-browser/scripts/pathkit.js` 运行时自动探测 | 一般无需设置；要强制指定时设 `OPENCLAW_NODE_MODULES` |
| 搜狐号登录态 | 隔离 Chrome 共享 profile（`~/.chrome_qclaw_stable`） | 失效时在窗口中用手机验证码重登 |

### 完整流程（4 步）

```bash
# 1. 启动隔离 Chrome（共享基座；端口占用则自动复用，绝不 taskkill 用户浏览器）
node ../isolated-browser/scripts/launch.js "https://mp.sohu.com"
# WorkBuddy 沙箱环境需保活：run_in_background 跑 node ../isolated-browser/scripts/launch.js && sleep 7200

# 2. 探测登录态 + 发布页结构（未登录则打开登录页让用户手动完成）
#    登录入口（手机验证码，与 mp.sohu.com 打通）：https://www.sohu.com/ucenter/message/reply
node scripts/sohu_probe.js --cdp 9222

# 3.（可选）标签匹配 + 配图挑选（统一走共享工具，见 isolated-browser/references/multi-image.md）
node ../isolated-browser/scripts/pick_images.js --keyword "婚车租车" --tags "婚庆用车,婚庆婚车车队" --top 3

# 4. 填稿发布（先试运行，确认截图后再加 --publish；⚠️ 填稿即自动存草稿，试运行会留废稿）
node scripts/sohu_publish_pw.js --article articles/current.json --keyword "婚车租车" --tags "婚庆用车,婚庆婚车车队"
node scripts/sohu_publish_pw.js --article articles/current.json --image a.jpg --image b.jpg --image c.jpg   # 手动 3 张
node scripts/sohu_publish_pw.js --article articles/current.json --cover a.jpg --publish                     # 含封面（推荐=第1张配图，走「正文图片」Tab 勾选，零上传）
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
| 封面入口 | `.cover-button`「上传图片」 | 弹 `.el-dialog__wrapper.select-dialog` 弹窗（正文图片/本地上传/素材库 三 Tab），非 filechooser |
| 封面勾选 | 弹窗内 `.content-images .img-wrapper`（正文图片 Tab） | 选 1 张后「确定」（`p.button`，未选时带 `disable-button`）才可点 |
| 封面预览 | `.pic-cover` 的 **CSS background-image** | ⚠️ 不是 `<img>`，验证判据必须查 computedStyle 背景图 |
| 成功判断 | URL 离开 `addarticle` → `contentManagement/first/page` | — |

## 失败处理（详见 references/troubleshooting.md）

| 现象 | 解决 |
|------|------|
| 未能进入发布页（URL 跳登录） | 登录态失效 → 在调试窗口打开 `sohu.com/ucenter/message/reply` 手机验证码登录 |
| 点「发布」无反应/报必选声明 | 先勾选创作声明「含有AI生成内容」，再点 `li.publish-report-btn` |
| 点不到「确定」 | 用 `p.positive-button:visible`，不是 `button` |
| 配图上传失败 | `button.ql-image` → 弹窗 → `p.positive-button` 确认 → 轮询 `.ql-editor img[src^=http]` |
| `connect ECONNREFUSED 9222` | Chrome 调试实例没起 → 跑 `../isolated-browser/scripts/launch.js` |
| 找不到 playwright-core | 设 `OPENCLAW_NODE_MODULES` 指向含 playwright-core 的 node_modules；或跑 `node isolated-browser/scripts/pathkit.js --info` 看探测结果 |

## 配套资源

- [../isolated-browser/scripts/launch.js](../isolated-browser/scripts/launch.js) — 启动隔离 Chrome（公共基座，不杀用户浏览器）
- [scripts/sohu_probe.js](scripts/sohu_probe.js) — 登录态 + 发布页结构探测
- [scripts/sohu_publish_pw.js](scripts/sohu_publish_pw.js) — 主发布脚本（填稿/传图/发布/验证）
- [../isolated-browser/scripts/pick_images.js](../isolated-browser/scripts/pick_images.js) — 配图挑选（按标签从素材库挑 Top-N）；
  本 skill 原自带的 `scripts/match-tags.js` 已删除，统一用共享工具（见 [multi-image.md](../isolated-browser/references/multi-image.md)）
- [references/workflow.md](references/workflow.md) — 完整流程与 DOM 定位细节
- [references/troubleshooting.md](references/troubleshooting.md) — 全部踩坑记录与解决方法
- [SECURITY-AUDIT.md](SECURITY-AUDIT.md) — 安装时的安全审查记录
