# 搜狐号发布 - 工作流程（isolated-browser 路线）

> 仅保留经实战验证、当前可用的方法。浏览器由 isolated-browser skill 拉起隔离 Chrome，
> 再用 `agent-browser --cdp` 直连驱动。**不自动填密码**，登录由用户手动完成。

## 核心流程

```
拉起隔离 Chrome → 打开登录页 → [用户在浏览器手动登录 + 验证码?] → 登录成功
    ↓
打开发布页 → 填标题（agent-browser fill）→ 填正文（JS eval）→ 发布 → [确认框] → 校验成功
```

---

## 一、Chrome 启动（隔离实例）

由 `ensureChrome()` / `launchChrome()` 负责，无需手动写启动代码：

- 已能 `agent-browser --cdp get url` 连通 → 直接复用，不重复拉起。
- 否则优先调用 `../isolated-browser/scripts/launch.js`（传入搜狐登录页为起始 URL）。
- 兜底内联：`spawn(chrome, ['--new-instance','--user-data-dir='+ISO_PROFILE,'--remote-debugging-port='+CDP_PORT,'--no-first-run','--no-default-browser-check', startUrl], {detached:true, stdio:'ignore', windowsHide:true})` + `child.unref()`。

⚠️ **绝不用 `execSync(detached)` 启动常驻 Chrome**——execSync 会阻塞等子进程退出，而 Chrome 不退出，脚本卡死。

发布前如需清场：`taskkill /F /IM chrome.exe`。

---

## 二、登录（手动，不填密码）

遵循 isolated-browser「登录不填密码」原则，脚本**不填账号密码**，只打开登录页并轮询等待登录态。

```javascript
const snap = await snapshot();
// 未登录态：页面同时含「登录」与「注册」
if (snap.includes('登录') && snap.includes('注册')) {
  console.log('请在浏览器中手动登录搜狐号...');
  await sohuLogin(); // 内部轮询等待，最长 10 分钟
}
// 验证码关键词：滑块 / 拼图 / 图形验证 / 短信验证码
if (hasCaptcha(snap)) {
  console.log('验证码：请在浏览器中完成验证');
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
  // 暂停，等待用户在浏览器处理
}
```

登录成功判断：URL 不含 `login`，且 snapshot 出现「文章发布」「新手必看」等后台菜单。

---

## 三、打开发布页

```javascript
await open('https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1');
// open() 内部：agent-browser --cdp open <url> + sleep(3000)
```

---

## 四、填标题

从最新 snapshot 解析标题输入框 ref（每次重新分配），用 `fill` 且**参数不加引号**：

```javascript
const snap = await snapshot();
let titleRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('textbox') && line.includes('标题')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { titleRef = m[1]; break; }
  }
}
if (titleRef) {
  await ab(['fill', '@' + titleRef, article.title], 15000);
  console.log('标题已填入');
}
```

---

## 五、填正文（⚠️ 关键）

`agent-browser type` 在搜狐号 contenteditable 编辑器中**不生效**，必须用 JS eval 设 innerHTML：

```javascript
const html = article.body.map(p => '<p>' + p + '</p>').join('');
const setScript = `(function() {
  var editors = document.querySelectorAll('[contenteditable="true"]');
  for (var i = 0; i < editors.length; i++) {
    var el = editors[i];
    if (el.offsetHeight > 50 && el.offsetWidth > 200) { // 正文比摘要大
      el.innerHTML = ${JSON.stringify(html)};
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return 'SET_LEN_' + el.textContent.length;
    }
  }
  return 'NOT_FOUND';
})()`;
const r = await ab(['eval', '--base64', Buffer.from(setScript).toString('base64')], 15000);
let result = (r.out || '').trim();
try { result = JSON.parse(result); } catch (e) {}
// 期望 result === "SET_LEN_xxx"，否则正文未写入
```

---

## 六、发布

### 6.0 选「必选声明」（⚠️ 必填，否则发布被拦截）

搜狐号发布页有一组**必填的「创作声明（必选声明）」radio**（无需声明 / 含有AI生成内容 / 含有虚构演绎内容 / 含有营销信息 / 内容为转载 / 内容为个人观点 / 引用声明）。未选时点击发布会弹「请添加必选声明」且不前进。

⚠️ **Element UI radio 必须用隐藏 input 的 `.click()`，点 label 坐标或 `label.click()` 都不生效**：

```javascript
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

### 6.1 点击发布

发布按钮是 `listitem "发布"`（**不是 button**）：

```javascript
const snap = await snapshot();
let pubRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { pubRef = m[1]; break; }
  }
}
if (pubRef) {
  await ab(['click', '@' + pubRef], 15000);
  await sleep(5000);
}
```

### 6.2 处理确认对话框

```javascript
const snap2 = await snapshot();
if (snap2.includes('确定') || snap2.includes('确认')) {
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
```

### 6.3 验证发布成功

```javascript
const url = await getUrl();
if (!url.includes('addarticle')) {
  console.log('=== 发布成功 ===');
}
// 更稳妥：发布后截图，图像识别确认；后台列表显示「审核中」即提交成功
```

---

## 七、完整示例

见 `scripts/publish.js`（标题/正文由用户关键词或提示词提供，经 `generateArticle` 或 `--title/--body` 传入）。
