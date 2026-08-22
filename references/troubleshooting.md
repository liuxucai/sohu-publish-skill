# 问题与解决方案（isolated-browser 路线）

> 本文仅记录**经实战验证、当前可用**的方法。任何 xb CLI（`xb run --browser chrome`、
> `JSON.parse(r.out).data?.result?.data` 解析）与「自动填账号密码」的做法均已被移除，
> 因为它们在本环境行不通或违背安全约束。

## 一、Chrome 启动（隔离实例）

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| C1 | 启动脚本永久卡死 | 用 `execSync(detached)` 启动常驻 Chrome，execSync 会阻塞等子进程退出，而 Chrome 不退出 | 改用 `child_process.spawn(..., {detached:true, stdio:'ignore'})` + `child.unref()`（实测 ~107ms 返回） |
| C2 | 多个 Chrome 进程残留 | 脚本异常退出未清理 | 发布前先 `taskkill /F /IM chrome.exe` 清场，再拉起隔离实例 |
| C3 | CDP 端口无响应 | 端口被占用 / 实例未真正起来 | 换 `ISOB_CDP_PORT`（如 9333）；连不上先确认实例 PID 存活 |
| C4 | profile 路径错乱 | isolated-browser 默认 profile 随版本变动（`~/.qclaw_isolated_chrome` → `~/.chrome_qclaw_stable`） | `ISO_PROFILE = process.env.ISOB_PROFILE_DIR || path.join(os.homedir(), '.chrome_qclaw_stable')`，与 isolated-browser 当前默认一致 |

**正确启动方式（lib.js `launchChrome()`）：**
- 已能 `agent-browser --cdp get url` 连通则直接复用，避免重复实例。
- 优先调用 `../isolated-browser/scripts/launch.js`（传入搜狐登录页作为起始 URL）。
- 不存在则内联同款：`spawn(chrome, ['--new-instance', '--user-data-dir='+ISO_PROFILE, '--remote-debugging-port='+CDP_PORT, '--no-first-run','--no-default-browser-check', startUrl], {detached:true, stdio:'ignore', windowsHide:true})` + `child.unref()`。

---

## 二、登录（手动，不填密码）

> 核心原则：**登录不填密码**。isolated-browser 禁止自动填密，登录由用户在浏览器手动完成，
> 脚本只打开登录页并轮询等待登录态。

| # | 问题 | 检测/根因 | 解决方法 |
|---|------|----------|---------|
| L1 | 脚本误以为已登录 | snapshot 未含未登录标志就跳过登录 | 未登录态判定：`snap.includes('登录') && snap.includes('注册')` |
| L2 | 登录等待超时 | 用户 10 分钟内未手动登录 | `sohuLogin()` 内部轮询等待（最长 10 分钟），超时退出 |
| L3 | 验证码阻断 | 搜狐安全策略 | 滑块/拼图/图形/短信验证码出现 → 暂停，用户在浏览器完成验证后再继续 |

**未登录检测与等待：**
```javascript
const snap = await snapshot();
if (snap.includes('登录') && snap.includes('注册')) {
  console.log('请在浏览器中手动登录搜狐号...');
  await sohuLogin(); // 遵循「登录不填密码」，仅轮询等待登录态
}
```

**登录成功判断：**
- URL 不含 `login`，且 snapshot 出现「文章发布」「新手必看」等后台菜单。

---

## 三、正文编辑器（最关键）

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| E1 | `agent-browser type` 在正文区不生效 | 搜狐号编辑器是 contenteditable | **必须用 JS eval 直接设置 innerHTML** |
| E2 | eval 返回值带引号/被包装 | `eval --base64` 返回 JSON-stringified 值（如 `"搜狐"`） | 对 stdout 做 `JSON.parse` 还原真实值；兼容 `result`/`value`/`data.result` |
| E3 | 设置 innerHTML 后内容不保存 | 未触发编辑器事件 | 同时 `dispatchEvent(new Event('input'))` 与 `dispatchEvent(new Event('change'))` |
| E4 | 多个 contenteditable 混淆 | 摘要与正文都是 contenteditable | 按大小判断正文：`offsetHeight > 50 && offsetWidth > 200` |

