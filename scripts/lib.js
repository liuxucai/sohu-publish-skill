/**
 * 搜狐号文章发布 - agent-browser 封装库（isolated-browser 路线）
 *
 * 浏览器启动改用 isolated-browser skill：拉起一个与用户默认 Chrome 完全隔离的
 * 独立 Chrome 实例（全新 --user-data-dir + 独立 CDP 端口），再用 agent-browser
 * --cdp 直连驱动，绕开 xb 安全锁，不打扰用户现有浏览器。
 *
 * 重要：isolated-browser 的核心原则「登录不填密码」——本库不再自动填账号密码，
 * 登录交给用户在浏览器中手动完成，脚本只负责打开登录页并等待登录态就绪。
 *
 * 用法：
 * const { ensureChrome, sohuLogin, openPublishPage, fillTitle, fillBody, publish, cleanup } = require('./lib.js');
 */

const { spawn, spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ---- 隔离实例配置（环境变量可覆盖，避免硬编码）----
const CDP_PORT = process.env.ISOB_CDP_PORT || 9222;
const ISO_PROFILE = process.env.ISOB_PROFILE_DIR || path.join(os.homedir(), '.chrome_qclaw_stable');

const WORKSPACE = process.env.QCLAW_WORKSPACE || path.resolve(__dirname, '..', '..', '..');
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'sohu_iso');
const PUBLISH_URL = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1';

// ============================================================
// agent-browser CLI 解析（不写死路径）
// ============================================================

function resolveAgentBrowser() {
  try {
    const lines = execSync('where.exe agent-browser', { encoding: 'utf8', shell: true })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const prefer = lines.find((l) => l.toLowerCase().endsWith('.cmd')) ||
      lines.find((l) => l.toLowerCase().endsWith('.exe')) ||
      lines[0];
    if (prefer && fs.existsSync(prefer)) return prefer;
  } catch (e) { /* 继续兜底 */ }
  const cands = [
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser.cmd'),
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser'),
    '/usr/local/bin/agent-browser',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'agent-browser'; // 期望在 PATH
}

const AB = resolveAgentBrowser();

// ============================================================
// 底层 agent-browser --cdp 调用
// ============================================================

function ab(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(AB, ['--cdp', String(CDP_PORT), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true, // Windows 下执行 .cmd 需要 shell 解释
    });
    let out = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      reject(new Error('agent-browser timeout: ' + args.join(' ')));
    }, timeout);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 页面操作
// ============================================================

/**
 * 获取 snapshot（返回纯文本，含 ref=eXX，与 xb 格式一致）
 */
async function snapshot() {
  const r = await ab(['snapshot', '-i'], 20000);
  return r.out || '';
}

/**
 * 获取当前 URL（纯文本）
 */
async function getUrl() {
  const r = await ab(['get', 'url'], 10000);
  return (r.out || '').trim();
}

/**
 * 截图，返回图片路径
 */
async function screenshot(label = 'shot') {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filepath = path.join(SCREENSHOT_DIR, `sohu_${label}_${Date.now()}.png`);
  const r = await ab(['screenshot', filepath], 15000);
  if (r.code === 0 && fs.existsSync(filepath)) return filepath;
  return '';
}

/**
 * 打开 URL
 */
async function open(url) {
  await ab(['open', url], 25000);
  await sleep(3000);
  return true;
}

/**
 * 检查是否有验证码
 */
function hasCaptcha(snapText) {
  return (
    snapText.includes('滑块') ||
    snapText.includes('拼图') ||
    snapText.includes('图形验证') ||
    snapText.includes('短信验证码') ||
    snapText.includes('图形验证码')
  );
}

// ============================================================
// 隔离 Chrome 启动（isolated-browser 路线）
// ============================================================

/**
 * 解析系统稳定版 Chrome（内联兜底用）
 */
function findChrome() {
  const cands = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return 'chrome';
}

