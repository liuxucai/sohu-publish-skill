# 问题与解决方案

## 一、Chrome 启动问题

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| C1 | Chrome 启动后立即退出 (exit code 0) | profile 目录被占用或损坏 | 每次启动前先 `taskkill /F /IM chrome.exe`，等待 3 秒再启动 |
| C2 | Chrome 启动后停留在 about:blank | Start-Process 启动但 xb 没有接管 | 用 xb open 强制打开目标 URL |
| C3 | 多个 Chrome 进程残留 | 脚本异常退出未清理 | `taskkill /F /IM chrome.exe` 清理所有残留进程 |
| C4 | xb run --browser chrome 启动失败 | xb CLI 启动 Chrome 不稳定 | 使用 Start-Process + execSync detached 方式启动 Chrome |

**正确启动方式：**
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

// 强制导航到目标 URL
await xb(['run', '--browser', 'chrome', 'open', 'https://mp.sohu.com'], 25000);
```

---

## 二、登录问题

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| L1 | agreeRef 匹配不到，始终为 undefined | checkbox 在 snapshot 中缩进不同，正则匹配失败 | 用字符串包含查找：`line.includes('checkbox') && line.includes('我已阅读并同意')` |
| L2 | submitRef 匹配到 e3 而不是 e13 | 登录页有**两个**同名 `button "登录"`，正则匹配到第一个 | 匹配所有 `button` 含 `"登录"` 的行，取最后一个（或取 ref 数字较大的） |
| L3 | 协议未勾选就点登录，搜狐弹出验证码 | 必须先勾选协议才能正常登录 | 先 click agree 勾选框，再 fill 表单，最后 click 登录 |
| L4 | 填完表单后立即检查没有验证码 | **验证码在点登录后才出现** | 正确的流程：fill 表单 → click 登录 → 才检查验证码 |
| L5 | fill 输入带双引号，原样输入 | fill 参数格式错误 | fill 参数**直接写值，不加任何引号**：`fill '@e20' '手机号'` |
| L6 | 登录后仍停留在 login 页 | 账号密码错误或协议未勾选 | 确认账号密码；必须先勾选协议再点登录 |
| L7 | 登录后重定向到 mp.sohu.com 主站 | cookie 未正确保留 | 重新登录；确认 Chrome profile 正确 |

**登录成功判断：**
- URL 变为 `https://mp.sohu.com/mpfe/v4/xxx`（不含 login）
- snapshot 中出现"文章发布"、"新手必看"等后台菜单

**登录页 ref（每次 snapshot 变化，需从快照解析）：**
```
手机号：textbox "请输入邮箱/手机号" [ref=e20]
密码：  textbox "请输入密码" [ref=e21]
协议：  checkbox "我已阅读并同意" [ref=e22]（注意缩进）
登录：  button "登录" [ref=e13]（第二个，e3 是其他按钮）
```

---

## 三、验证码问题

| # | 问题 | 检测关键词 | 处理方式 |
|---|------|----------|---------|
| V1 | 滑块拼图验证码 | `滑块`、`拼图`、`拖动下方滑块完成拼图` | 暂停，用户在浏览器中拖动滑块 |
| V2 | 图形验证码 | `图形验证`、`图形验证码` | 暂停，用户识别图片输入字符 |
| V3 | 短信验证码 | `短信验证码`、`请输入短信验证码` | 暂停，用户在手机查看短信输入 |
| V4 | 点登录后 URL 不变，snapshot 含验证码 | 验证码在登录**点击之后**才出现 | 正确的 captcha 检测时机是 click 登录**之后**，不是之前 |

**验证码检测时机（关键）：**
```javascript
// ❌ 错误：填完表单后立即检查（验证码还没出）
await fillForm();
const snap = await snapshot(); // 此时没有验证码
if (snap.includes('滑块')) return; // 永远检测不到

// ✅ 正确：点登录之后才检查验证码
await clickLogin();
await sleep(2000);
const snap = await snapshot(); // 此时验证码才出现
if (snap.includes('滑块') || snap.includes('拼图') || snap.includes('短信')) {
  console.log('=== 需验证码，暂停 ===');
  return; // 暂停让用户处理
}
```

