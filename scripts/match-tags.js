/**
 * 文章标签匹配 + 配图挑选
 *
 * 用法：
 *   node scripts/match-tags.js <article.json> <tag.txt> <pic-tag.txt> [--pic-dir <目录>] [--out <report.json>]
 *
 * 逻辑：
 *   1. 从 tag.txt 中按「文章正文的关键词证据」筛出该文章适用的标签（可多个）
 *   2. 用这些标签与 pic-tag.txt 中每张图的标签做加权匹配评分，取最高分图片
 *   3. 若所有图片得分均为 0（完全不匹配），随机挑一张
 *
 * 评分规则（可在此调整）：
 *   - 每个文章标签有 weight，命中任意关键词即得该权重分
 *   - 婚庆/婚车主题权重最高（10），车型标签权重最低（1）
 *   - 领域加成：图片「业务标签」中婚庆类标签占比 ≥ 50% 时 +8（说明该图是专门做婚庆业务的图）
 */

const fs = require('fs');
const path = require('path');

// ============ 文章标签规则（标签名必须存在于 tag.txt 中） ============
const ARTICLE_TAG_RULES = [
  { tag: '婚庆用车', group: '业务标签', weight: 10, keywords: ['婚车', '婚庆', '婚礼', '婚嫁', '用车'] },
  { tag: '婚庆婚车车队', group: '内容标签', weight: 10, keywords: ['婚车车队', '车队', '婚车', '婚庆', '婚礼', '婚嫁'] },
  { tag: '豪华轿车租赁', group: '业务标签', weight: 3, keywords: ['豪华', '高端', '轿车', '租赁', '租车'] },
  { tag: '奔驰 S 级', group: '内容标签', weight: 1, keywords: ['奔驰', 'S级'] },
  { tag: '宝马 7 系', group: '内容标签', weight: 1, keywords: ['宝马', '7系'] },
  { tag: '奥迪 A8', group: '内容标签', weight: 1, keywords: ['奥迪', 'A8'] },
];

const WEDDING_RE = /婚车|婚庆|婚礼|婚嫁/;
const DOMAIN_BONUS = 8;

// ============ 解析工具 ============

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/\uFEFF/g, '');
}

/** 解析 tag.txt：返回 { 分组名: [标签...] } 与全部标签集合 */
function parseTagFile(text) {
  const groups = {};
  let current = '未分组';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^#{1,6}\s*(.+)$/);
    if (m) { current = m[1].trim(); groups[current] = groups[current] || []; continue; }
    groups[current] = groups[current] || [];
    for (const t of line.split('、')) {
      const v = t.trim();
      if (v) groups[current].push(v);
    }
  }
  const all = new Set();
  Object.values(groups).forEach((arr) => arr.forEach((t) => all.add(t)));
  return { groups, all };
}

/** 解析 pic-tag.txt：返回 [{ no, title, tags: {分组: [..]}, allTags: [..] }] */
function parsePicTagFile(text) {
  const pics = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s*图\s*(\d+)\s*[（(]?([^）)]*)[）)]?\s*$/);
    if (h) {
      cur = { no: Number(h[1]), title: h[2].trim(), tags: {}, allTags: [] };
      pics.push(cur);
      continue;
    }
    const kv = line.match(/^(业务标签|内容标签|属性标签)[:：]\s*(.+)$/);
    if (kv && cur) {
      const list = kv[2].split('、').map((s) => s.trim()).filter(Boolean);
      cur.tags[kv[1]] = list;
      cur.allTags.push(...list);
    }
  }
  return pics;
}

/** 把标签拆成用于匹配的关键词 */
function tagKeywords(tag) {
  const base = tag.replace(/\s+/g, '');
  const out = new Set([base]);
  // 常见后缀/前缀剥离，提高召回
  ['租赁', '租车', '用车', '服务', '海报', '广告'].forEach((w) => {
    if (base.length > w.length && base.includes(w)) out.add(base.replace(w, ''));
  });
  return out;
}

function hit(articleKeywords, imageKeywords) {
  for (const k of articleKeywords) {
    for (const ik of imageKeywords) {
      if (!k || !ik) continue;
      if (k === ik || ik.includes(k) || k.includes(ik)) return ik;
    }
  }
  return null;
}

