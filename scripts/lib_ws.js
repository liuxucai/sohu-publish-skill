/**
 * 搜狐号文章发布 - xb CLI 封装库 (适配当前 workspace)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const XB = 'C:\\Users\\菠萝\\.qclaw\\skills\\xbrowser\\scripts\\xb.cjs';
const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-67effa96';
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

async function snapshot() {
  const r = await xb(['run', '--browser', 'chrome', 'snapshot', '-i'], 20000);
  const parsed = JSON.parse(r.out);
  if (!parsed.data || !parsed.data.result || !parsed.data.result.data) {
    throw new Error('Invalid snapshot: ' + r.out.substring(0, 200));
  }
  return parsed.data.result.data.snapshot || '';
}

async function getUrl() {
  const r = await xb(['run', '--browser', 'chrome', 'get', 'url'], 15000);
  const parsed = JSON.parse(r.out);
  return parsed.data?.result?.data?.url || '';
}

async function screenshot() {
  const r = await xb(['run', '--browser', 'chrome', 'screenshot', '--full'], 15000);
  const parsed = JSON.parse(r.out);
  return parsed.data?.result?.data?.path || '';
}

async function open(url) {
  const r = await xb(['run', '--browser', 'chrome', 'open', url], 25000);
  await sleep(3000);
  return r;
}

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

function launchChrome() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profilePath = 'C:\\Users\\菠萝\\.qclaw\\tools\\xbrowser\\profiles\\chrome';
  
  try { execSync('taskkill /F /IM chrome.exe 2>nul', { windowsHide: true }); } catch (e) {}
  sleep(2000).then(() => {});
  
  try {
    execSync(`"${chromePath}" --remote-debugging-port=9222 --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`, {
      windowsHide: true, detached: true, stdio: 'ignore'
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureChrome() {
  launchChrome();
  await sleep(5000);
  
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

async function sohuLogin(phone, password) {
  await open('https://mp.sohu.com');
  const snap0 = await snapshot();
  
  if (hasCaptcha(snap0)) {
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
    return { ok: false, step: 'initial_captcha', message: '页面有验证码，请在浏览器中完成验证' };
  }
  
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
    if (line.includes('checkbox') && line.includes('我已阅读并同意')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) agreeRef = m[1];
    }
    if (line.includes('button') && line.includes('"登录"')) {
      const m = line.match(/ref=(e\d+)/);
      if (m) submitRef = m[1];
    }
  }
  
  if (!phoneRef || !pwdRef || !submitRef) {
    return { ok: false, step: 'parse_refs', message: '无法解析登录表单 ref，请手动检查' };
  }
  
  await xb(['run', '--browser', 'chrome', 'fill', '@' + phoneRef, phone]);
  await sleep(300);
  
  if (agreeRef) {
    await xb(['run', '--browser', 'chrome', 'click', '@' + agreeRef]);
    await sleep(300);
  }
  
  await xb(['run', '--browser', 'chrome', 'fill', '@' + pwdRef, password]);
  await sleep(300);
  
  await xb(['run', '--browser', 'chrome', 'fill', '@' + phoneRef, phone]);
  await sleep(300);
  
  await xb(['run', '--browser', 'chrome', 'click', '@' + submitRef]);
  await sleep(3000);
  
  const snap2 = await snapshot();
  if (hasCaptcha(snap2)) {
    fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
    return { ok: false, step: 'login_captcha', message: '登录后需要验证码，请在浏览器中完成验证' };
  }
  
  const url = await getUrl();
  if (url.includes('/login')) {
    if (snap2.includes('错误') || snap2.includes('失败')) {
      return { ok: false, step: 'login_failed', message: '登录失败，账号或密码错误' };
    }
    return { ok: false, step: 'login_failed', message: '登录失败，当前 URL: ' + url };
  }
  
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'LOGIN_OK', 'utf8');
  return { ok: true, step: 'login_ok', message: '登录成功' };
}

async function waitForCaptchaDone(maxWaitMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(5000);
    try {
      const status = fs.readFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'utf8').trim();
      if (status !== 'NEED_USER_VERIFY') {
        return status;
      }
    } catch (e) {}
  }
  throw new Error('验证码等待超时');
}

// ============================================================
// 发布页操作
// ============================================================

async function openPublishPage() {
  await open(PUBLISH_URL);
  await sleep(3000);
  await xb(['run', '--browser', 'chrome', 'wait', '--load', 'networkidle'], 20000);
  const snap = await snapshot();
  fs.writeFileSync(path.join(WORKSPACE, 'sohu_publish_snap.txt'), snap, 'utf8');
  return snap;
}

async function fillTitle(title) {
  const snap = await snapshot();
  
  let titleRef = null;
  for (const line of snap.split('\n')) {
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
  
  await xb(['run', '--browser', 'chrome', 'fill', '@' + titleRef, title]);
  await sleep(500);
  return titleRef;
}

async function fillBody(body) {
  const sections = Array.isArray(body) ? body : [body];
  const html = sections.map(p => '<p>' + p + '</p>').join('');

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
  await sleep(2000);

  const result = JSON.parse(r.out);
  const resultData = result.data?.result?.data || '';
  if (resultData.startsWith('SET_LEN_')) {
    return resultData;
  }
  throw new Error('正文写入失败 (result=' + resultData + ')');
}

async function publish() {
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

  await xb(['run', '--browser', 'chrome', 'click', '@' + pubRef], 15000);
  await sleep(5000);

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

  const url = await getUrl();
  if (url.includes('addarticle')) {
    throw new Error('发布失败，仍在编辑页 (url=' + url + ')');
  }

  fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'PUBLISHED', 'utf8');
  return true;
}

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
