#!/usr/bin/env node
/**
 * 搜狐号文章发布（playwright-core 直连 CDP）
 * ------------------------------------------------------------------
 * 相比 xb CLI 路线的优势：
 *   - 本机 xb CLI 未初始化也能用
 *   - 原生支持 filechooser / setInputFiles，可上传正文配图
 *   - 不需要账号密码写进任何文件（登录态来自已登录的 Chrome profile）
 *
 * 前置：
 *   Chrome 已带 --remote-debugging-port=9222 启动，且已完成搜狐号登录
 *   （登录入口：https://www.sohu.com/ucenter/message/reply 手机验证码登录）
 *
 * 用法：
 *   node scripts/sohu_publish_pw.js --article <article.json> [选项]
 *
 * 选项：
 *   --article <path>   文章 JSON：{ "title": "...", "body": ["段1", ...] }
 *   --image <path>     正文配图；**可重复传多次**指定多张（缺省按标签自动挑 3 张）
 *   --keyword <str>    自动挑图关键词（缺省用文章标题）
 *   --tags "a,b"       文章标签（取自素材库 tag.txt）
 *   --image-top <N>    自动挑选张数（默认 3）
 *   --image-at <N>     单张时的插入位置（1-based，默认 3；多张时按段落自动均分）
 *   --image-dir <dir>  素材目录（不传则自动探测）
 *   --no-image         不配图
 *   --cover <path>     封面图（封面区「上传图片」入口，尺寸须 >450*300；2026-10-13 实测）
 *   --publish          真正点击发布；不带则只填稿并截图（试运行）
 *   --cdp <port>       CDP 端口（默认 9222）
 *   --out-dir <path>   截图/产物输出目录（默认 <skill>/.workspace）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLISH_URL = "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    if (a === "--publish") { out.publish = true; continue; }
    if (a === "--no-image") { out.noImage = true; continue; }
    if (a === "--image") { (out.image = out.image || []).push(argv[++i]); continue; }  // 可重复：多张
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function loadPlaywright() {
  // 首选：公共解析器（不写死用户名 / 盘符 / 版本号）
  try {
    return require(path.resolve(__dirname, "..", "..", "isolated-browser", "scripts", "pathkit.js")).resolvePlaywright();
  } catch (e) { /* 回退本地探测 */ }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cands = [
    process.env.OPENCLAW_NODE_MODULES,
    process.env.PLAYWRIGHT_MODULES,
    home ? path.join(home, ".workbuddy/binaries/node/workspace/node_modules") : null,
  ].filter(Boolean);
  for (const c of cands) {
    try { return require(path.join(c.replace(/[\\/]+$/, ""), "playwright-core")); } catch (e) { /* next */ }
  }
  throw new Error("未找到 playwright-core，请设置 OPENCLAW_NODE_MODULES");
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const CDP = args.cdp || process.env.ISOB_CDP_PORT || "9222";
  const articlePath = args.article;
  if (!articlePath || !fs.existsSync(articlePath)) throw new Error("缺少 --article 或文件不存在");
  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const paras = Array.isArray(article.body) ? article.body : [article.body];
  const OUT = args["out-dir"] || path.join(__dirname, "..", ".workspace");
  fs.mkdirSync(OUT, { recursive: true });

  // 配图：显式 --image（可重复）优先；否则按「标签 → 素材库」自动挑 Top-N（默认 3 张）
  const { planImages } = require(path.resolve(__dirname, "..", "..", "isolated-browser", "scripts", "post_images.js"));
  const plan = planImages({
    explicit: args.image, noImage: args.noImage, keyword: args.keyword || article.title, tags: args.tags,
    top: args["image-top"], layout: args["image-layout"], at: args["image-at"], dir: args["image-dir"],
    paraCount: paras.length,
  });
  const IMAGES = plan.images;
  const imageAt = parseInt(args["image-at"] || "3", 10) || 3;
  console.log(`[配图] ${IMAGES.length} 张（来源 ${plan.source} | 锚点[${plan.slots.join(",") || "-"}]）`);
  if (plan.detail) plan.detail.chosen.forEach((c, i) => console.log(`  ${i + 1}) 图${c.number} ${c.name || ""} → ${c.image}`));

  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("未找到浏览器上下文");
  let page = ctx.pages().find((p) => p.url().includes("sohu.com")) || ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  // ---- 1. 打开发布页 ----
  console.log("[1/7] 打开发布页");
  await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (e) {}
  if (!page.url().includes("addarticle")) {
    throw new Error("未能进入发布页（可能未登录），当前 URL: " + page.url());
  }
  await page.waitForSelector(".ql-editor", { timeout: 20000 });
  const titleInput = page.locator('input[placeholder*="请输入标题"]').first();

  // ---- 2. 填标题 ----
  console.log("[2/7] 填写标题:", article.title);
  await titleInput.click();
  await titleInput.fill("");
  // fill 对该输入框有效；若无效则用键盘输入兜底
  await titleInput.fill(article.title).catch(async () => {
    await titleInput.press("Control+a");
    await page.keyboard.type(article.title, { delay: 20 });
  });
  await sleep(500);
  const titleVal = await titleInput.inputValue().catch(() => "");
  console.log("  标题已填:", titleVal ? `OK（${titleVal.length} 字）` : "失败");

  // ---- 3. 填正文 ----
  console.log("[3/7] 填写正文:", paras.length, "段");
  const html = paras.map((p) => `<p>${p}</p>`).join("");
  const setRes = await page.evaluate(({ html }) => {
    const ed = document.querySelector(".ql-editor");
    if (!ed) return "NOT_FOUND";
    ed.innerHTML = html;
    ed.dispatchEvent(new Event("input", { bubbles: true }));
    ed.dispatchEvent(new Event("change", { bubbles: true }));
    return "SET_LEN_" + ed.textContent.length;
  }, { html });
  console.log("  正文写入:", setRes);
  if (!String(setRes).startsWith("SET_LEN_")) throw new Error("正文写入失败");
  await sleep(1000);

  // ---- 4. 插入配图（支持多张，倒序插入避免段落索引漂移）----
  // 实测机制（2026-10-12）：点 ql-image → 上传弹窗(win-mask) → setInputFiles → 弹窗内出现缩略图
  //   → 必须点弹窗「确定」(.positive-button，是 <p> 不是 button) 图片才落入正文，弹窗随后关闭
  if (IMAGES.length) {
    console.log(`[4/7] 上传配图（${IMAGES.length} 张）`);
    const editor = page.locator(".ql-editor");
    const order = IMAGES.map((img, i) => ({ img, at: Math.min(paras.length, plan.slots[i] || imageAt), i }))
      .sort((a, b) => b.at - a.at);
    for (const it of order) {
      if (!fs.existsSync(it.img)) throw new Error("配图不存在: " + it.img);
      console.log(`  → 图${it.i + 1}: ${it.img}（第 ${it.at} 段后）`);
      const beforeImgs = await page.evaluate(() => document.querySelectorAll(".ql-editor img").length);

      // 光标定位到目标段落
      const targetP = editor.locator("p").nth(it.at - 1);
      try { await targetP.click({ timeout: 5000 }); } catch (e) { await editor.click(); }
      await sleep(300);

      // 打开上传弹窗（点 ql-image 出 win-mask 弹窗，本身不触发系统文件框）
      await page.locator("button.ql-image").first().click();
      await sleep(1800);
      // 在弹窗内触发上传：优先「继续上传」入口 + filechooser，兜底直接喂弹窗内 input[type=file]
      let uploaded = false;
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          page.locator(".win-mask .upload-area, .win-mask .upload-button").first().click(),
        ]);
        await chooser.setFiles(it.img);
        uploaded = true;
        console.log("    上传路线: 弹窗「继续上传」+ filechooser");
      } catch (e) {
        const fi = page.locator(".win-mask input[type=file]").first();
        if ((await fi.count()) && await fi.isVisible().catch(() => false)) {
          await fi.setInputFiles(it.img);
          uploaded = true;
          console.log("    上传路线: 弹窗内 input[type=file]");
        } else {
          throw new Error("配图上传失败：上传弹窗内无可用入口");
        }
      }
      if (!uploaded) throw new Error("配图上传失败：未找到上传入口");

      // 等弹窗内出现缩略图（上传完成标志）
      let thumbOk = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1500);
        const n = await page.evaluate(() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const m = Array.from(document.querySelectorAll(".win-mask")).filter(vis)[0];
          return m ? m.querySelectorAll("img").length : 0;
        });
        if (n > 0) { thumbOk = true; break; }
      }
      if (!thumbOk) throw new Error("上传弹窗内未见缩略图（上传超时）");

      // 点弹窗「确定」——图片此刻才真正插入正文
      const okHit = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const ok = Array.from(document.querySelectorAll(".win-mask .positive-button")).filter(vis)[0];
        if (!ok) return null;
        const r = ok.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
      if (!okHit) throw new Error("上传弹窗「确定」按钮未找到");
      await page.mouse.click(okHit.x, okHit.y);

      // 等弹窗关闭 + 编辑器图片数增加
      let done = false;
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const st = await page.evaluate(() => ({
          maskOpen: !!Array.from(document.querySelectorAll(".win-mask")).find((m) => m.getBoundingClientRect().width > 0),
          imgs: document.querySelectorAll(".ql-editor img").length,
        }));
        if (!st.maskOpen && st.imgs > beforeImgs) { done = true; break; }
      }
      if (!done) throw new Error("第 " + (it.i + 1) + " 张配图未落入正文（点确定后无变化）");
      console.log(`    图片已插入正文（编辑器共 ${await page.evaluate(() => document.querySelectorAll(".ql-editor img").length)} 张）`);
    }
  } else {
    console.log("[4/7] 未配置配图（--no-image 或自动挑选为空），跳过");
  }

  // ---- 4.5 设置封面（--cover <图片>）----
  // 封面区 UI（2026-10-13 probe）：.cover-title「封面」+ 提示「如不填，系统将自动从文中摘取图片作为封面」
  //   + .cover-button「上传图片」+ .pic-cover/.change-cover「编辑封面」；限制「封面图片尺寸应大于450*300」
  if (args.cover) {
    if (!fs.existsSync(args.cover)) throw new Error("封面文件不存在: " + args.cover);
    console.log("[4.5] 设置封面:", path.basename(args.cover));
    await page.locator(".cover-title").first().scrollIntoViewIfNeeded().catch(() => {});
    await sleep(800);
    // 封面区已有 img src 基线（用于判定「新图」出现）
    const beforeSrcs = await page.evaluate(() => {
      let cur = document.querySelector(".cover-title"), srcs = [];
      for (let i = 0; cur && i < 4; i++, cur = cur.parentElement)
        srcs = srcs.concat(Array.from(cur.querySelectorAll("img")).map((im) => im.src));
      return srcs;
    });
    // 逐入口尝试：filechooser 直传 或 弹出上传弹窗（win-mask / el-dialog）
    let route = null;
    for (const sel of [".cover-button", ".change-cover", ".upload-file.mp-upload"]) {
      const el = page.locator(sel).first();
      if (!(await el.count()) || !(await el.isVisible().catch(() => false))) continue;
      const chooserP = page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
      await el.click({ timeout: 6000 }).catch(() => {});
      const chooser = await chooserP;
      if (chooser) { await chooser.setFiles(path.resolve(args.cover)); route = "filechooser:" + sel; break; }
      const maskOpen = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".win-mask, .el-dialog__wrapper"))
          .some((m) => { const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
      if (maskOpen) { route = "mask:" + sel; break; }
    }
    console.log("  封面上传路线:", route || "未找到入口");
    if (!route) throw new Error("封面上传入口未找到（cover-button/change-cover 均不可用）");

    if (route.startsWith("mask:")) {
      // 封面弹窗（.el-dialog__wrapper.select-dialog）三个 Tab：「正文图片」（默认，列出正文已有图）
      //   /「本地上传」/「素材库」；勾选 1 张后底部「确定」（p.button，未选中时带 disable-button）才可点
      await sleep(1500);
      let picked = false;
      const coverIdx = IMAGES.findIndex((p) => path.resolve(p) === path.resolve(args.cover));
      const thumbs = page.locator(".el-dialog__wrapper .content-images .img-wrapper");
      const nThumbs = await thumbs.count();
      if (coverIdx >= 0 && nThumbs > coverIdx) {
        // --cover 就是某张正文配图 → 「正文图片」Tab 直接勾选，零上传
        await thumbs.nth(coverIdx).scrollIntoViewIfNeeded().catch(() => {});
        await thumbs.nth(coverIdx).click({ timeout: 6000 });
        picked = true;
        console.log(`  已勾选「正文图片」第 ${coverIdx + 1}/${nThumbs} 张作封面`);
      } else {
        // 封面图不是正文配图 → 切「本地上传」Tab 上传
        await page.getByText("本地上传", { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
        await sleep(1200);
        const fi = page.locator(".el-dialog__wrapper input[type=file]").first();
        if ((await fi.count())) {
          await fi.setInputFiles(path.resolve(args.cover));
          picked = true;
          console.log("  「本地上传」已提交封面文件");
        }
      }
      if (!picked) throw new Error("封面弹窗内既无正文图片可勾选、本地上传也不可用");
      // 本地上传后可能需手动勾选缩略图（「已选择0张」→ 点第 1 张）
      const selTxt = await page.evaluate(() => {
        const vis = (e) => e.getBoundingClientRect().width > 0;
        const s = Array.from(document.querySelectorAll(".el-dialog__wrapper .success-number")).filter(vis)[0];
        return s ? (s.innerText || "") : "";
      }).catch(() => "");
      if (/已选择\s*0/.test(selTxt)) {
        const t = page.locator(".el-dialog__wrapper .content-images .img-wrapper").first();
        if (await t.count()) { await t.click().catch(() => {}); await sleep(1000); }
      }
      // 等「确定」解除禁用并点击
      let okBtn = null;
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        okBtn = await page.evaluate(() => {
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const btns = Array.from(document.querySelectorAll(".el-dialog__wrapper .bottom-buttons p, .el-dialog__wrapper .bottom-buttons button")).filter(vis);
          const ok = btns.find((b) => (b.innerText || "").trim() === "确定" && !/disable/i.test(b.className));
          if (!ok) return null;
          const r = ok.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        });
        if (okBtn) break;
      }
      if (!okBtn) throw new Error("封面弹窗「确定」仍禁用（未成功勾选图片）");
      await page.mouse.click(okBtn.x, okBtn.y);
      console.log("  已点封面弹窗「确定」");
    }

    // 验证：封面预览出现。⚠️ 预览图是 .pic-cover 的 CSS 背景图（background-image），不是 <img>——
    //   用 img 选择器判据永远为空（2026-10-13 实测坑）
    let coverOk = false;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      coverOk = await page.evaluate(() => {
        const pc = document.querySelector(".pic-cover");
        if (pc) {
          const bi = getComputedStyle(pc).backgroundImage;
          if (bi && bi !== "none" && /url\(/.test(bi)) return true;
        }
        return false;
      });
      if (coverOk) break;
    }
    console.log(coverOk ? "  ✅ COVER_UPLOADED（封面预览已出现）" : "  ❌ 封面未生效（60s 内未见预览图，见 sohu_cover.png 人工核对）");
    await page.screenshot({ path: path.join(OUT, "sohu_cover.png"), timeout: 60000 }).catch(() => {});
    if (!coverOk) throw new Error("封面上传后未见生效");
  }

  // ---- 5. 预览截图 ----
  console.log("[5/7] 保存预览截图");
  await page.screenshot({ path: path.join(OUT, "sohu_filled.png"), timeout: 60000 }).catch(() => {});
  console.log("  ", path.join(OUT, "sohu_filled.png"));

  if (!args.publish) {
    console.log("\n=== 试运行结束（未发布）。加 --publish 参数执行真正发布 ===");
    await browser.close().catch(() => {});
    return;
  }

  // ---- 6. 点击发布 ----
  console.log("[6/7] 点击发布");
  // ⚠️ 必须先勾创作声明（历史坑：不勾会 toast「请添加必选声明」一闪而过、页面不动）
  try {
    const decl = page.locator('label.el-radio:has-text("含有AI生成内容")').first();
    await decl.scrollIntoViewIfNeeded();
    await sleep(400);
    await decl.click({ timeout: 6000 });
    console.log("  已勾创作声明: 含有AI生成内容");
    await sleep(800);
  } catch (e) { console.log("  ⚠️ 声明勾选失败（若发布被拦截请人工核对）:", e.message.split("\n")[0]); }
  let clicked = false;
  // 发布按钮是 <li class="publish-report-btn">（listitem，不是 button）；DOM 里可能有多个，只点可见的
  try {
    const pub = page.locator("li.publish-report-btn:visible").first();
    await pub.scrollIntoViewIfNeeded();
    await sleep(400);
    await pub.click({ timeout: 6000 });
    clicked = true;
  } catch (e) { /* fallback */ }
  if (!clicked) throw new Error("未找到发布按钮");
  console.log("  已点发布");
  await sleep(5000);

  // 确认对话框（循环处理，最多 3 层）
  for (let i = 0; i < 3; i++) {
    const okHit = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const c = Array.from(document.querySelectorAll("button,p,span,li")).filter(vis)
        .find(e => /^(确定|确认)$/.test((e.innerText || "").trim()));
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!okHit) break;
    await page.mouse.click(okHit.x, okHit.y);
    console.log("  已点确认框「确定」");
    await sleep(3500);
  }

  // ---- 7. 验证发布结果 ----
  console.log("[7/7] 验证发布结果");
  let published = false;
  let finalUrl = page.url();
  for (let i = 0; i < 20; i++) {
    finalUrl = page.url();
    if (!finalUrl.includes("addarticle")) { published = true; break; }
    await sleep(1500);
  }
  await page.screenshot({ path: path.join(OUT, "sohu_result.png"), timeout: 60000 }).catch(() => {});
  console.log("  最终 URL:", finalUrl);
  console.log(published ? "  ✅ 发布成功" : "  ❌ 仍在编辑页，发布失败（见 sohu_result.png）");
  console.log("  结果截图:", path.join(OUT, "sohu_result.png"));

  await browser.close().catch(() => {});
  process.exit(published ? 0 : 1);
})().catch((e) => {
  console.error("发布失败:", e.message);
  process.exit(1);
});