**唯一有效方案：**
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
let resultData = (r.out || '').trim();
try { resultData = JSON.parse(resultData); } catch (e) {}
// 期望 resultData 形如 "SET_LEN_1234"
```

---

## 四、发布

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| P1 | 找不到发布按钮 | 发布按钮是 `listitem` 不是 `button` | 搜索 `listitem` 且含 `"发布"` 且不含 `定时` |
| P2 | ref 每次 snapshot 变化 | agent-browser 重新分配 ref | 每次发布前重新 snapshot，从最新快照解析 |
| P3 | 点确定后仍在编辑页 | 正文为空导致发布失败 | 确认正文已写入（eval 返回含 `SET_LEN`）再发布 |
| P4 | 确认框「确定」按钮 ref 不定 | 动态对话框 | 从 snapshot 搜 `button` 含 `"确定"` 的行 |
| P5 | 仅凭 URL 无法判定成败 | 成功后 URL 回到后台页 | 发布后截图 + 图像识别确认；后台列表显示「审核中」即提交成功 |
| **P6** | **点发布后弹「请添加必选声明」、发布页不前进** | 搜狐号发布页有**必填项「创作声明（必选声明）」radio 组**（无需声明/含有AI生成内容/含有虚构演绎内容/含有营销信息/内容为转载/内容为个人观点/引用声明），不选会拦截提交 | **发布前必须选一项**，默认选「无需声明」（见下方代码） |
| **P7** | **Element UI radio 用坐标点击 / label.el-radio.click() 不生效（checked 仍为 0）** | Element UI 的 radio 由隐藏的 `input.el-radio__original` 的 change 事件驱动 v-model，点 label 视觉区域或调 label.click() 不会更新选中态 | **必须调用 `input.el-radio__original` 的 `.click()`**（页面内 eval 执行），随后校验 `checked===1` |

**发布按钮解析（经验证）：**
```javascript
let pubRef = '';
for (const line of snap.split('\n')) {
  if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
    const m = line.match(/ref=(e\d+)/);
    if (m) { pubRef = m[1]; break; }
  }
}
```

**必选声明（创作声明）选择（经验证，最关键的新增必填项）：**
```javascript
// ⚠️ 必须点隐藏 input，绝不能点 label 坐标
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
// 校验：input.el-radio__original 中 checked 数量应为 1
```

**发布成功判断：**
- URL 不再含 `addarticle`（跳回 `contentManagement/first/page`）；
- 后台文章列表出现该文且状态为「审核中」；
- `el-message` 无「请添加必选声明」等报错 ⇒ 视为发布完成。

> ⚠️ 本次实战注意：点发布后 URL 虽跳回后台页、无报错，但文章列表未立即出现该文（列表仍显示旧条数）。搜狐号后台列表是异步/分页的，**不要仅凭列表没刷新就判失败**；以「URL 离开 addarticle + 无报错 toast + 必选声明已选」为成功判据更稳。若需确认入库，隔几分钟后在后台手动核对，或用登录态调列表接口核对（注意：本环境 workspace 未预装 axios，核对建议走 DOM 判据）。

---

## 四之二、本次实战完整问题清单（2026-08-22）

> 从诊断到发布踩到的全部问题及最终可用解法，已分散沉淀进上文各表，此处汇总便于速查。

| 阶段 | 问题 | 行不通的方法 | 最终可用方法 |
|------|------|--------------|--------------|
| 启动 | Chrome 卡死 / 多实例残留 | `execSync(detached)` 启动常驻 Chrome | `spawn(...{detached,stdio:'ignore'})+child.unref()`；发布前 `taskkill /F /IM chrome.exe` 清场 |
| 驱动 | agent-browser 命令挂起 | 同时传 `--profile` 与 `--cdp` | 只传 `--cdp` |
| 正文 | type 不生效 | `agent-browser type` | JS eval 设 `innerHTML` + dispatch `input`/`change` |
| 声明 | 点发布被拦「请添加必选声明」 | 用坐标 `clickCoords` 点 radio label；`label.click()` | 页面内 `input.el-radio__original.click()` |
| 发布 | 点发布后列表没刷新，误判失败 | 仅以列表是否出现该文判成败 | URL 离开 addarticle + 无报错 toast + 必选声明已选 = 成功 |
| 验证 | 列表异步不刷新 | 发完立刻查列表 | 隔几分钟手动核对 / 列表接口核对（本环境未装 axios，改用 DOM 判据） |

---

## 五、agent-browser 调用注意

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| A1 | 命令挂起无返回 | 同时传 `--profile` 与 `--cdp` 冲突 | **只传 `--cdp`**，profile 在 launch 阶段用 `--user-data-dir` 解决 |
| A2 | spawnSync 跑 `.cmd` 失败 | Windows 下 spawnSync 直接执行 `.cmd` 需 shell 解释 | spawnSync 选项加 `shell:true`；或优先用 `spawn` |
| A3 | 输出中文乱码 / 变 ErrorRecord | PowerShell 管道 `2>&1` 把 stderr 包成对象；编码混用 | 输出重定向到文件（`*> _run.log`），用 `Get-Content -Encoding UTF8` 读并清掉 NUL；匹配优先用「字符串包含」 |
| A4 | 路径解析到无扩展名项 | `where.exe agent-browser` 返回无扩展名项与 `.cmd` 两条 | 优先匹配 `.cmd` |

**`agent-browser --cdp` 输出格式（与 xb 不同）：**
- `get url` → 纯文本 URL（非 JSON）
- `snapshot -i` → 纯文本 ref 列表（含 `ref=eXX`）
- `eval --base64` → JSON-stringified 值（需 `JSON.parse`）
- `fill` / `click` → `✅ Done`

---

## 六、路径与编码

| # | 问题 | 根因 | 解决方法 |
|---|------|------|---------|
| T1 | 状态文件写错目录 | 硬编码旧工作区 `workspace-agent-3af8d089` | `WORKSPACE` 用当前 skill 目录，不写死旧路径 |
| T2 | 脚本中文乱码 | PowerShell `Set-Content` 默认 GBK | 写/改脚本一律 UTF-8；eval 的 JS 走 `--base64` 规避 |

---

## 七、常见问题速查

| 现象 | 处理 |
|------|------|
| 脚本卡在「启动 Chrome」 | 改用 spawn+unref（见 C1）；勿用 execSync |
| `agent-browser` 命令挂起 | 去掉 `--profile`，只留 `--cdp`（见 A1） |
| 正文区为空 | 改用 eval 设 innerHTML，并检查返回 `SET_LEN_xxx`（见三） |
| 发布按钮找不到 | 搜 `listitem "发布"`，非 `button`（见 P1） |
| 验证码 | 暂停，用户在浏览器完成（见 L3） |
| 未登录 | 在浏览器手动登录，`sohuLogin()` 轮询等待（见二） |
