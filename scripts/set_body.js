const { spawn } = require('child_process');

const XB = 'C:\\Users\\菠萝\\.qclaw\\skills\\xbrowser\\scripts\\xb.cjs';

const html = [
  '<p>在这个充满不确定性的时代，什么才是真正属于你自己的东西？房子可能贬值，工作可能被裁，股票可能套牢——但技能不会。技能，是唯一能穿越周期、陪你走完一生的硬通货。</p>',
  '<p>技能的本质，是"解决问题的能力"。它会编程，能做出一个网站；会写作，能表达一个观点；会沟通，能促成一次合作。每一个技能的背后，都是你在这个世界上的存在方式。世界不需要你知道多少知识，但永远需要你能解决多少问题。</p>',
  '<p>技能的分水岭不在"会不会"，而在"到不到位"。同样学 Python，有人只能打印 Hello World，有人能搭建一个完整的后端系统。中间的差距不是天赋，而是刻意练习的时长和方法。一万小时定律也许不够精确，但方向是对的——没有足够的投入，任何技能都只能停留在"知道"的层面。</p>',
  '<p>更重要的是，技能具有复利效应。你学会一项新技能，不是简单地在能力清单上加一条，而是为其他技能的发挥创造新的可能性。会写作的人学会了编程，能做出自动化的内容工具；会设计的人学会了商业思维，能把作品卖个好价钱。技能之间的组合，才是真正的护城河。</p>',
  '<p>但这个时代最残酷的真相是：没有一项技能是终身有效的。十年前最吃香的 SEO 优化师，今天已经被算法推荐取代了大半。五年前大火的小程序开发，今天已经成为基础能力。技能的半衰期越来越短，持续学习不再是可选项，而是生存的底线。</p>',
  '<p>那么，普通人应该如何构建自己的技能体系？首先，打造一项核心技能——能让你在某个领域站住脚的深度能力。它应该是你花最多时间打磨的、能持续为你创造价值的那一项。其次，拓展两到三项辅助技能——它们不需要达到顶尖水平，但足以让你在跨领域协作中理解别人在说什么。最后，保持对新事物的敏感度——每半年花时间了解一个全新的领域，不要等它变成主流了才去追赶。</p>',
  '<p>技能投资是这个世界上风险最低、回报最高的投资。没有之一。它不需要本金，不需要关系，不需要运气。需要的只是一点耐心、一点自律，和持续的行动。当你把自己的技能提升到别人无法忽视的水平时，世界自然会为你让路。</p>'
].join('');

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

const b64 = Buffer.from(setScript).toString('base64');

function xb(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [XB, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch(e) {} reject(new Error('timeout')); }, timeout);
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  const r = await xb(['run', '--browser', 'chrome', 'eval', '--base64', b64], 15000);
  console.log(r.out);
}

main().catch(e => console.error(e));
