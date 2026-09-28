# 搜狐号发布完整流程（playwright-core 直连 CDP，2026-09-23 实测）

> 旧的 xb CLI 路线（lib.js/login.js/publish.js、snapshot+fill+eval 命令流）在本机无法使用（xb CLI 未初始化），
> 且不支持上传弹窗流程，已删除。本文只记录实测走通的路线。

## 阶段 0：启动调试 Chrome

```bash
node scripts/launch-cdp-chrome.js --port 9222
```

- 独立 `user-data-dir`（`~/.workbuddy/skills/sohu-publisher/profiles/chrome`），**与用户日常浏览器共存**
- 端口已监听则直接复用
- WorkBuddy 沙箱会回收 detached 子进程 → 以 `run_in_background` 跑 `node scripts/launch-cdp-chrome.js && sleep 7200` 保活

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

`button.ql-image` 点击后**不会**触发 filechooser，而是打开「本地上传 / 素材库」弹窗。实测流程：

1. 点 `.ql-editor` 第 N 段落定位光标（`--image-at N`，1-based）
2. 点工具栏 `button.ql-image`
3. 弹窗内走本地上传（脚本内含 filechooser / hidden input 双兜底）
4. 等待弹窗显示「已成功上传 N 张图片」、缩略图出现（图片自动同步进素材库，每日上限 200 张）
5. 点弹窗「确定」——**它是 `p.positive-button`，不是 `<button>`**：
   ```js
   await page.locator('p.positive-button:visible').first().click();
   ```
6. 验证落位：轮询 `.ql-editor img`，`src` 以 `http` 开头且无「上传中」字样 → 图片已上传至搜狐 CDN 并插入正文

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

## 附：标签匹配与配图挑选（match-tags.js）

```bash
node scripts/match-tags.js <article.json> <tag.txt> <pic-tag.txt> --pic-dir <图片目录> --out <report.json>
```

- 先按正文关键词证据从 `tag.txt` 筛文章标签（可多个）
- 再与 `pic-tag.txt` 各图标签加权评分（婚庆类标签高权重 + 婚庆业务图领域加成 +8）
- 所有图片 0 分 → 随机挑一张
- 评分规则在脚本头部 `ARTICLE_TAG_RULES` 维护，换业务领域时改这里
