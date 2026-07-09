/**
 * 搜狐号文章发布 - xb CLI 封装库
 * 
 * 用法：
 * const { xb, sleep, snapshot, ensureChrome, sohuLogin, openPublishPage, fillTitle, fillBody, publish, cleanup } = require('./lib.js');
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const XB = 'C:\\Users\\菠萝\\.qclaw\\skills\\xbrowser\\scripts\\xb.cjs';
const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-3af8d089';
const SCREENSHOT_DIR = 'C:\\Users\\菠萝\\.agent-browser\\tmp\\screenshots';
const PUBLISH_URL = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1';

// ============================================================
// 底层 xb 调用
// ============================================================

function xb(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [XB, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      reject(new Error('xb timeout: ' + args.join(' ')));
    }, timeout);
    proc.stdout.on('data', (d) => { out += d.toString(); });
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
 * 获取 snapshot（返回 snapshot 文本）
 */
async function snapshot() {
  const r = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 20000);
  const parsed = JSON.parse(r.out);
  if (!parsed.data || !parsed.data.result || !parsed.data.result.data) {
    throw new Error('Invalid snapshot: ' + r.out.substring(0, 200));
  }
  return parsed.data.result.data.snapshot || '';
}

/**
 * 获取当前 URL
 */
async function getUrl() {
  const r = await xb(['run', '--browser', 'chrome', 'get', 'url'], 15000);
  const parsed = JSON.parse(r.out);
  return parsed.data?.result?.data?.url || '';
}

/**
 * 截图，返回截图路径
 */
async function screenshot() {
  const r = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
  const parsed = JSON.parse(r.out);
  return parsed.data?.result?.data?.path || '';
}

/**
 * 打开 URL
 */
async function open(url) {
  const r = await xb(['run', '--browser', 'chrome', 'open', url], 25000);
  await sleep(3000);
  return r;
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
// Chrome 启动
// ============================================================

/**
 * 启动 Chrome（使用 Start-Process 方式，避免 xb run 不稳定）
 */
function launchChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profilePath = 'C:\\Users\\菠萝\\.qclaw\\tools\\xbrowser\\profiles\\chrome';
  
  // 先杀所有 Chrome
  try { execSync('taskkill /F /IM chrome.exe 2>nul', { windowsHide: true }); } catch (e) {}
  sleep(2000).then(() => {});
  
  // 启动 Chrome
  try {
    execSync(`"${chromePath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`, {
      windowsHide: true, detached: true, stdio: 'ignore'
    });
    return true;
  } catch (e) {
    // 可能已运行，忽略
    return false;
  }
}

/**
 * 确保 Chrome 可用（启动 + 等待）
 */
async function ensureChrome() {
  launchChrome();
  await sleep(5000);
  
  // 验证 xb 能控制
  const r = await xb(['run', '--browser', 'chrome', 'get', 'url'], 10000);
  const parsed = JSON.parse(r.out);
  if (!parsed.ok) {
    throw new Error('Chrome 启动失败: ' + parsed.error);
  }
  return true;
}

// ============================================================
// 搜狐登录
// ============================================================

/**
 * 搜狐号登录
 * @param {string} phone - 手机号
 * @param {string} password - 密码
 * @returns {{ ok: boolean, step: string, message: string }}
 */
async function sohuLogin(phone, password) {
  // 1. 打开登录页
  await open('https://mp.sohu.com');
  const snap0 = await snapshot();
  
  // 检查初始验证码
  if (hasCaptcha(snap0)) {
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
    return { ok: false, step: 'initial_captcha', message: '页面有验证码，请在浏览器中完成验证' };
  }
  
  // 2. 解析登录表单 ref（用字符串包含，避免正则编码问题）
  let phoneRef = '', pwdRef = '', agreeRef = '', submitRef = '';
  const lines = snap0.split('\n');
  for (const line of lines) {
    if (line.includes('textbox') && line.includes('邮箱/手机号')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) phoneRef = m[1];
    }
    if (line.includes('textbox') && line.includes('密码')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) pwdRef = m[1];
    }
    // 协议框缩进深，需字符串包含
    if (line.includes('checkbox') && line.includes('我已阅读并同意')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) agreeRef = m[1];
    }
    // 有两个 button "登录"，取 ref 较大的（e13）
    if (line.includes('button') && line.includes('"登录"')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) submitRef = m[1];
    }
  }
  
  if (!phoneRef || !pwdRef || !submitRef) {
    return { ok: false, step: 'parse_refs', message: '无法解析登录表单 ref，请手动检查' };
  }
  
  // 3. 填账号（fill 参数不加引号）
  await xb(['run', '--browser', 'chrome', 'fill', '@' + phoneRef, phone]);
  await sleep(300);
  
  // 4. 勾选协议（必须先勾选，否则会触发验证码）
  if (agreeRef) {
    await xb(['run', '--browser', 'chrome', 'click', '@' + agreeRef]);
    await sleep(300);
  }
  
  // 5. 填密码（fill 参数不加引号）
  await xb(['run', '--browser', 'chrome', 'fill', '@' + pwdRef, password]);
  await sleep(300);
  
  // 6. 填手机号
  await xb(['run', '--browser', 'chrome', 'fill', '@' + phoneRef, phone]);
  await sleep(300);
  
  // 7. 点击登录（验证码在点登录之后才出现！）
  await xb(['run', '--browser', 'chrome', 'click', '@' + submitRef]);
  await sleep(3000);
  
  // 8. 检查登录后验证码（短信/图形）
  const snap2 = await snapshot();
  if (hasCaptcha(snap2)) {
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
    return { ok: false, step: 'login_captcha', message: '登录后需要验证码，请在浏览器中完成验证' };
  }
  
  // 9. 检查是否登录成功（URL 变化）
  const url = await getUrl();
  if (url.includes('/login')) {
    // 检查错误信息
    if (snap2.includes('错误') || snap2.includes('失败')) {
      return { ok: false, step: 'login_failed', message: '登录失败，账号或密码错误' };
    }
    return { ok: false, step: 'login_failed', message: '登录失败，当前 URL: ' + url };
  }
  
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'LOGIN_OK', 'utf8');
  return { ok: true, step: 'login_ok', message: '登录成功' };
}

