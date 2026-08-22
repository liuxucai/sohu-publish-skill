---
name: sohu-publisher
description: 搜狐号（mp.sohu.com）文章自动发布流程。通过 isolated-browser skill 拉起隔离 Chrome，再用 agent-browser --cdp 直连驱动完成登录、填标题、填正文、发布。适用于 Windows + Chrome + isolated-browser 环境。触发词：搜狐号发布、sohu、发布文章到搜狐号。
---

# 搜狐号文章自动发布 Skill

## 适用场景

- 自动化将文章发布到搜狐号平台
- 复用同一发布流程处理多篇文章
- 批量发布内容

## 浏览器方案（关键选型）

本 skill 的浏览器启动与驱动**复用 [isolated-browser](../isolated-browser/SKILL.md) skill**，而不是 xb CLI：

| 路线 | 说明 |
|------|------|
| **isolated-browser（本 skill 采用）** | 拉起一个与用户默认 Chrome 完全隔离的独立 Chrome 实例（固定 `--user-data-dir`=~/.chrome_qclaw_stable + 独立 CDP 端口），用 `agent-browser --cdp` 直连驱动，绕开 xb 安全锁，不打扰用户现有浏览器。 |
| xb 托管（不采用） | xb 有安全锁：检测到用户 Chrome/Edge 在跑会拒绝另起实例，必须先关用户浏览器。手动 `exec chrome.exe` 拿用户实例是禁止的。 |

隔离实例由 `launchChrome()` 启动：`spawn(chrome, [...], {detached:true, stdio:'ignore'})` 后 `child.unref()`，实例常驻不随脚本退出被杀。优先调用 `../isolated-browser/scripts/launch.js`。

> **若 `isolated-browser` skill 未安装**：从 GitHub 安装 `https://github.com/liuxucai/isolated-browser-skill`（clone 或下载 ZIP 解压到 skills/isolated-browser），安装后即可调用其 `scripts/launch.js`。

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome（isolated-browser 找 `C:\Program Files\Google\Chrome\Application\chrome.exe`） |
| 控制工具 | 全局 `agent-browser` CLI（qclaw 自带，`.cmd` 优先） |
| 依赖 skill | `isolated-browser`（同工作区 `skills/isolated-browser`） |
| 运行环境 | Windows PowerShell，**不**支持 `&&` 链式语法 |
| 脚本语言 | Node.js（封装所有 agent-browser 调用，规避 PowerShell 中文乱码） |

## 核心流程

```
1. 拉起隔离 Chrome（isolated-browser：detached spawn + 独立 CDP 端口 9222）
2. 打开搜狐登录页（agent-browser --cdp open）
3. 登录：遵循「登录不填密码」原则 —— 由用户在浏览器手动登录，脚本只等待登录态
4. 验证码若出现 → 暂停，让用户在浏览器中完成验证
5. 打开发布页
6. 填标题（agent-browser fill，参数不加引号）
7. 填正文（JS eval 设置 innerHTML，agent-browser type 不生效）
8. 选「必选声明」（JS eval 点击隐藏 input，不选会被「请添加必选声明」拦截）
9. 发布（点击 listitem "发布"）
10. 检查 URL 确认成功（跳离 addarticle 即成功，后台列表异步不立即刷新）
```

完整步骤详见 [references/workflow.md](references/workflow.md)

## 关键难点

### 1. Chrome 启动方式（isolated-browser 路线）

用 `spawn` + `unref` 以 detached 方式启动常驻 Chrome，**绝不能**用 `execSync(detached)` —— `execSync` 会阻塞等待子进程 stdout 关闭，而 Chrome 常驻不退出，脚本会卡死在启动步骤。

```js
// ✅ 正确：spawn + unref（isolated-browser 同款）
const child = spawn(chrome, [
  '--new-instance',
  `--user-data-dir=${ISO_PROFILE}`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--no-first-run', '--no-default-browser-check',
  'https://mp.sohu.com',
], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();

// ❌ 错误：execSync 会永久阻塞
execSync(`"${chromePath}" --remote-debugging-port=9222 ...`, { detached: true, stdio: 'ignore' });
```

### 2. agent-browser 调用（--cdp，不传 --profile）

所有浏览器动作经 `agent-browser --cdp 9222 <cmd>`。实测同时传 `--profile` 会挂起卡死，只传 `--cdp`。

`agent-browser --cdp` 的输出格式（与 xb 不同）：
- `get url` → 纯文本 URL（非 JSON）
- `snapshot -i` → 纯文本 ref 列表（与 xb 同格式，含 `ref=eXX`）
- `eval --base64` → JSON-stringified 值（如 `"搜狐"`），需 `JSON.parse` 还原
- `fill` / `click` → `✅ Done`

### 3. fill 命令**不加引号**

