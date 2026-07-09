/**
 * 搜狐号文章发布 - 完整脚本模板
 * 
 * 使用方法：
 * 1. 修改下方的 CONFIG 配置区
 * 2. node scripts/publish.js
 * 
 * 前置条件：
 * - Chrome 已关闭所有残留进程
 * - xb CLI 已安装（默认配置 browser=chrome）
 * - 搜狐号已登录（cookie 保留在 xb 的 chrome profile 中）
 */

const fs = require('fs');
const path = require('path');
const { ensureChrome, sohuLogin, waitForCaptchaDone, openPublishPage, fillTitle, fillBody, publish, cleanup, screenshotAndSave } = require('./lib.js');

const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-3af8d089';

// ============================================================
// 配置区 - 修改这里
// ============================================================
const CONFIG = {
  // 登录信息（如果尚未登录）
  phone: '13414054304',
  password: 'sohu.939.',
  
  // 文章标题
  title: '真正的勇敢，不是无所畏惧，而是带着恐惧依然向前',
  
  // 文章正文（可以是字符串或段落数组）
  // 推荐用数组，每段不超过 500 字
  body: [
    '我们常常误解了勇敢。以为勇敢是毫无恐惧，是天不怕地不怕的超级英雄姿态。但真实的勇敢，从来不是没有恐惧，而是清楚地看见恐惧，然后选择继续向前。',
    '一个真正勇敢的人，不是不害怕，而是害怕的时候依然去做该做的事。创业者害怕失败，但还是押上全部身家去闯；医生害怕手术失误，但还是在手术台前一站就是十几个小时；一个普通人害怕被拒绝，但还是鼓起勇气向喜欢的人表白。这些人不是没有恐惧，他们只是没有被恐惧按住。',
    '真正的勇敢，是一种选择权。你可以选择逃避，可以选择躲在舒适区，但你选择了那条更难的路。不是因为你不怕，而是因为有些事，比恐惧更重要。',
    '心理学上有个概念叫"恐惧对冲"：当你面对让你害怕的事情时，试着问自己——最坏的结果是什么？这个结果真的无法承受吗？很多时候，我们把恐惧放大了，把困难想得过于可怕。真正去做的时候，发现其实没那么难。',
    '勇敢不是天赋，是可以训练的肌肉。每次你主动走出舒适区，就是在锻炼这块肌肉。下一次面对恐惧时，你会发现自己的承受阈值在提高，害怕的东西在变少。不是因为你变得无所畏惧了，而是你越来越知道——恐惧只是情绪，而行动才是答案。',
    '所以，别再等了。别等自己"准备好"，别等恐惧消失。勇敢的第一步，是承认自己害怕；第二步，是带着害怕迈出那一步。从今天开始，去做那件你一直想做却不敢做的事。你会发现，勇敢本身，就是最好的回报。',
  ],
  
  // 是否自动清理截图
  autoCleanup: true,
};
// ============================================================

async function main() {
  console.log('=== 搜狐号自动发布 ===\n');
  console.log('标题:', CONFIG.title);
  console.log('正文:', CONFIG.body.length, '段');
  console.log('');
  
  try {
    // 1. 启动 Chrome
    console.log('[1/6] 启动 Chrome...');
    await ensureChrome();
    console.log('  Chrome 已就绪');
    
    // 2. 登录（如需要）
    console.log('\n[2/6] 检查登录状态...');
    const snap0 = require('./lib.js').snapshot;
    const snapText = await snap0();
    if (snapText.includes('登录') && snapText.includes('注册')) {
      // 需要登录
      console.log('  需要登录，执行登录流程...');
      let result = await sohuLogin(CONFIG.phone, CONFIG.password);
      console.log('  登录步骤:', result.step);
      console.log('  登录消息:', result.message);
      
      if (result.step !== 'login_ok') {
        // 有验证码，暂停
        console.log('\n  需要验证码，请在浏览器中完成验证');
        console.log('  完成后告诉我"已验证"，然后我继续\n');
        fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
        
        const status = await waitForCaptchaDone();
        console.log('  用户完成验证，状态:', status);
      }
    } else {
      console.log('  已登录');
    }
    
    // 3. 打开发布页
    console.log('\n[3/6] 打开发布页...');
    const publishSnap = await openPublishPage();
    console.log('  发布页已加载，len=', publishSnap.length);
    
    // 检查验证码
    if (publishSnap.includes('验证码') || publishSnap.includes('验证')) {
      const ssPath = await screenshotAndSave('publish_captcha');
      console.log('\n  发布页需要验证码，请在浏览器中完成');
      console.log('  截图:', ssPath);
      fs.writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
      await waitForCaptchaDone();
    }
    
    // 4. 填标题
    console.log('\n[4/6] 填写标题...');
    const titleRef = await fillTitle(CONFIG.title);
    console.log('  标题已填写 (ref=' + titleRef + ')');
    
    // 5. 填正文
    console.log('\n[5/6] 填写正文...');
    const bodyResult = await fillBody(CONFIG.body);
    console.log('  正文已填写 (' + bodyResult + ')');
    
    // 6. 发布
    console.log('\n[6/6] 发布...');
    await publish();
    console.log('  ✅ 发布完成');
    
    // 截图留证
    const ssPath = await screenshotAndSave('result');
    console.log('  结果截图:', ssPath);
    
    // 清理
    if (CONFIG.autoCleanup) {
      await cleanup();
      console.log('\n截图已清理');
    }
    
    console.log('\n=== 完成 ===');
    
  } catch (e) {
    console.error('\n❌ 发布失败:', e.message);
    
    // 出错时截图
    try {
      const ssPath = await screenshotAndSave('error');
      console.error('错误截图:', ssPath);
    } catch (e2) {}
    
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
