#!/usr/bin/env node
/**
 * 搜狐号发布页结构探测（playwright-core 直连 CDP）
 *
 * 用法：
 *   node scripts/sohu_probe.js [--cdp 9222] [--url <发布页URL>] [--out-dir <目录>]
 *
 * 输出：
 *   - 登录状态判断（mp.sohu.com 是否已登录）
 *   - 发布页 URL / 标题候选 / contenteditable 列表 / input[type=file] / 按钮与菜单文本
 *   - 截图与元素清单写入 out-dir
 *
 * 前置：已用 --remote-debugging-port 启动 Chrome（默认 9222），且该 profile 有搜狐号登录态。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
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
    try {
      return require(path.join(c.replace(/[\\/]+$/, ""), "playwright-core"));
    } catch (e) { /* next */ }
  }
  throw new Error("未找到 playwright-core，请设置 OPENCLAW_NODE_MODULES");
}

const args = parseArgs(process.argv.slice(2));
const CDP = args.cdp || process.env.ISOB_CDP_PORT || "9222";
const HOME_URL = "https://mp.sohu.com";
const PUBLISH_URL = args.url || "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1";
const OUT = args["out-dir"] || path.join(__dirname, "..", ".workspace");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("未找到浏览器上下文，请确认 Chrome 以 --remote-debugging-port 启动");
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

  // ---- 1. 登录态 ----
  console.log(`[1/3] 打开 ${HOME_URL}`);
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const homeInfo = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasLoginForm: !!document.querySelector("input[type=password]"),
    text: document.body.innerText.slice(0, 600),
  }));
  const loggedIn = !homeInfo.hasLoginForm && !/登录|注册/.test(homeInfo.text.slice(0, 200));
  console.log("  URL:", homeInfo.url);
  console.log("  title:", homeInfo.title);
  console.log("  有登录表单:", homeInfo.hasLoginForm);
  console.log("  判断登录态:", loggedIn ? "已登录" : "未登录/不确定");
  fs.writeFileSync(path.join(OUT, "probe-home.txt"), JSON.stringify(homeInfo, null, 2), "utf8");

  // ---- 2. 发布页 ----
  console.log(`\n[2/3] 打开发布页`);
  await page.goto(PUBLISH_URL, { waitUntil: "domcontentloaded" });
  await sleep(8000);
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch (e) {}

  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map((el) => ({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 80),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
      len: el.textContent.length,
      placeholder: el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || "",
    }));
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        accept: el.accept || "",
        multiple: el.multiple,
        hidden: el.offsetParent === null,
        w: Math.round(r.width), h: Math.round(r.height),
        cls: (el.className || "").toString().slice(0, 60),
      };
    });
    const texts = Array.from(document.querySelectorAll("textarea, input[type=text], [class*=title]"))
      .slice(0, 20)
      .map((el) => ({
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        cls: (el.className || "").toString().slice(0, 70),
        placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder") || "",
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      }));
    const clickables = Array.from(document.querySelectorAll("button, li, [role=button], [class*=upload], [class*=cover]"))
      .map((el) => ({ tag: el.tagName, txt: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24), cls: (el.className || "").toString().slice(0, 60) }))
      .filter((x) => x.txt)
      .slice(0, 120);
    return { url: location.href, title: document.title, editables, fileInputs, texts, clickables, bodyLen: document.body.innerText.length };
  });
  console.log("  URL:", info.url);
  console.log("  contenteditable:", JSON.stringify(info.editables));
  console.log("  input[type=file]:", JSON.stringify(info.fileInputs));
  console.log("  文本输入候选:", JSON.stringify(info.texts));
  const uploadish = info.clickables.filter((c) => /图|上传|封面|相册|素材/.test(c.txt));
  console.log("  含「图/上传/封面」的点击项:", JSON.stringify(uploadish));

  fs.writeFileSync(path.join(OUT, "probe-publish.json"), JSON.stringify(info, null, 2), "utf8");
  const snap = await page.screenshot({ path: path.join(OUT, "probe-publish.png"), fullPage: false });
  console.log("  截图:", path.join(OUT, "probe-publish.png"));

  console.log(`\n[3/3] 探测结果已写入 ${OUT}`);
  await browser.close().catch(() => {});
}

main().catch((e) => {
  console.error("探测失败:", e.message);
  process.exit(1);
});