搜狐号使用标准 HTML textbox，**fill 命令参数不加引号**：

```js
// ✅ 正确：fill 参数直接写值，不加引号
await ab(['fill', '@' + ref, title], 15000);

// ❌ 错误：fill 加了引号会原样输入
await ab(['fill', '@' + ref, '"' + title + '"']);
```

### 4. 验证码 / 登录必须暂停让用户处理

遵循 isolated-browser「登录不填密码」原则：本 skill **不自动填账号密码**，登录交给用户在浏览器手动完成。脚本只负责打开登录页并等待登录态就绪；验证码同样暂停由用户处理。

检测关键词：`滑块`、`拼图`、`图形验证`、`短信验证码`、`登录`+`注册`（表示处于未登录态）。

```js
// ✅ 正确：检测到未登录态则提示用户手动登录，脚本轮询等待
const snap = await snapshot();
if (snap.includes('登录') && snap.includes('注册')) {
  console.log('请在浏览器中手动登录搜狐号...');
  await sohuLogin(); // 内部轮询等待登录态，最长 10 分钟
}
```

### 5. 正文写入：agent-browser type 不生效，必须用 JS eval

**搜狐号正文编辑器是 contenteditable，`agent-browser type` 命令完全不生效！**

用 JS eval 直接设置 innerHTML（注意 eval 返回值需 `JSON.parse`）：

```js
// ✅ 唯一有效方案
const html = article.body.map(p => '<p>' + p + '</p>').join('');

const setScript = `(function() {
  var editors = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editors.length; i++) {
    var el = editors[i];
    if (el.offsetHeight > 50 && el.offsetWidth > 200) {
      el.innerHTML = ${JSON.stringify(html)};
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'SET_LEN_' + el.textContent.length;
    }
  }
  return 'NOT_FOUND';
})()`;

const r = await ab(['eval', '--base64', Buffer.from(setScript).toString('base64')], 15000);
const raw = (r.out || '').trim();
let resultData = raw;
try { resultData = JSON.parse(raw); } catch (e) {} // eval 返回 JSON-stringified
// resultData 形如 "SET_LEN_1234"
```

### 6. 发布按钮是 `listitem` 不是 `button`

搜索发布按钮时用 `listitem "发布"`，**不是 button**：

```js
// ✅ 正确
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) pubRef = m[1];
  }
}
```

### 7. 发布成功判断

URL 不再包含 `addarticle` 即为发布成功：

```js
const url = await getUrl();
// 发布成功：https://mp.sohu.com/mpfe/v4/contentManagement/first/page
// 发布失败：https://mp.sohu.com/.../addarticle?contentStatus=1
if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
}
```

### 8. ⚠️ 必选声明（创作声明）是发布前必填项（2026-08-22 实测新增）

搜狐号发布页有一组**必填的「创作声明（必选声明）」radio 组**：无需声明 / 含有AI生成内容 / 含有虚构演绎内容 / 含有营销信息 / 内容为转载 / 内容为个人观点 / 引用声明。

**点发布前必须先选一项，否则弹「请添加必选声明」且页面不前进。** 默认选「无需声明」最省事。

**关键坑：Element UI 的 radio 不能用坐标点击，也不能 `label.click()`——必须用隐藏 `input.el-radio__original` 的 `.click()`（Vue 监听其 change 才会更新 v-model）：**

```js
// ✅ 唯一有效方案（页面内执行）
const chooseDecl = `(function(){
  var labels=[].slice.call(document.querySelectorAll('.el-radio'));
  for(var i=0;i<labels.length;i++){
    if((labels[i].innerText||'').trim().indexOf('无需声明')>=0){
      var inp=labels[i].querySelector('input.el-radio__original');
      if(inp){ inp.click(); return 'SELECTED'; }
    }
  }
  return 'NOT_FOUND';
})()`;
await ab(['eval','--base64', Buffer.from(chooseDecl).toString('base64')], 15000);
```

> 实测：`clickCoords` 点 radio label 中心、以及 `label.click()` 都**不会改变** `input.checked`（仍为 0）；只有 `input.el-radio__original.click()` 有效。

> 成功判据补充：点发布后 URL 跳回 `contentManagement/first/page` 且无 `el-message` 报错即成功。搜狐号后台列表是异步/分页的，**发完不会立刻在列表出现该文**，不要据此误判失败；必要时隔几分钟在后台手动核对。

### 9. 参考元素 ref 从 snapshot 解析

搜狐号页面元素 ref 每次 snapshot 会重新分配，**必须从最新 snapshot 解析**。

## 使用方法

### 方式一：用户给关键词/提示词，由 Agent（或可选 LLM）生成（推荐）

文章标题与正文**不硬编码**，由用户提供关键词或提示词实时生成：

