---
name: sohu-publisher
description: 搜狐号（mp.sohu.com）文章自动发布流程。通过 xb CLI 驱动 Chrome 完成登录、填标题、填正文、设置封面、发布。适用于 Windows + Chrome + xb CLI v1.2.0 环境。触发词：搜狐号发布、sohu、发布文章到搜狐号。
---

# 搜狐号文章自动发布 Skill

## 适用场景

- 自动化将文章发布到搜狐号平台
- 复用同一发布流程处理多篇文章
- 批量发布内容

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome |
| 控制工具 | xb CLI v1.2.0 |
| 路径 | `C:\Users\菠萝\.qclaw\skills\xbrowser\scripts\xb.cjs` |
| 运行环境 | Windows PowerShell，**不**支持 `&&` 链式语法 |
| 脚本语言 | Node.js（封装所有 xb 调用，规避 PowerShell 中文乱码） |

## 核心流程

```
1. 启动 Chrome（Start-Process + execSync detached 方式）
2. 打开搜狐登录页
3. 勾选协议 → 填账号密码 → 点登录
4. 验证码在点登录之后才出现 → 有则暂停
5. 打开发布页
6. 填标题（xb fill）
7. 填正文（JS eval 设置 innerHTML，xb type 不生效）
8. 发布（点击 listitem "发布"）
9. 处理确认对话框 → 检查 URL 确认成功
```

完整步骤详见 [references/workflow.md](references/workflow.md)

## 关键难点

### 1. Chrome 启动方式

xb CLI v1.2.0 启动 Chrome 有时异常，**使用 Start-Process 方式**启动：

```js
// ✅ 正确：用 Start-Process 启动 Chrome
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profilePath = 'C:\\Users\\菠萝\\.qclaw\\tools\\xbrowser\\profiles\\chrome';
execSync(`"${chromePath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`, {
  windowsHide: true, detached: true, stdio: 'ignore'
});

// ❌ 避免：xb run --browser chrome 启动方式不稳定
```

### 2. fill 命令**不加引号**

搜狐号使用标准 HTML textbox，**fill 命令参数不加引号**：

```js
// ✅ 正确：fill 参数直接写值，不加引号
await xb(['run', '--browser', 'chrome', 'fill', '@e20', '13414054304']);
await xb(['run', '--browser', 'chrome', 'fill', '@e21', 'sohu.939.']);

// ❌ 错误：fill 加了引号会原样输入
await xb(['run', '--browser', 'chrome', 'fill', '@e20', '"13414054304"']);
```

### 3. 验证码必须暂停让用户处理

搜狐号登录流程中可能遇到三类验证码，**每一步都要检查，有验证码必须暂停**：

| 验证码类型 | 触发时机 | 处理方式 |
|-----------|---------|---------|
| 滑块拼图 | 登录表单填写后点登录 | 暂停，让用户在浏览器中拖动滑块 |
| 图形验证码 | 登录表单填写后点登录 | 暂停，让用户识别图片输入验证码 |
| 短信验证 | 账号密码正确后 | 暂停，让用户在手机查看验证码输入 |

检测关键词：`滑块`、`拼图`、`图形验证`、`短信验证码`

```js
// ✅ 正确：每步检查验证码，有则暂停
const snap = await snapshot();
if (snap.includes('滑块') || snap.includes('拼图') || snap.includes('图形验证') || snap.includes('短信验证码')) {
  console.log('=== 验证码 - 暂停让用户处理 ===');
  fs.writeFileSync('sohu_status.txt', 'NEED_USER_VERIFY', 'utf8');
  return; // 暂停，等待用户完成后再继续
}
```

### 4. 正文写入：xb type 不生效，必须用 JS eval

**搜狐号正文编辑器是 contenteditable，`xb type` 命令完全不生效！**

这是本次会话发现的最关键问题：
- 尝试了 `xb type` → 不生效，正文区域为空
- 尝试了 `fill iframe body` → 不生效
- 最终方案：**用 JS eval 直接设置 innerHTML**

```js
// ✅ 唯一有效方案
const html = article.body.map(p => '<p>' + p + '</p>').join('');

const setScript = `(function() {
  var editors = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editors.length; i++) {
    var el = editors[i];
    // 正文区域比摘要大，通过大小判断
    if (el.offsetHeight > 50 && el.offsetWidth > 200) {
      el.innerHTML = ${JSON.stringify(html)};
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'SET_LEN_' + el.textContent.length;
    }
  }
  return 'NOT_FOUND';
})()`;

