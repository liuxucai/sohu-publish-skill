/**
 * 搜狐号登录脚本
 * 
 * 用法：修改下方的 PHONE 和 PASSWORD，然后运行：
 * node scripts/login.js
 * 
 * 特点：
 * - 自动检测验证码（滑块/图形/短信）
 * - 有验证码时暂停，让用户在浏览器中完成验证
 * - 验证完成后写入状态文件 sohu_status.txt
 */

const fs = require('fs');
const path = require('path');
const { ensureChrome, sohuLogin, waitForCaptchaDone, screenshotAndSave, snapshot, open } = require('./lib.js');

const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-3af8d089';

// ============================================================
// 配置区 - 修改这里
// ============================================================
const CONFIG = {
  phone: '13414054304',
  password: 'sohu.939.',
};
// ============================================================

async function main() {
  console.log('=== 搜狐号登录脚本 ===\n');
  console.log('账号:', CONFIG.phone);
  
  try {
    // 1. 启动 Chrome
    console.log('\n[1/3] 启动 Chrome...');
    await ensureChrome();
    console.log('Chrome 已就绪');
    
    // 2. 登录
    console.log('\n[2/3] 执行登录...');
    let result = await sohuLogin(CONFIG.phone, CONFIG.password);
    console.log('登录步骤:', result.step);
    console.log('结果:', result.message);
    
    if (result.step === 'initial_captcha' || 
        result.step === 'form_captcha' || 
        result.step === 'login_captcha') {
      
      // 截图给用户看
      const ssPath = await screenshotAndSave('captcha');
      console.log('\n截图已保存:', ssPath);
      console.log('\n=== 请在浏览器中完成验证码验证 ===');
      console.log('完成后在浏览器中点击登录/提交，然后告诉我"已验证" ===\n');
      
      // 写状态文件
      fs.writeFileSync(
        path.join(WORKSPACE, 'sohu_status.txt'),
        'NEED_USER_VERIFY',
        'utf8'
      );
      
      // 等待用户完成
      console.log('等待用户完成验证...');
      const status = await waitForCaptchaDone();
      console.log('用户完成验证，状态:', status);
      
      // 重新检查登录状态
      const snap = await snapshot();
      const urlR = require('./lib.js').getUrl;
      console.log('当前 URL:', urlR);
      
      if (snap.includes('发布') || snap.includes('投稿') || snap.includes('标题')) {
        console.log('\n✅ 登录成功！发布页已加载');
        fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'LOGIN_OK', 'utf8');
      } else {
        console.log('\n⚠️ 登录状态不确定，请手动确认');
      }
    }
    
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
