#!/usr/bin/env node
/**
 * 启动带 CDP 调试端口的独立 Chrome 实例（不干扰用户已打开的浏览器）
 *
 * 用法：
 *   node scripts/launch-cdp-chrome.js [--port 9222] [--profile <目录>] [--url <起始页>]
 *
 * 说明：
 *   - 绝不 taskkill 用户正在运行的 chrome.exe（发布流程不需要，会毁掉用户工作）
 *   - 使用独立 user-data-dir，首次启动后可在该窗口中完成搜狐号登录，登录态持久保存
 *   - 启动后本脚本退出；Chrome 进程独立存活
 *   - 若端口已被占用（已有调试实例），直接复用，不重复启动
 */
"use strict";

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function cdpAlive(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function findChrome() {
  const cands = [
    process.env.SOHU_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  throw new Error("未找到 Chrome，请设置环境变量 SOHU_CHROME_PATH");
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port || "9222";
  const profile =
    args.profile ||
    path.join(__dirname, "..", "profiles", "chrome");
  const startUrl = args.url || "about:blank";

  if (await cdpAlive(port)) {
    console.log(`CDP 端口 ${port} 已有实例在运行，直接复用。`);
    process.exit(0);
  }

  fs.mkdirSync(profile, { recursive: true });
  const chrome = findChrome();
  console.log("启动 Chrome:", chrome);
  console.log("profile:", profile);
  console.log("CDP 端口:", port);

  // detached + unref：脚本退出后 Chrome 继续运行
  // ⚠️ WorkBuddy 沙箱会回收 detached 子进程时，须以 run_in_background 方式运行本脚本保活：
  //    node scripts/launch-cdp-chrome.js && sleep 7200
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      startUrl,
    ],
    { detached: true, stdio: "ignore", windowsHide: false }
  );
  child.unref();

  // 等待 CDP 就绪（最多 20 秒）
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await cdpAlive(port)) {
      console.log(`✅ Chrome 调试实例已就绪: http://127.0.0.1:${port}`);
      process.exit(0);
    }
  }
  console.error("❌ CDP 端口未就绪（Chrome 可能启动失败或 profile 被占用）");
  process.exit(1);
})();