**验证码暂停处理：**
```javascript
// 1. 截图留证
const ssR = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
const ssPath = JSON.parse(ssR.out).data?.result?.data?.path || '';
console.log('验证码截图:', ssPath);

// 2. 写状态文件
fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');

// 3. 暂停（脚本不退出，等待用户完成后再调用继续脚本）
```

---

## 四、正文编辑器问题（最关键）

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| E1 | `xb type` 命令在正文区域不生效 | 搜狐号编辑器是 contenteditable，xb type 不触发编辑器 | **必须用 JS eval 直接设置 innerHTML** |
| E2 | JS eval 结果是 `[object Object]` | eval 返回的对象被 CDP 包装 | 用 `JSON.parse(r.out).data?.result?.data` 获取实际值 |
| E3 | 设置 innerHTML 后内容不保存 | 未触发编辑器的 change 事件 | 必须同时 `dispatchEvent(new Event('input'))` 和 `dispatchEvent(new Event('change'))` |
| E4 | snapshot 中正文区域显示为空 | type 命令没写进去 | 用 JS eval 方法重新写入 |
| E5 | 正文中同时存在多个 contenteditable | 摘要和正文都是 contenteditable | 通过大小判断：正文区域 `offsetHeight > 50 && offsetWidth > 200` |
| E6 | 正文 iframe 在 snapshot 中找不到 | iframe 内容在子页面中 | 用 `querySelectorAll('iframe')` 枚举 iframe，再访问 contentDocument |

**正文写入正确方法（唯一有效方案）：**

