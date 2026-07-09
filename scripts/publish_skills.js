/**
 * 搜狐号发布 - 以"技能"为关键词
 * 自定义脚本，适配当前 workspace
 */

const path = require('path');
const { ensureChrome, sohuLogin, waitForCaptchaDone, openPublishPage, fillTitle, fillBody, publish, cleanup, screenshotAndSave, snapshot, getUrl, open, xb, sleep } = require('./lib_ws.js');

const WORKSPACE = 'C:\\Users\\菠萝\\.qclaw\\workspace-agent-67effa96';

const CONFIG = {
  phone: '13414054304',
  password: 'sohu.939.',
  title: '技能：当代人最硬核的生存资产',
  body: [
    '在这个充满不确定性的时代，什么才是真正属于你自己的东西？房子可能贬值，工作可能被裁，股票可能套牢——但技能不会。技能，是唯一能穿越周期、陪你走完一生的硬通货。',
    '技能的本质，是"解决问题的能力"。它会编程，能做出一个网站；会写作，能表达一个观点；会沟通，能促成一次合作。每一个技能的背后，都是你在这个世界上的存在方式。世界不需要你知道多少知识，但永远需要你能解决多少问题。',
    '技能的分水岭不在"会不会"，而在"到不到位"。同样学 Python，有人只能打印 Hello World，有人能搭建一个完整的后端系统。中间的差距不是天赋，而是刻意练习的时长和方法。一万小时定律也许不够精确，但方向是对的——没有足够的投入，任何技能都只能停留在"知道"的层面。',
    '更重要的是，技能具有复利效应。你学会一项新技能，不是简单地在能力清单上加一条，而是为其他技能的发挥创造新的可能性。会写作的人学会了编程，能做出自动化的内容工具；会设计的人学会了商业思维，能把作品卖个好价钱。技能之间的组合，才是真正的护城河。',
    '但这个时代最残酷的真相是：没有一项技能是终身有效的。十年前最吃香的 SEO 优化师，今天已经被算法推荐取代了大半。五年前大火的小程序开发，今天已经成为基础能力。技能的半衰期越来越短，持续学习不再是可选项，而是生存的底线。',
    '那么，普通人应该如何构建自己的技能体系？首先，打造一项核心技能——能让你在某个领域站住脚的深度能力。它应该是你花最多时间打磨的、能持续为你创造价值的那一项。其次，拓展两到三项辅助技能——它们不需要达到顶尖水平，但足以让你在跨领域协作中理解别人在说什么。最后，保持对新事物的敏感度——每半年花时间了解一个全新的领域，不要等它变成主流了才去追赶。',
    '技能投资是这个世界上风险最低、回报最高的投资。没有之一。它不需要本金，不需要关系，不需要运气。需要的只是一点耐心、一点自律，和持续的行动。当你把自己的技能提升到别人无法忽视的水平时，世界自然会为你让路。',
  ],
  autoCleanup: true,
};

async function main() {
  console.log('=== 搜狐号自动发布 ===');
  console.log('时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('标题:', CONFIG.title);
  console.log('正文:', CONFIG.body.length, '段');
  console.log('');

  try {
    // 1. 启动 Chrome
    console.log('[1/6] 启动 Chrome...');
    await ensureChrome();
    console.log('  ✅ Chrome 已就绪');

    // 2. 检查登录
    console.log('\n[2/6] 检查登录状态...');
    await open('https://mp.sohu.com');
    await sleep(5000);
    const snap0 = await snapshot();
    
    if (snap0.includes('登录') && snap0.includes('注册')) {
      console.log('  需要登录，执行登录流程...');
      let result = await sohuLogin(CONFIG.phone, CONFIG.password);
      console.log('  登录步骤:', result.step);
      console.log('  登录消息:', result.message);

      if (result.step !== 'login_ok') {
        console.log('\n  ⏸ 需要验证码，请在浏览器中完成验证');
        console.log('  完成后，回复"继续"');
        require('fs').writeFileSync(path.join(WORKSPACE, 'sohu_status.txt'), 'NEED_USER_VERIFY', 'utf8');
        const status = await waitForCaptchaDone();
        console.log('  用户完成验证，状态:', status);
      }
    } else {
      console.log('  ✅ 已登录');
    }

    // 3. 打开发布页
    console.log('\n[3/6] 打开发布页...');
    const publishSnap = await openPublishPage();
    console.log('  发布页已加载');

    // 4. 填标题
    console.log('\n[4/6] 填写标题...');
    const titleRef = await fillTitle(CONFIG.title);
    console.log('  ✅ 标题已填写 (ref=' + titleRef + ')');

    // 5. 填正文
    console.log('\n[5/6] 填写正文...');
    const bodyResult = await fillBody(CONFIG.body);
    console.log('  ✅ 正文已填写 (' + bodyResult + ')');

    // 6. 发布
    console.log('\n[6/6] 发布...');
    await publish();
    console.log('  ✅ 发布完成');

    // 截图
    const ssPath = await screenshotAndSave('result');
    console.log('  结果截图:', ssPath);

    if (CONFIG.autoCleanup) {
      await cleanup();
      console.log('\n截图已清理');
    }

    console.log('\n=== ✅ 全部完成 ===');

  } catch (e) {
    console.error('\n❌ 发布失败:', e.message);
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
