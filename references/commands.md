# xb CLI 命令参考（搜狐号场景）

xb CLI v1.2.0。**所有 xb 调用必须封装在 Node.js 脚本中执行**，避免 PowerShell 中文乱码。

---

## 基本格式

```javascript
// Node.js 封装
function xb(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [XB_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, timeout);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    proc.on('error', reject);
  });
}

// 辅助函数
async function snapshot() {
  const r = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
  return JSON.parse(r.out).data?.result?.data?.snapshot || '';
}

async function getUrl() {
  const r = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
  return JSON.parse(r.out).data?.result?.data?.url || '';
}
```

---

## 常用命令

### 打开 URL

```javascript
await xb(['run', '--browser', 'chrome', 'open', 'https://mp.sohu.com'], 25000);
await sleep(5000);
```

### 获取 snapshot

```javascript
const snap = await snapshot();
// snap 是字符串，每行一个元素，含 ref
// 示例：
// - textbox "请输入邮箱/手机号" [ref=e20]
// - checkbox "我已阅读并同意" [ref=e22]
// - button "登录" [ref=e13]
// - listitem "发布" [level=1, ref=e63]
```

### 获取当前 URL

```javascript
const url = await getUrl();
```

### 填写表单（标准 HTML input，登录页用）

```javascript
// fill 参数直接写值，不加任何引号！
await xb(['run', '--browser', 'chrome', 'fill', '@e20', '13414054304']);
await xb(['run', '--browser', 'chrome', 'fill', '@e21', '密码']);
```

### 点击元素

```javascript
// 点击复选框（协议）
await xb(['run', '--browser', 'chrome', 'click', '@e22']);

// 点击 iframe body（聚焦正文编辑器，但 xb type 不生效）
await xb(['run', '--browser', 'chrome', 'click', 'iframe body']);

// 点击按钮
await xb(['run', '--browser', 'chrome', 'click', '@e13']);
```

### 按键

```javascript
// 回车（在 type 之后分段用，但正文写入应该用 JS eval）
await xb(['run', '--browser', 'chrome', 'press', 'Enter'], 10000);
```

### 截图

```javascript
const ssR = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
const ssPath = JSON.parse(ssR.out).data?.result?.data?.path || '';
```

### 执行 JavaScript

```javascript
// eval --base64：JS 代码 base64 编码后传入
// 返回值通过 JSON.parse(r.out).data?.result?.data 获取
const script = `(function() {
  return document.title;
})()`;

const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64',
  Buffer.from(script).toString('base64')], 15000);
const result = JSON.parse(r.out).data?.result?.data || '';
```

---

## 搜狐号常用 ref（经验证）

### 登录页

| 元素 | 搜索关键词 | 典型 ref | 说明 |
|------|-----------|---------|------|
| 手机号 | `textbox "请输入邮箱/手机号"` | e20 | |
| 密码 | `textbox "请输入密码"` | e21 | |
| 协议勾选 | `checkbox "我已阅读并同意"` | e22 | 缩进较深，需字符串包含查找 |
| 登录按钮 | `button "登录"`（第二个） | e13 | e3 是其他按钮，取较大 ref |
| 自动登录 | `checkbox "下次自动登录"` | e23 | 非必须 |

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
// 登录页 ref 解析（经验证正确）
const snap = await snapshot();
let phoneRef = '', pwdRef = '', agreeRef = '', submitRef = '';

for (const line of snap.split('\n')) {
  if (line.includes('textbox') && line.includes('邮箱/手机号')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) phoneRef = m[1];
  }
  if (line.includes('textbox') && line.includes('密码')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) pwdRef = m[1];
  }
  if (line.includes('checkbox') && line.includes('我已阅读并同意')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) agreeRef = m[1];
  }
  if (line.includes('button') && line.includes('"登录"')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) submitRef = m[1];  // 取最后一个匹配（e13 是真正的登录按钮）
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

xb type 不生效，**必须用 JS eval**：

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

const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64',
  Buffer.from(setScript).toString('base64')], 15000);
const result = JSON.parse(r.out).data?.result?.data || '';
// result 应为 "SET_LEN_xxx" 格式，表示正文长度
```

---

## 验证码检测

验证码在**点登录之后**才出现：

```javascript
await xb(['run', '--browser', 'chrome', 'click', '@' + submitRef], 10000);
await sleep(3000);

const snap = await snapshot();
const captchaKeywords = ['滑块', '拼图', '图形验证', '短信验证码', '拖动'];
const hasCaptcha = captchaKeywords.some(k => snap.includes(k));

if (hasCaptcha) {
  const ssR = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
  console.log('验证码截图:', JSON.parse(ssR.out).data?.result?.data?.path || '');
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
  return; // 暂停
}
```

---

## 发布流程（经验证可工作）

```javascript
// 1. 发布按钮
await xb(['run', '--browser', 'chrome', 'click', '@e63'], 15000);
await sleep(5000);

// 2. 确认框
const snap2 = await snapshot();
if (snap2.includes('确定')) {
  for (const line of snap2.split('\n')) {
    if (line.includes('button') && line.includes('确定')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) {
        await xb(['run', '--browser', 'chrome', 'click', '@' + m[1]], 15000);
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