```javascript
const html = article.body.map(p => '<p>' + p + '</p>').join('');

const setScript = `(function() {
  var editors = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editors.length; i++) {
    var el = editors[i];
    // 正文区域比摘要区域大，通过大小判断
    if (el.offsetHeight > 50 && el.offsetWidth > 200) {
      el.innerHTML = ${JSON.stringify(html)};
      // 触发输入事件，让编辑器感知内容变化
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
console.log('正文设置结果:', result); // 应输出 "SET_LEN_xxx"
```

---

## 五、发布问题

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| P1 | 发布按钮找不到（没有 `listitem "发布"`） | 发布按钮是 `listitem` 不是 `button` | 用 `snap.includes('listitem') && snap.includes('"发布"')` 搜索 |
| P2 | 发布按钮 ref 每次 snapshot 变化 | xb snapshot 重新分配 ref | 每次发布前重新 snapshot，从最新快照解析 |
| P3 | 点发布后出现确认框，点确定后还在编辑页 | 正文为空，发布失败 | 确认正文已写入（用 JS eval 后检查 result 包含 "SET_LEN"） |
| P4 | 确认框的"确定"按钮 ref 每次不同 | 动态生成的对话框 | 从 snapshot 中搜索所有 `button` 含 `"确定"` 的行 |
| P5 | 发布后 URL 不变，未跳转 | 正文为空导致发布失败 | 先确认正文已写入，再发布 |
| P6 | 多次 type 段落但页面无变化 | xb type 在搜狐编辑器不生效 | 改用 JS eval 方案 |

**发布成功判断：**
- URL 从 `addarticle?contentStatus=1` 变为 `https://mp.sohu.com/mpfe/v4/contentManagement/first/page`
- snapshot 中出现"已发布"和文章标题

**发布流程（经验证）：**
```javascript
// 1. 发布按钮
// snapshot 中：`listitem "发布" [level=1, ref=e63]`
let pubRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { pubRef = m[1]; break; }
  }
}
await xb(['run', '--browser', 'chrome', 'click', '@' + pubRef], 15000);
await sleep(5000);

// 2. 确认框
const snapR2 = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
const snap2 = JSON.parse(snapR2.out).data?.result?.data?.snapshot || '';
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

// 3. 验证成功
const urlR = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
const url = JSON.parse(urlR.out).data?.result?.data?.url || '';
if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
} else {
  console.log('=== 发布失败，仍在编辑页 ===');
}
```

---

## 六、页面加载问题

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| W1 | snapshot len=37，只有 iframe 标签 | 页面未完全加载（JavaScript 未执行） | 等待 8-10 秒后重试；多次 snapshot |
| W2 | 发布页重定向回登录页 | 登录态失效或 cookie 过期 | 重新登录 |
| W3 | 页面空白或只有元素缩略 | Chrome 渲染问题 | 刷新页面（xb open 重新打开 URL） |

**等待页面加载：**
```javascript
await xb(['run', '--browser', 'chrome', 'open', URL], 25000);
await sleep(8000);

// 如果 snapshot 太短，反复等待
for (let i = 0; i < 5; i++) {
  const snapR = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 25000);
  const snap = JSON.parse(snapR.out).data?.result?.data?.snapshot || '';
  if (snap.length > 500) break;
  await sleep(3000);
}
```

---

## 七、PowerShell / Node.js 兼容性问题

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| T1 | PowerShell 输出中文乱码（`閫氳繃鐜...`） | PowerShell 编码与 xb CLI 不兼容 | 所有 xb 调用封装在 Node.js `.js` 脚本中执行 |
| T2 | PowerShell 不支持 `&&` 链式语法 | PowerShell 语法差异 | 改用 Node.js 脚本；或 PowerShell 中用 `;` 分隔 |
| T3 | node -e 执行含中文的脚本报错 | 字符串引号处理问题 | 写 `.js` 文件执行，不用 `-e` 参数 |
| T4 | 脚本路径含中文正常工作 | Node.js 原生支持 UTF-8 | 无需特殊处理 |
| T5 | PowerShell 正则匹配 checkbox 失败 | 中文正则引擎问题 | 改用简单的字符串包含查找：`line.includes('checkbox')` |
| T6 | eval 结果被包装为 `[object Object]` | CDP 返回的是对象而非字符串 | `JSON.parse(r.out).data?.result?.data` |

---

## 八、调试技巧

```javascript
// 1. 保存 snapshot 供调试
fs.writeFileSync('debug_snap.txt', snap, 'utf8');

// 2. 获取截图路径
const ssR = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
const ssPath = JSON.parse(ssR.out).data?.result?.data?.path || '';

// 3. 搜索特定行
const lines = snap.split('\n');
lines.filter(l => l.includes('发布')).forEach(l => console.log(l.trim()));
lines.filter(l => l.includes('button')).forEach(l => console.log(l.trim()));

// 4. 获取当前 URL
const urlR = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
const url = JSON.parse(urlR.out).data?.result?.data?.url || '';

// 5. 枚举所有 contenteditable
const evalScript = `(function() {
  var els = document.querySelectorAll('[contenteditable="true"]');
  return Array.from(els).map(e => e.offsetWidth + 'x' + e.offsetHeight + ':' + e.textContent.length).join('|');
})()`;
const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64',
  Buffer.from(evalScript).toString('base64')], 15000);
console.log(JSON.parse(r.out).data?.result?.data);
```

---

## 九、本会话新增的关键经验

### 9.1 正文写入（最重要）

`xb type` 在搜狐编辑器中**完全不生效**。唯一的成功方案：

```javascript
el.innerHTML = html;
el.dispatchEvent(new Event('input', {bubbles: true}));
el.dispatchEvent(new Event('change', {bubbles: true}));
```

### 9.2 登录验证码时机

验证码在**点登录之后**才出现，不是在填表单之后。

### 9.3 发布按钮类型

发布按钮是 `listitem`（不是 `button`），搜索关键词是 `'"发布"'`（含引号）。

### 9.4 发布成功判断

URL 不再包含 `addarticle` 即为发布成功。
