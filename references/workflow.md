# 搜狐号发布 - 工作流程

## 核心流程

```
启动 Chrome → 打开登录页 → [验证码?] → 填账号密码 → [验证码?] → 登录成功
    ↓
打开发布页 → [验证码?] → 填标题 → 填正文（JS eval） → 发布
```

---

## 一、Chrome 启动

```javascript
const execSync = require('child_process').execSync;
execSync('taskkill /F /IM chrome.exe', { windowsHide: true });
await sleep(3000);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profilePath = 'C:\\Users\\菠萝\\.qclaw\\tools\\xbrowser\\profiles\\chrome';
execSync(`"${chromePath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`, {
  windowsHide: true, detached: true, stdio: 'ignore'
});
await sleep(6000);
```

---

## 二、登录

### 2.1 打开登录页

```javascript
await xb(['run', '--browser', 'chrome', 'open', 'https://mp.sohu.com'], 25000);
await sleep(5000);
```

### 2.2 解析 ref

从 snapshot 解析：
- 手机号：`textbox "请输入邮箱/手机号"` → ref=e20
- 密码：`textbox "请输入密码"` → ref=e21
- 协议：`checkbox "我已阅读并同意"` → ref=e22
- 登录：`button "登录"`（第二个，ref=e13）

```javascript
const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';

// 查找协议勾选框（注意缩进不同）
let agreeRef = '';
let submitRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('checkbox') && line.includes('我已阅读并同意')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) agreeRef = m[1];
  }
  if (line.includes('button') && line.includes('"登录"')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) submitRef = m[1];  // 取最后一个（e13 是真正的登录按钮）
  }
}
```

### 2.3 填表单

```javascript
if (agreeRef) {
  await xb(['run', '--browser', 'chrome', 'click', '@' + agreeRef], 10000);
  await sleep(300);
}
await xb(['run', '--browser', 'chrome', 'fill', '@e20', '手机号'], 10000);
await xb(['run', '--browser', 'chrome', 'fill', '@e21', '密码'], 10000);
```

### 2.4 点登录

```javascript
await xb(['run', '--browser', 'chrome', 'click', '@' + submitRef], 10000);
await sleep(5000);

// 验证码检测（滑块/图形/短信）
const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';
if (snap.includes('滑块') || snap.includes('拼图') || snap.includes('图形验证') || snap.includes('短信')) {
  console.log('=== 需验证码 ===');
  return; // 暂停让用户处理
}

// 等待登录完成
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  const u = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
  const url = JSON.parse(u.out).data?.result?.data?.url || '';
  if (url.includes('mp.sohu.com') && !url.includes('login')) break;
}
```

---

## 三、打开发布页

```javascript
await xb(['run', '--browser', 'chrome', 'open', 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1'], 25000);
await sleep(8000);
```

---

## 四、填标题

```javascript
const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';

let titleRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('textbox') && line.includes('标题')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { titleRef = m[1]; break; }
  }
}
if (titleRef) {
  await xb(['run', '--browser', 'chrome', 'fill', '@' + titleRef, '文章标题'], 15000);
  console.log('标题已填入');
}
await sleep(1000);
```

---

## 五、填正文（⚠️ 关键）

**`xb type` 命令在搜狐号编辑器中不起作用！** 必须用 JavaScript eval 直接设置 `contenteditable` 的 `innerHTML`：

```javascript
const html = article.body.map(p => '<p>' + p + '</p>').join('');

const setScript = `(function() {
  var editors = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editors.length; i++) {
    var el = editors[i];
    // 正文区域比摘要大，通过大小判断
    if (el.offsetHeight > 50 && el.offsetWidth > 200) {
      el.innerHTML = ${JSON.stringify(html)};
      // 触发输入事件
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'SET_LEN_' + el.textContent.length;
    }
  }
  return 'NOT_FOUND';
})()`;

const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64',
  Buffer.from(setScript).toString('base64')], 15000);
console.log('正文设置结果: ' + JSON.parse(r.out).data?.result?.data);
await sleep(2000);
```

---

## 六、发布

### 6.1 点击发布

发布按钮：`listitem "发布"`（通常是 e63）

```javascript
const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';

let pubRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { pubRef = m[1]; break; }
  }
}

if (pubRef) {
  await xb(['run', '--browser', 'chrome', 'click', '@' + pubRef], 15000);
  await sleep(5000);
}
```

### 6.2 处理确认对话框

```javascript
const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';

if (snap.includes('确定') || snap.includes('确认')) {
  for (const line of snap.split('\n')) {
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
```

### 6.3 验证发布成功

```javascript
const u = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
const url = JSON.parse(u.out).data?.result?.data?.url || '';

if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
  // URL 变为 https://mp.sohu.com/mpfe/v4/contentManagement/first/page
} else {
  console.log('=== 仍在编辑页 ===');
}
```

---

## 七、完整示例

见 `scripts/publish.js`
