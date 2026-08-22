# agent-browser 命令参考（isolated-browser 路线）

通过 isolated-browser skill 拉起隔离 Chrome，再用全局 `agent-browser` CLI 经 `--cdp` 直连驱动。**所有调用必须封装在 Node.js 脚本中执行**，避免 PowerShell 中文乱码。注意：只传 `--cdp`，**不要**传 `--profile`（会挂起卡死）。

---

## 基本格式

```javascript
// Node.js 封装（lib.js 中的 ab()）
const AB = process.env.AGENT_BROWSER_PATH || 'agent-browser'; // 期望在 PATH 中，或用 `where agent-browser` 解析
const CDP_PORT = 9222;

function ab(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(AB, ['--cdp', String(CDP_PORT), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true, // Windows 下执行 .cmd 需要 shell 解释
    });
    let out = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} reject(new Error('timeout')); }, timeout);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    proc.on('error', reject);
  });
}

// 辅助函数
async function snapshot() {
  const r = await ab(['snapshot', '-i'], 20000);
  return r.out || ''; // 纯文本 ref 列表，与 xb 同格式
}

async function getUrl() {
  const r = await ab(['get', 'url'], 10000);
  return (r.out || '').trim(); // 纯文本 URL（非 JSON）
}
```

---

## 常用命令

### 打开 URL

```javascript
await ab(['open', 'https://mp.sohu.com'], 25000);
await sleep(3000);
```

### 获取 snapshot

```javascript
const snap = await snapshot();
// snap 是纯文本，每行一个元素，含 ref（与 xb 同格式）
// 示例：
// - textbox "请输入邮箱/手机号" [ref=e20]
// - checkbox "我已阅读并同意" [ref=e22]
// - button "登录" [ref=e13]
// - listitem "发布" [level=1, ref=e63]
```

### 获取当前 URL

```javascript
const url = await getUrl(); // 纯文本，如 https://mp.sohu.com/...
```

### 填写表单（标准 HTML input，登录页用）

```javascript
// fill 参数直接写值，不加任何引号！
await ab(['fill', '@e20', '13414054304'], 15000);
await ab(['fill', '@e21', '密码'], 15000);
```

### 点击元素

```javascript
await ab(['click', '@e22'], 15000);          // 复选框（协议）
await ab(['click', '@e13'], 15000);          // 按钮
await ab(['click', '@e63'], 15000);          // listitem 发布
```

### 截图

```javascript
const r = await ab(['screenshot', 'C:\\path\\out.png'], 15000);
// code === 0 表示成功，图片写入指定路径
```

### 执行 JavaScript

```javascript
// eval --base64：JS 代码 base64 编码后传入
// 返回值 JSON-stringified（需 JSON.parse 还原），如 "搜狐"
const script = `(function() { return document.title; })()`;
const r = await ab(['eval', '--base64', Buffer.from(script).toString('base64')], 15000);
const raw = (r.out || '').trim();
let result = raw;
try { result = JSON.parse(raw); } catch (e) {}
```

---

## 搜狐号常用 ref（经验证）

### 发布页

| 元素 | 搜索关键词 | 典型 ref | 说明 |
|------|-----------|---------|------|
| 标题输入框 | `textbox` 含 `标题` | 变化 | 每次 snapshot 重新分配 |
| 正文区域 | `[contenteditable="true"]` | 变化 | **通过 JS eval 访问**，不用 ref |
| 发布按钮 | `listitem "发布"` | e63 | **不是 button，是 listitem** |
| 定时发布 | `listitem "定时发布"` | e64 | |
| 存草稿 | `listitem "存草稿"` | e65 | |
| 确认框确定 | `button "确定"` | e2 | 发布后弹出 |

> ⚠️ 所有 ref 每次 snapshot 会重新分配，上表仅为参考，**必须从最新 snapshot 解析**

---

## ref 解析方法

```javascript
// 标题 ref 解析
const snap = await snapshot();
let titleRef = '';
let inIframe = false;
for (const line of snap.split('\n')) {
  if (/Iframe\s*\[ref=/.test(line)) { inIframe = true; continue; }
  if (inIframe) continue;
  if (/标题/.test(line) && /\[ref=(e\d+)\]/.test(line)) {
    const m = line.match(/\[ref=(e\d+)\]/);
    if (m) { titleRef = m[1]; break; }
  }
}

// 发布按钮 ref 解析
let pubRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { pubRef = m[1]; break; }
  }
}
```

---

## 正文写入（唯一有效方法）

agent-browser `type` 不生效，**必须用 JS eval**（注意返回值 JSON.parse）：

```javascript
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
try { resultData = JSON.parse(raw); } catch (e) {}
// resultData 应为 "SET_LEN_xxx" 格式，表示正文长度
```

---

## 验证码 / 登录检测

遵循 isolated-browser「登录不填密码」原则：不自动填密码，登录由用户手动完成。

```javascript
const snap = await snapshot();
// 未登录态：页面同时含「登录」与「注册」
const needLogin = snap.includes('登录') && snap.includes('注册');
// 验证码关键词
const captchaKeywords = ['滑块', '拼图', '图形验证', '短信验证码', '拖动'];
const hasCaptcha = captchaKeywords.some(k => snap.includes(k));

if (needLogin) {
  console.log('请在浏览器中手动登录搜狐号...');
  // 轮询等待登录态（sohuLogin 内部最长 10 分钟）
}
if (hasCaptcha) {
  console.log('验证码：请在浏览器中完成验证');
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
  // 暂停，等待用户在浏览器处理
}
```

---

## 发布流程（经验证可工作）

```javascript
// 1. 点击发布（listitem "发布"）
await ab(['click', '@' + pubRef], 15000);
await sleep(5000);

// 2. 确认框
const snap2 = await snapshot();
if (snap2.includes('确定')) {
  for (const line of snap2.split('\n')) {
    if (line.includes('button') && line.includes('确定')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) {
        await ab(['click', '@' + m[1]], 15000);
        await sleep(5000);
        break;
      }
    }
  }
}

// 3. 检查成功
const url = await getUrl();
if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
}
```
