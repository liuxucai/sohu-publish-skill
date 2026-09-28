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
 *   --image <path>     正文配图（插在第 --image-at 段之后，默认第 3 段）
 *   --image-at <N>     插图段落位置（1-based，默认 3）
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
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function loadPlaywright() {
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
  const CDP = args.cdp || "9222";
  const articlePath = args.article;
  if (!articlePath || !fs.existsSync(articlePath)) throw new Error("缺少 --article 或文件不存在");
  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  const paras = Array.isArray(article.body) ? article.body : [article.body];
  const IMG = args.image || "";
  let imageAt = parseInt(args["image-at"] || "3", 10);
  if (!Number.isFinite(imageAt) || imageAt < 1) imageAt = 3;
  const OUT = args["out-dir"] || path.join(__dirname, "..", ".workspace");
  fs.mkdirSync(OUT, { recursive: true });

  if (IMG && !fs.existsSync(IMG)) throw new Error("配图不存在: " + IMG);
  if (IMG && imageAt > paras.length) imageAt = paras.length;

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

  // ---- 4. 插入配图 ----
  if (IMG) {
    console.log(`[4/7] 上传配图（插在第 ${imageAt} 段后）: ${IMG}`);
    const editor = page.locator(".ql-editor");
    const targetP = editor.locator("p").nth(imageAt - 1);
    try { await targetP.click({ timeout: 5000 }); } catch (e) { await editor.click(); }
    await sleep(300);

    let uploaded = false;
    // 路线 A：点击工具栏图片按钮，捕获 filechooser
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 8000 }),
        page.locator("button.ql-image").first().click(),
      ]);
      await chooser.setFiles(IMG);
      uploaded = true;
      console.log("  上传路线: filechooser");
    } catch (e) {
      // 路线 B：点击后找隐藏 file input
      try {
        await page.locator("button.ql-image").first().click();
        await sleep(1500);
        const fi = page.locator('input[type="file"]').first();
        await fi.setInputFiles(IMG);
        uploaded = true;
        console.log("  上传路线: hidden input[type=file]");
      } catch (e2) {
        // 路线 C：点击「上传图片」文字项后再找
        await page.locator(".upload-file.mp-upload, .upload-tip").first().click().catch(() => {});
        await sleep(1500);
        const [chooser2] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 8000 }),
          Promise.resolve(),
        ]).catch(() => [null]);
        if (chooser2) { /* filechooser 已打开的情况不常见 */ }
        const fi2 = page.locator('input[type="file"]').first();
        await fi2.setInputFiles(IMG);
        uploaded = true;
        console.log("  上传路线: 上传图片入口 + input");
      }
    }
    if (!uploaded) throw new Error("配图上传失败：未找到上传入口");

    // 等待图片真正上传完成（编辑器中出现 http src 的 img）
    let okImg = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1500);
      const st = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll(".ql-editor img"));
        const ready = imgs.filter((im) => /^https?:/.test(im.getAttribute("src") || ""));
        const busy = /上传中|加载中/.test(document.querySelector(".ql-editor")?.innerText || "");
        return { total: imgs.length, ready: ready.length, busy };
      });
      if (st.ready > 0 && !st.busy) { okImg = true; console.log(`  图片就绪（${st.ready}/${st.total}）`); break; }
    }
    if (!okImg) console.log("  ⚠️ 未确认图片上传完成，请人工检查预览截图");
  } else {
    console.log("[4/7] 未提供配图，跳过");
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
  let clicked = false;
  // 发布按钮是 li（listitem），不是 button
  const cands = [
    page.locator('li', { hasText: /^\s*发布\s*$/ }),
    page.locator('[role="listitem"]', { hasText: /^\s*发布\s*$/ }),
    page.locator('button', { hasText: /^\s*发布\s*$/ }),
    page.locator('span', { hasText: /^\s*发布\s*$/ }),
  ];
  for (const c of cands) {
    try {
      const el = c.first();
      await el.waitFor({ state: "visible", timeout: 4000 });
      await el.click({ timeout: 5000 });
      clicked = true;
      break;
    } catch (e) { /* next */ }
  }
  if (!clicked) throw new Error("未找到发布按钮");
  await sleep(5000);

  // 确认对话框
  try {
    const confirmBtn = page.locator('button:has-text("确定")').first();
    await confirmBtn.waitFor({ state: "visible", timeout: 6000 });
    await confirmBtn.click();
    console.log("  已点确认框「确定」");
  } catch (e) { /* 无确认框 */ }
  await sleep(5000);

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