// ============ 主流程 ============

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const flag = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const [articlePath, tagPath, picTagPath] = positional;
  if (!articlePath || !tagPath || !picTagPath) {
    console.error('用法: node scripts/match-tags.js <article.json> <tag.txt> <pic-tag.txt> [--pic-dir <目录>] [--out <report.json>]');
    process.exit(1);
  }

  const article = JSON.parse(readText(articlePath));
  const articleText = [article.title, ...(article.body || [])].join('\n');
  const { groups: tagGroups, all: allTags } = parseTagFile(readText(tagPath));
  const pics = parsePicTagFile(readText(picTagPath));

  // ---- 1. 选出文章标签 ----
  const articleTags = [];
  for (const rule of ARTICLE_TAG_RULES) {
    if (!allTags.has(rule.tag)) continue; // 必须存在于 tag.txt
    const evidence = rule.keywords.filter((k) => articleText.includes(k));
    if (evidence.length) {
      articleTags.push({ tag: rule.tag, group: rule.group, weight: rule.weight, evidence });
    }
  }

  // ---- 2. 图片评分 ----
  const scored = pics.map((p) => {
    const imgKeywords = new Set();
    p.allTags.forEach((t) => tagKeywords(t).forEach((k) => imgKeywords.add(k)));
    const matched = [];
    let score = 0;
    for (const at of articleTags) {
      const h = hit(tagKeywords(at.tag), imgKeywords);
      if (h) { score += at.weight; matched.push({ tag: at.tag, hit: h, weight: at.weight }); }
    }
    // 领域加成
    const biz = p.tags['业务标签'] || [];
    const weddingRatio = biz.length ? biz.filter((t) => WEDDING_RE.test(t)).length / biz.length : 0;
    let bonus = 0;
    if (weddingRatio >= 0.5) { bonus = DOMAIN_BONUS; }
    return { no: p.no, title: p.title, score, bonus, total: score + bonus, matched, weddingRatio };
  });

  scored.sort((a, b) => b.total - a.total || a.no - b.no);
  const best = scored[0];
  const anyMatch = scored.some((s) => s.total > 0);

  const picDir = flag('--pic-dir', path.dirname(picTagPath));
  let chosen;
  let reason;
  if (anyMatch) {
    chosen = `图 ${best.no}`;
    reason = `最高分 ${best.total}（匹配分 ${best.score} + 领域加成 ${best.bonus}）`;
  } else {
    const pick = scored[Math.floor(Math.random() * scored.length)];
    chosen = `图 ${pick.no}`;
    reason = '所有图片均不匹配标签，按规则随机挑选';
  }
  const chosenNo = Number(chosen.replace(/[^\d]/g, ''));
  const chosenInfo = scored.find((s) => s.no === chosenNo);
  const imagePath = path.join(picDir, `${chosenNo}.jpg`);

  const report = {
    article: { title: article.title, paragraphs: (article.body || []).length },
    tagGroups,
    articleTags,
    imageScores: scored,
    chosen: {
      no: chosenNo,
      title: chosenInfo ? chosenInfo.title : '',
      file: imagePath,
      fileExists: fs.existsSync(imagePath),
      total: chosenInfo ? chosenInfo.total : 0,
      reason,
    },
  };

  const out = flag('--out', '');
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log('=== 文章标签 ===');
  articleTags.forEach((t) => console.log(`  [${t.group}] ${t.tag}  ← 证据: ${t.evidence.join(' / ')}`));
  console.log('\n=== 图片匹配评分（前 5） ===');
  scored.slice(0, 5).forEach((s) => {
    console.log(`  图 ${s.no} ${s.title}: 总分 ${s.total}（匹配 ${s.score} + 婚庆加成 ${s.bonus}）` +
      (s.matched.length ? ' ← ' + s.matched.map((m) => m.tag).join('、') : ' ← 无匹配'));
  });
  console.log(`\n=== 选中 ===\n  图 ${chosenNo}（${chosenInfo ? chosenInfo.title : ''}）`);
  console.log(`  文件: ${imagePath}  存在: ${fs.existsSync(imagePath)}`);
  console.log(`  理由: ${reason}`);
}

main();
