/**
 * 搜狐号登录脚本（isolated-browser 路线）
 *
 * 用法：
 *   node scripts/login.js
 *
 * 特点：
 * - 使用 isolated-browser skill 拉起隔离 Chrome（不打扰用户默认浏览器）
 * - 遵循「登录不填密码」原则：凭据不再自动填入，由用户在浏览器手动登录
 * - 自动检测验证码（滑块/图形/短信），有验证码时暂停让用户完成
 * - 验证/登录完成后写入状态文件 sohu_status.txt
 */

const fs = require('fs');
const path = require('path');
const { ensureChrome, sohuLogin, waitForCaptchaDone, screenshotAndSave, snapshot, getUrl } = require('./lib.js');

const WORKSPACE = process.env.QCLAW_WORKSPACE || path.resolve(__dirname, '..', '..', '..');

async function main() {
  console.log('=== 搜狐号登录脚本（isolated-browser 路线）===\n');

  try {
    // 1. 启动隔离 Chrome
    console.log('[1/2] 启动隔离 Chrome...');
    await ensureChrome();
    console.log('Chrome 已就绪');

    // 2. 手动登录（不填密码，由用户在浏览器操作）
    console.log('\n[2/2] 请在浏览器中手动登录搜狐号...');
    console.log('（不会自动填入账号密码，请在打开的窗口里完成登录）\n');
    await sohuLogin();

    const url = await getUrl();
    console.log('当前 URL:', url);
    console.log('\n✅ 登录完成（状态:', (fs.readFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'utf8') || '').trim(), '）');

    console.log('\n=== 完成 ===');

  } catch (e) {
    console.error('\n❌ 错误:', e.message);
    fs.writeFileSync(
      path.join(WORKSPACE, 'sohu_error.txt'),
      e.message + '\n' + (e.stack || ''),
      'utf8'
    );
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
