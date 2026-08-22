/**
 * 搜狐号文章发布 - 完整脚本模板
 *
 * 标题与正文由「用户的关键词/提示词」生成，不再硬编码。
 *
 * 用法示例：
 * 1) 用关键词/提示词让脚本调用 LLM 生成（需配置 SOHU_LLM_API_KEY）
 *    node scripts/publish.js --prompt="谈谈年轻人为什么不爱存钱"
 *
 * 2) 直接提供关键词（同上，等价）
 *    node scripts/publish.js --keywords="AI  Agent 趋势 2026"
 *
 * 3) 跳过生成，直接给标题+正文（正文为分段的 JSON 数组或分号分隔）
 *    node scripts/publish.js --title="标题" --body="第一段;第二段;第三段"
 *
 * 4) 不传参数：终端交互式询问关键词 + 凭据
 *
 * 前置条件：
 * - Chrome 已关闭所有残留进程
 * - 已安装 isolated-browser skill（由其拉起隔离 Chrome，默认 browser=chrome）
 * - 搜狐号已登录（cookie 保留在 isolated-browser 的 ~/.chrome_qclaw_stable profile 中）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ensureChrome, sohuLogin, waitForCaptchaDone, openPublishPage, fillTitle, fillBody, fillDeclaration, publish, cleanup, screenshotAndSave, generateArticle, parseArticle } = require('./lib.js');
const lib = require('./lib.js');

const WORKSPACE = process.env.QCLAW_WORKSPACE || path.resolve(__dirname, '..', '..', '..');

// ============================================================
// 解析命令行参数
// ============================================================
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--prompt=')) out.prompt = a.slice('--prompt='.length);
    else if (a.startsWith('--keywords=')) out.keywords = a.slice('--keywords='.length);
    else if (a.startsWith('--title=')) out.title = a.slice('--title='.length);
    else if (a.startsWith('--body=')) {
      out.body = a.slice('--body='.length);
    }
  }
  return out;
}

// 把 --body 的传入解析成段落数组
function toBody(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
  } catch (e) { /* 不是 JSON，按分号/换行拆分 */ }
  return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

async function resolveArticle(args) {
  // 1) 直接传入标题+正文，优先级最高（不经过 LLM）
  if (args.title && args.body) {
    const body = toBody(args.body);
    if (body && body.length) return { title: args.title.trim(), body };
  }

  // 2) 用关键词/提示词调用 LLM 生成
  if (args.prompt || args.keywords) {
    console.log('[生成] 根据关键词/提示词生成文章...');
    const art = await generateArticle({ prompt: args.prompt, keywords: args.keywords });
    console.log('  生成标题:', art.title);
    console.log('  生成正文:', art.body.length, '段');
    return art;
  }

  // 3) 交互式询问
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  const ans = (await ask('请提供文章的关键词或提示词（用于生成标题与正文）: ')).trim();
  rl.close();
  if (!ans) throw new Error('未提供关键词/提示词，无法生成文章');

  if (process.env.SOHU_LLM_API_KEY) {
    console.log('[生成] 根据关键词/提示词生成文章...');
    return await generateArticle({ prompt: ans });
  }
  throw new Error('未配置 SOHU_LLM_API_KEY，且未用 --title/--body 直接提供内容，无法生成文章');
}

async function main() {
  console.log('=== 搜狐号自动发布 ===\n');

  const args = parseArgs(process.argv);

  // 获取标题与正文（由用户关键词/提示词生成）
  const article = await resolveArticle(args);
  console.log('标题:', article.title);
  console.log('正文:', article.body.length, '段');
  console.log('');

  try {
    // 1. 启动 Chrome
    console.log('[1/6] 启动 Chrome...');
    await ensureChrome();
    console.log('  Chrome 已就绪');

    // 2. 登录（如需要）
    console.log('\n[2/6] 检查登录状态...');
    const snapText = await lib.snapshot();
    if (snapText.includes('登录') && snapText.includes('注册')) {
      // 需要登录：isolated-browser 路线「登录不填密码」，交由用户手动登录
      console.log('  需要登录，请在浏览器中手动登录搜狐号...');
      await sohuLogin();
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
    const titleRef = await fillTitle(article.title);
    console.log('  标题已填写 (ref=' + titleRef + ')');

    // 5. 填正文
    console.log('\n[5/6] 填写正文...');
    const bodyResult = await fillBody(article.body);
    console.log('  正文已填写 (' + bodyResult + ')');

    // 5.5 必填：选「创作声明 / 必选声明」（不选会被「请添加必选声明」拦截）
    console.log('\n[5.5/6] 选择必选声明...');
    await fillDeclaration('无需声明');
    console.log('  已选「无需声明」');

    // 6. 发布
    console.log('\n[6/6] 发布...');
    await publish();
    console.log('  ✅ 发布完成');

    // 截图留证
    const ssPath = await screenshotAndSave('result');
    console.log('  结果截图:', ssPath);

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