const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64',
  Buffer.from(setScript).toString('base64')], 15000);
// 返回 "SET_LEN_xxx" 表示正文长度
```

### 5. 发布按钮是 `listitem` 不是 `button`

搜索发布按钮时用 `listitem "发布"`，**不是 button**：

```js
// ✅ 正确
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) pubRef = m[1];
  }
}

// ❌ 错误：搜索 button
if (line.includes('button') && line.includes('发布'))  // 找不到
```

### 6. 发布成功判断

URL 不再包含 `addarticle` 即为发布成功：

```js
const url = await getUrl();
// 发布成功：https://mp.sohu.com/mpfe/v4/contentManagement/first/page
// 发布失败：https://mp.sohu.com/.../addarticle?contentStatus=1
if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
}
```

### 7. 参考元素 ref 从 snapshot 解析

搜狐号页面元素 ref 每次 snapshot 会重新分配，**必须从最新 snapshot 解析**：

```js
// ✅ 正确：从 snapshot 文本动态查找 ref（用字符串包含，不用复杂正则）
const snap = await snapshot();

for (const line of snap.split('\n')) {
  if (line.includes('textbox') && line.includes('邮箱/手机号')) {
    phoneRef = line.match(/ref=(e\d+)/)?.[1];
  }
  if (line.includes('checkbox') && line.includes('我已阅读并同意')) {
    agreeRef = line.match(/ref=(e\d+)/)?.[1];
  }
  if (line.includes('button') && line.includes('"登录"')) {
    submitRef = line.match(/ref=(e\d+)/)?.[1];  // 取最后一个
  }
}
```

## 使用方法

### 方法一：使用完整脚本（推荐）

参考 [scripts/publish.js](scripts/publish.js) 完整发布脚本，修改其中的标题和正文变量后执行：

```bash
node scripts/publish.js
```

### 方法二：使用可复用辅助函数

```js
const { xb, sleep, snapshot, ensureChrome, sohuLogin, openPublishPage, fillTitle, fillBody, publish, cleanup } = require('./scripts/lib.js');

// 启动 Chrome 并登录
await ensureChrome();
await sohuLogin('13414054304', 'sohu.939.');

// 发布文章
await openPublishPage();
await fillTitle('文章标题');
await fillBody('正文内容...');
await publish();
await cleanup();
```

## 输出位置

- 发布结果：搜狐号后台（登录态保留）
- 脚本产物：工作目录 `screenshot-*.png`（发布完成后自动清理）
- 状态文件：`sohu_status.txt`
  - `NEED_USER_VERIFY` = 需用户处理验证码
  - `PUBLISH_PAGE_READY` = 发布页已就绪
  - `PUBLISHED` = 发布完成
- 日志：脚本 stdout

## 失败处理

| 错误 | 原因 | 解决方法 |
|------|------|---------|
| Chrome 启动后立即退出 | 配置文件被占用 | 关闭所有 chrome.exe 进程后重试 |
| fill 输入带双引号 | fill 参数格式错误 | fill 参数**不加**任何引号 |
| 登录失败：用户名或密码错误 | 账号密码错误 | 确认搜狐号账号密码 |
| 滑块/图形验证码 | 搜狐安全策略 | 暂停，用户在浏览器中完成验证 |
| 短信验证码 | 新设备登录 | 暂停，用户在手机查看短信输入验证码 |
| 发布页打不开 | 未登录或登录态失效 | 重新登录 |

详见 [references/troubleshooting.md](references/troubleshooting.md)

## 已知限制

- 封面设置流程尚未测试
- xb CLI v1.2.0 启动 Chrome 不稳定 → 使用 Start-Process 替代
- fill 命令对标准 HTML textbox 有效（搜狐号登录页）
- 所有 xb 调用必须封装在 Node.js 脚本中（PowerShell 中文乱码）
- captcha 检测：滑块/拼图/图形验证/短信验证 关键词任一出现都需暂停

## 配套资源

- [scripts/lib.js](scripts/lib.js) — xb CLI 封装库
- [scripts/publish.js](scripts/publish.js) — 完整发布脚本模板
- [scripts/login.js](scripts/login.js) — 独立登录脚本
- [templates/article.txt](templates/article.txt) — 文章模板
- [references/workflow.md](references/workflow.md) — 完整发布流程
- [references/troubleshooting.md](references/troubleshooting.md) — 问题排查
- [references/commands.md](references/commands.md) — xb CLI 命令参考
