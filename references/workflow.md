# 搜狐号发布完整流程（playwright-core 直连 CDP，2026-09-23 实测）

> 旧的 xb CLI 路线（lib.js/login.js/publish.js、snapshot+fill+eval 命令流）在本机无法使用（xb CLI 未初始化），
> 且不支持上传弹窗流程，已删除。本文只记录实测走通的路线。

## 阶段 0：启动隔离 Chrome（共享基座）

```bash
node ../isolated-browser/scripts/launch.js "https://mp.sohu.com"
```

- profile 固定 `~/.chrome_qclaw_stable`（isolated-browser 的公共隔离实例），**与用户日常浏览器共存**
- 端口已监听则直接复用
- WorkBuddy 沙箱会回收 detached 子进程 → 以 `run_in_background` 跑 `node ../isolated-browser/scripts/launch.js && sleep 7200` 保活

> ⚠️ 变更说明（2026-10-12）：本 skill 原自带的 `scripts/launch-cdp-chrome.js` 使用
> skill 目录下的专属 profile，已删除。现统一复用 isolated-browser 的共享隔离实例
> （profile `~/.chrome_qclaw_stable`），搜狐号登录态也存于该 profile，首次需在该窗口登录一次。

## 阶段 1：登录态检查

```bash
node scripts/sohu_probe.js --cdp 9222
```

打开 `https://mp.sohu.com`，判断依据：无 `input[type=password]` 且页面文本无「登录/注册」→ 已登录。

**登录态失效时**：在调试窗口打开 `https://www.sohu.com/ucenter/message/reply`（搜狐主站用户中心，
手机验证码登录面板），由用户手动完成登录。此入口与 mp.sohu.com 创作平台打通，登录一次全站生效。
注意：`mp.sohu.com/sso/login` 的 SSO 页「畅游登录」入口层级深，主站 ucenter 入口更直接。

## 阶段 2：填稿（sohu_publish_pw.js 自动完成）

1. 打开 `https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1`
2. 标题：`input[placeholder*="请输入标题"]` → `fill()`（fill 失败兜底 Ctrl+A + keyboard.type）
3. 正文：`.ql-editor` 设 `innerHTML`（`<p>段落</p>` 拼接）+ 派发 `input`/`change` 事件
   - 返回 `SET_LEN_<字数>` 表示成功
   - ❌ `keyboard.type` 往 Quill 打长文会卡死，不要用

## 阶段 3：上传配图（核心坑区）

`button.ql-image` 点击后**不会**触发 filechooser，而是打开「本地上传 / 素材库」弹窗（`.win-mask`）。
**多张必须逐张走完整流程**（弹窗按单张处理）。每张的实测步骤：

1. 点 `.ql-editor` 第 N 段落定位光标（锚点来自 `planImages()` 的 `slots`，多张时自动均分）
2. 点工具栏 `button.ql-image` → 等 `.win-mask` 弹窗出现
3. 弹窗内走本地上传（脚本内含「继续上传」+ filechooser / 弹窗内 `input[type=file]` 双兜底）
4. 轮询**弹窗内** `img` 数 > 0 —— 缩略图出现 = 上传完成（图片自动同步进素材库，每日上限 200 张）
5. **点弹窗「确定」——图此刻才真正写入正文**（不点则图只留在弹窗里）：
   它是 **`<p class="positive-button">`，不是 `<button>`**，须 `:visible` 过滤：
   ```js
   await page.locator('.win-mask p.positive-button:visible').first().click();
   ```
6. 验证落位：轮询「**弹窗已关闭 且** `.ql-editor img` 数增加」→ 图片已上传至搜狐 CDN 并插入正文
7. 多张时**倒序**处理（先插后面的段落，避免前面插图导致索引漂移）

> 完整踩坑（含"上传后必须点确定""发布按钮在视口外""创作声明必勾"）见
> [troubleshooting.md](troubleshooting.md) 第三节。

## 阶段 4：发布

1. **必须先勾选创作声明**（必选项，不勾 toast 报「请添加必选声明」）。
   找到叶子文本「含有AI生成内容」，点其父级可点击容器。AI 撰写的文章应如实勾选此项。
   其他选项：无需声明 / 虚构演绎 / 营销信息 / 转载。
2. 点发布按钮：
   ```js
   await page.locator('li.publish-report-btn:visible').first().click();
   ```
   ⚠️ 是 `<li>`（listitem），`button:has-text("发布")` 定位不到；`evaluate` 里对叶子元素 `.click()`
   也不可靠（可能点到内层文本节点），用 playwright locator 真实点击。
3. 若出现确认框，点 `p.positive-button`。
4. 成功判断：URL 在 30 秒内离开 `addarticle`，跳转到 `contentManagement/first/page`（内容管理页）。
5. 文章链接可在管理页行内找到预览链接（`articlepreview?id=<id>`），公开链接形如
   `https://www.sohu.com/a/<id>_<userId>`。刚发布 curl 直取可能 403（反爬/审核中），属正常。

## 附：标签匹配与配图挑选（统一走共享工具）

本 skill 原自带的 `scripts/match-tags.js`（婚庆领域硬编码评分规则）**已删除**——
它是「每个平台各自发明一套挑图逻辑」的历史产物，与统一约定冲突。现统一用
`isolated-browser/scripts/` 下的共享工具：

```bash
# 挑配图（先 tag.txt 匹配文章标签 → 再按标签从 pic-tag.txt 挑 Top-N，默认 3 张）
node ../isolated-browser/scripts/pick_images.js --keyword "婚车租车" --tags "婚庆用车,婚庆婚车车队" --top 3

# 发布脚本内部自动调用 post_images.js planImages() 规划插入锚点
node scripts/sohu_publish_pw.js --article articles/current.json \
  --keyword "婚车租车" --tags "婚庆用车,婚庆婚车车队" [--image a.jpg --image b.jpg --image c.jpg]
```

完整的跨平台约定（参数命名、锚点算法、素材目录探测顺序）见
[../../isolated-browser/references/multi-image.md](../../isolated-browser/references/multi-image.md)。