/**
 * 拉起隔离 Chrome 实例：
 * - 优先调用 isolated-browser skill 的 launch.js（脚本位于 ../isolated-browser/scripts/launch.js）
 * - 不存在则内联同款 spawn（--new-instance + 全新 --user-data-dir + 独立 CDP 端口，detached+unref 常驻）
 * 已连接则直接复用，避免重复实例。
 */
async function launchChrome() {
  // 已连接则复用
  try {
    const r = await ab(['get', 'url'], 8000);
    if (r.code === 0) {
      console.log('  复用已有隔离 Chrome 实例');
      return true;
    }
  } catch (e) { /* 未连接，继续启动 */ }

  const launchScript = path.join(__dirname, '..', 'isolated-browser', 'scripts', 'launch.js');
  let launched = false;

  if (fs.existsSync(launchScript)) {
    // 使用 isolated-browser skill 启动（默认起始页传入搜狐登录页）
    const child = spawn('node', [launchScript, 'https://mp.sohu.com'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    launched = true;
    console.log('  已通过 isolated-browser skill 启动隔离 Chrome');
  } else {
    // 内联兜底：同款参数
    const chrome = findChrome();
    fs.mkdirSync(ISO_PROFILE, { recursive: true });
    const child = spawn(chrome, [
      '--new-instance',
      `--user-data-dir=${ISO_PROFILE}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://mp.sohu.com',
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    launched = true;
    console.log('  已内联启动隔离 Chrome（isolated-browser 同款参数）');
  }

  if (!launched) throw new Error('隔离 Chrome 启动失败');

  // 等待 CDP 就绪
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const r = await ab(['get', 'url'], 8000);
      if (r.code === 0) return true;
    } catch (e) { /* 继续等待 */ }
  }
  throw new Error('隔离 Chrome 启动超时（CDP 端口 ' + CDP_PORT + ' 无响应）');
}

/**
 * 确保隔离 Chrome 可用
 */
async function ensureChrome() {
  await launchChrome();
  const url = await getUrl();
  console.log('  Chrome 已就绪，当前 URL:', url);
  return true;
}

// ============================================================
// 搜狐登录（手动，不填密码）
// ============================================================

/**
 * 确保已登录搜狐号：打开登录页，若检测到未登录则暂停，由用户在浏览器手动登录。
 * 遵循 isolated-browser「登录不填密码」原则，不自动填账号密码。
 * 返回 true 表示已登录。
 */
async function sohuLogin() {
  await open('https://mp.sohu.com');
  await sleep(3000);
  let snap = await snapshot();

  // 初始验证码
  if (hasCaptcha(snap)) {
    console.log('  [验证码] 登录页有验证码，请在浏览器中完成验证');
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
    await waitForCaptchaDone();
    snap = await snapshot();
  }

  // 检测是否处于未登录态（登录页含「登录」「注册」）
  const needLogin = snap.includes('登录') && snap.includes('注册');
  if (needLogin) {
    console.log('\n=== 请在浏览器中手动登录搜狐号（不要关闭窗口，不要填密码给我）===');
    console.log('登录完成后，本脚本会自动检测登录态并继续。\n');
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_LOGIN', 'utf8');

    const start = Date.now();
    while (Date.now() - start < 600000) {
      await sleep(5000);
      const s = await snapshot();
      if (!(s.includes('登录') && s.includes('注册'))) {
        fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'LOGIN_OK', 'utf8');
        console.log('  检测到已登录，继续');
        return true;
      }
    }
    throw new Error('手动登录等待超时（10 分钟）');
  }

  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'LOGIN_OK', 'utf8');
  return true;
}

/**
 * 等待用户完成验证码/登录后继续（轮询状态文件）
 */
async function waitForCaptchaDone(maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(5000);
    try {
      const status = fs.readFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'utf8').trim();
      if (status !== 'NEED_USER_VERIFY' && status !== 'NEED_USER_LOGIN') {
        return status;
      }
    } catch (e) {
      // 文件不存在，继续等待
    }
  }
  throw new Error('验证码/登录等待超时');
}

// ============================================================
// 发布页操作
// ============================================================

/**
 * 打开发布页
 */
async function openPublishPage() {
  await open(PUBLISH_URL);
  await sleep(3000);
  const snap = await snapshot();
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_publish_snap.txt'), snap, 'utf8');
  return snap;
}

/**
 * 填标题（从 snapshot 解析标题输入框 ref）
 */
async function fillTitle(title) {
  const snap = await snapshot();

  let titleRef = null;
  let inIframe = false;
  for (const line of snap.split('\n')) {
    if (/Iframe\s*\[ref=/.test(line)) { inIframe = true; continue; }
    if (inIframe) continue;
    if (/标题/.test(line) && /\[ref=(e\d+)\]/.test(line)) {
      const m = line.match(/\[ref=(e\d+)\]/);
      if (m) { titleRef = m[1]; break; }
    }
  }

  if (!titleRef) {
    const m = snap.match(/textbox.*?\[ref=(e\d+)\]/);
    if (m) titleRef = m[1];
  }

  if (!titleRef) {
    throw new Error('未找到标题输入框，请手动检查发布页 snapshot');
  }

  await ab(['fill', '@' + titleRef, title], 15000);
  await sleep(500);
  return titleRef;
}

/**
 * 填正文（contenteditable，xb type 不生效，用 JS eval 设置 innerHTML）
 * agent-browser eval 返回 JSON-stringified 值，需 JSON.parse。
 */
async function fillBody(body) {
  const sections = Array.isArray(body) ? body : [body];
  const html = sections.map((p) => '<p>' + p + '</p>').join('');

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
  await sleep(2000);

  const raw = (r.out || '').trim();
  let resultData = raw;
  try { resultData = JSON.parse(raw); } catch (e) { /* 非 JSON，保留原串 */ }

  if (typeof resultData === 'string' && resultData.startsWith('SET_LEN_')) {
    return resultData; // 例如 "SET_LEN_1234"
  }
  throw new Error('正文写入失败 (result=' + JSON.stringify(resultData) + ')');
}

/**
 * 填「创作声明（必选声明）」——搜狐号发布前必须选一项，否则点发布弹「请添加必选声明」。
 * 「无需声明」是最省事的必选项。
 *
 * ⚠️ 关键坑：Element UI 的 radio 用 label 中心坐标点击（clickCoords）或 el.click() 在 label 上
 * 都无效（v-model 不更新）；必须调用隐藏的 input.el-radio__original 的 .click()（Vue 监听其 change）。
 */
async function fillDeclaration(choice = '无需声明') {
  const script = `(function(){
    var labels=[].slice.call(document.querySelectorAll('.el-radio'));
    for(var i=0;i<labels.length;i++){
      if((labels[i].innerText||'').trim().indexOf(${JSON.stringify(choice)})>=0){
        var inp=labels[i].querySelector('input.el-radio__original');
        if(inp){ inp.click(); return 'SELECTED_'+${JSON.stringify(choice)}; }
      }
    }
    return 'NOT_FOUND';
  })()`;
  const r = await ab(['eval', '--base64', Buffer.from(script).toString('base64')], 15000);
  await sleep(800);
  const raw = (r.out || '').trim();
  let d = raw;
  try { d = JSON.parse(raw); } catch (e) { /* 非 JSON 保留原串 */ }
  if (typeof d === 'string' && d.startsWith('SELECTED_')) return d;
  throw new Error('创作声明选择失败 (result=' + JSON.stringify(d) + ')');
}

/**
 * 发布（发布按钮是 listitem，发布前必须先选「必选声明」，点发布后回后台列表）
 */
async function publish() {
  // 1) 必填：选「必选声明」（不填会被「请添加必选声明」拦截）
  await fillDeclaration('无需声明');

  const snap = await snapshot();

  let pubRef = '';
  for (const line of snap.split('\n')) {
    if (line.includes('listitem') && line.includes('"发布"') && !line.includes('定时')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) { pubRef = m[1]; break; }
    }
  }

  if (!pubRef) {
    throw new Error('未找到发布按钮（listitem "发布"）');
  }

  await ab(['click', '@' + pubRef], 15000);
  await sleep(5000);

  // 处理确认对话框
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

  // 验证发布成功：URL 不再包含 addarticle
  const url = await getUrl();
  if (url.includes('addarticle')) {
    throw new Error('发布失败，仍在编辑页 (url=' + url + ')');
  }

  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'PUBLISHED', 'utf8');
  return true;
}

/**
 * 清理截图（隔离实例产生的临时 png）
 */
async function cleanup() {
  if (fs.existsSync(SCREENSHOT_DIR)) {
    fs.readdirSync(SCREENSHOT_DIR).forEach((f) => {
      if (f.endsWith('.png')) {
        try { fs.unlinkSync(path.join(SCREENSHOT_DIR, f)); } catch (e) {}
      }
    });
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 截图并保存到工作区
 */
async function screenshotAndSave(label) {
  const p = await screenshot(label);
  if (!p) return '';
  const dest = path.join(WORKSPACE, `sohu_${label}_${Date.now()}.png`);
  try {
    fs.copyFileSync(p, dest);
    return dest;
  } catch (e) {
    return p;
  }
}

/**
 * 根据关键词/提示词生成文章（标题+正文）
 */
async function generateArticle({ prompt, keywords }) {
  const topic = (prompt || keywords || '').trim();
  if (!topic) throw new Error('生成文章需要关键词/提示词（--prompt 或 --keywords）');

  const baseUrl = (process.env.SOHU_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = process.env.SOHU_LLM_API_KEY;
  const model = process.env.SOHU_LLM_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error(
      '未配置 LLM：请设置环境变量 SOHU_LLM_API_KEY，' +
      '或改用 --title/--body 直接提供内容，或由 Agent 生成后传入'
    );
  }

  const sys = '你是一个资深自媒体写手，擅长写搜狐号爆款文章。只输出 JSON，格式严格为：'
    + '{"title":"不超过30字的标题","body":["第1段100-300字","第2段100-300字","第3段100-300字","第4段100-300字"]}。'
    + '要求：标题有吸引力、观点明确；正文4-6段，每段100-300字，口语化、最好有案例或数据、逻辑清晰；不要使用任何 Markdown 符号，只输出 JSON。';
  const user = '请根据以下主题/提示词写一篇文章：' + topic;

  const resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: '***' + apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.8,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('LLM 请求失败 ' + resp.status + ': ' + t.substring(0, 300));
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return parseArticle(content);
}

/**
 * 从 LLM 返回文本中解析出 { title, body:[...] }
 */
function parseArticle(content) {
  let jsonStr = (content || '').trim();
  const f = jsonStr.indexOf('{');
  const l = jsonStr.lastIndexOf('}');
  if (f >= 0 && l > f) jsonStr = jsonStr.slice(f, l + 1);
  try {
    const obj = JSON.parse(jsonStr);
    const title = (obj.title || '').toString().trim();
    const body = Array.isArray(obj.body)
      ? obj.body.map(String).map((s) => s.trim()).filter(Boolean)
      : [];
    if (!title || body.length === 0) throw new Error('解析为空');
    return { title, body };
  } catch (e) {
    const paras = content.split(/\n+/).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
    if (paras.length < 2) throw new Error('LLM 返回无法解析为文章：' + content.substring(0, 200));
    return { title: paras[0], body: paras.slice(1) };
  }
}

module.exports = {
  ab,
  generateArticle,
  parseArticle,
  sleep,
  snapshot,
  getUrl,
  screenshot,
  screenshotAndSave,
  open,
  hasCaptcha,
  launchChrome,
  ensureChrome,
  sohuLogin,
  waitForCaptchaDone,
  openPublishPage,
  fillTitle,
  fillBody,
  fillDeclaration,
  publish,
  cleanup,
  PUBLISH_URL,
};