- **标准做法（无需任何 API Key）**：用户在对话里给出关键词/提示词（如「凑数」「我认为」），由当前 Agent（QClaw 模型）直接写成标题+正文，再通过 `--title` / `--body` 传给脚本（`--body` 用分号或换行分隔段落，或 JSON 数组）。
- **可选 LLM 生成**：若配置了 `SOHU_LLM_API_KEY` 等环境变量，也可让脚本内 `generateArticle()` 调 OpenAI 兼容的 Chat API 生成；本环境默认未配置，故标准用法是 Agent 代写。

```bash
# Agent 已生成好标题+正文，直接传入（最常用，无需 LLM）
node scripts/publish.js --title="标题" --body="第一段;第二段;第三段"

# 可选：让脚本内 LLM 根据提示词生成（需配置 SOHU_LLM_API_KEY）
node scripts/publish.js --prompt="谈谈年轻人为什么不爱存钱"

# 不传参数：若已配置 LLM 则交互式询问关键词；否则提示需 --title/--body
node scripts/publish.js
```

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `SOHU_LLM_API_KEY` | LLM 密钥（可选，未配则走 Agent 代写） | 无 |
| `SOHU_LLM_BASE_URL` | API 基地址 | `https://api.openai.com/v1` |
| `SOHU_LLM_MODEL` | 模型名 | `gpt-4o-mini` |

### 方式二：登录态已就绪时直接发布

若已用 `node scripts/login.js` 手动登录过（isolated profile 保留登录态），发布时无需再登录：

```bash
node scripts/publish.js --title="..." --body="..."
```

### 方式三：使用可复用辅助函数

```js
const { ensureChrome, sohuLogin, openPublishPage, fillTitle, fillBody, publish, cleanup, generateArticle } = require('./scripts/lib.js');

// 1. 根据关键词生成文章
const { title, body } = await generateArticle({ prompt: '年轻人为什么不爱存钱' });

// 2. 启动隔离 Chrome，手动登录（不填密码）
await ensureChrome();
await sohuLogin();

// 3. 发布文章
await openPublishPage();
await fillTitle(title);
await fillBody(body);
await publish();
await cleanup();
```

## 输出位置

- 发布结果：搜狐号后台（isolated profile 登录态保留，可长期使用）
- 脚本产物：`%TEMP%/sohu_iso/sohu_*.png`（发布完成后自动清理）
- 状态文件：`sohu_status.txt`（工作目录）
  - `NEED_USER_VERIFY` = 需用户处理验证码
  - `NEED_USER_LOGIN` = 需用户手动登录
  - `LOGIN_OK` = 已登录
  - `PUBLISHED` = 发布完成
- 日志：脚本 stdout

## 失败处理

| 错误 | 原因 | 解决方法 |
|------|------|---------|
| 隔离 Chrome 启动超时 | CDP 端口无响应 / Chrome 路径错 | 确认 Chrome 已安装，或设 `AGENT_BROWSER_EXECUTABLE_PATH` |
| agent-browser 命令挂起 | 同时传了 `--cdp` 和 `--profile` | 只传 `--cdp`，不传 `--profile` |
| 登录等待超时 | 用户未在 10 分钟内登录 | 在浏览器手动登录后重试 |
| 滑块/图形验证码 | 搜狐安全策略 | 暂停，用户在浏览器中完成验证 |
| 发布页打不开 | 未登录或登录态失效 | 重新手动登录 |
| 正文写入失败 | eval 返回值解析错 | 确认 eval 返回 `SET_LEN_xxx` |
| 发布被「请添加必选声明」拦截 | 未选必填的「创作声明」radio | 发布前用 `input.el-radio__original.click()` 选「无需声明」（见关键难点 8） |
| 列表未立即出现新文章 | 后台列表异步/分页 | 不代表失败；以 URL 跳离 addarticle + 无报错 toast 判成功，必要时隔几分钟手动核对 |

## 已知限制

- 封面设置流程尚未测试
- isolated profile 是全新的，没有用户默认浏览器的登录态，**首次需手动登录**
- fill 命令对标准 HTML textbox 有效（搜狐号登录页）
- 所有 agent-browser 调用必须封装在 Node.js 脚本中（PowerShell 中文乱码）
- captcha/登录检测：滑块/拼图/图形验证/短信验证/未登录态 任一出现都需用户介入

## 配套资源

- [scripts/lib.js](scripts/lib.js) — agent-browser 封装库（isolated-browser 路线）
- [scripts/publish.js](scripts/publish.js) — 完整发布脚本模板
- [scripts/login.js](scripts/login.js) — 独立登录脚本（手动登录）
- [templates/article.txt](templates/article.txt) — 文章模板
- [references/workflow.md](references/workflow.md) — 完整发布流程
- [references/troubleshooting.md](references/troubleshooting.md) — 问题排查
- [references/commands.md](references/commands.md) — agent-browser 命令参考