/**
 * 等待用户完成验证码后继续（轮询状态）
 */
async function waitForCaptchaDone(maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(5000);
    try {
      const status = fs.readFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'utf8').trim();
      if (status !== 'NEED_USER_VERIFY') {
        return status;
      }
    } catch (e) {
      // 文件不存在，继续等待
    }
  }
  throw new Error('验证码等待超时');
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
  await xb(['run', '--browser', 'chrome', 'wait', '--load', 'networkidle'], 20000);
  const snap = await snapshot();
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_publish_snap.txt'), snap, 'utf8');
  return snap;
}

/**
 * 填标题（从 snapshot 解析 contenteditable 元素）
 */
async function fillTitle(title) {
  const snap = await snapshot();
  
  // 找标题输入框（editable 或 textbox）
  let titleRef = null;
  let inIframe = false;
  for (const line of snap.split('\n')) {
    if (/Iframe\s*\[ref=/.test(line)) { inIframe = true; continue; }
    if (inIframe) continue;
    // 匹配: generic "标题" [ref=eXX] 或 textbox "标题" [ref=eXX]
    if (/标题/.test(line) && /\[ref=(e\d+)\]/.test(line)) {
      const m = line.match(/\[ref=(e\d+)\]/);
      if (m) { titleRef = m[1]; break; }
    }
  }
  
  // 备选：找第一个 textbox（在发布页）
  if (!titleRef) {
    const m = snap.match(/textbox.*?\[ref=(e\d+)\]/);
    if (m) titleRef = m[1];
  }
  
  if (!titleRef) {
    throw new Error('未找到标题输入框，请手动检查发布页 snapshot');
  }
  
  // 使用 fill（标准 HTML input 不需要 Ctrl+A）
  await xb(['run', '--browser', 'chrome', 'fill', '@' + titleRef, title]);
  await sleep(500);
  return titleRef;
}

/**
 * 填正文（经验证有效的方案）
 * 搜狐号正文编辑器是 contenteditable，xb type 不生效，
 * 必须用 JS eval 直接设置 innerHTML + dispatchEvent。
 */
async function fillBody(body) {
  const sections = Array.isArray(body) ? body : [body];
  const html = sections.map(p => '<p>' + p + '</p>').join('');

  // 用 JS eval 设置 contenteditable 的 innerHTML
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
  await sleep(2000);

  const result = JSON.parse(r.out);
  const resultData = result.data?.result?.data || '';
  if (resultData.startsWith('SET_LEN_')) {
    return resultData;  // 例如 "SET_LEN_1234"
  }
  throw new Error('正文写入失败 (result=' + resultData + ')');
}

/**
 * 发布（经验证有效的方案）
 * 发布按钮是 listitem（不是 button），发布后需处理确认对话框
 */
async function publish() {
  const snap = await snapshot();

  // 找发布按钮 listitem "发布"
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

  // 点击发布
  await xb(['run', '--browser', 'chrome', 'click', '@' + pubRef], 15000);
  await sleep(5000);

  // 处理确认对话框
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

  // 验证发布成功
  const url = await getUrl();
  if (url.includes('addarticle')) {
    throw new Error('发布失败，仍在编辑页 (url=' + url + ')');
  }

  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'PUBLISHED', 'utf8');
  return true;
}

/**
 * 清理截图
 */
async function cleanup() {
  const dirs = [SCREENSHOT_DIR, WORKSPACE];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((f) => {
        if (f.endsWith('.png') || f.endsWith('.jpg')) {
          try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
        }
      });
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 截图并保存到文件
 */
async function screenshotAndSave(label) {
  const p = await screenshot();
  const dest = path.join(WORKSPACE, `sohu_${label}_${Date.now()}.png`);
  try {
    fs.copyFileSync(p, dest);
    return dest;
  } catch (e) {
    return p;
  }
}

module.exports = {
  xb,
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
  publish,
  cleanup,
  PUBLISH_URL,
};
