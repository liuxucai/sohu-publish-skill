# 安全审查记录（安装时）

- **来源**：https://github.com/liuxucai/sohu-publish-skill （main 分支，单次提交）
- **审查时间**：2026-09-18
- **审查范围**：全部 8 个文件（SKILL.md、references/×3、scripts/×3、templates/×1）

## 结论

**无恶意代码**。脚本中不存在任何出站网络请求、远程代码加载、混淆代码或凭据外传逻辑；
文件删除仅限自身工作区内的截图。**定级 P1**（非 P0），已按 P1 流程清洗后安装。

## 发现的问题与处置

| # | 问题 | 等级 | 处置 |
|---|------|------|------|
| 1 | 源码与文档中硬编码作者本人的搜狐号手机号与密码（出现在 SKILL.md、login.js、publish.js、workflow.md、commands.md） | P1 敏感信息泄露 | 已全部移除，改为环境变量 / `config.json` 读取；示例改用占位符 |
| 2 | 路径硬编码为作者机器（`C:\Users\菠萝\.qclaw\...`、`.agent-browser\tmp`） | P1 环境不兼容 | 改为 `scripts/config.js` 运行时解析，支持环境变量覆盖 |
| 3 | 依赖非标准工具 xb CLI（xbrowser 的 `xb.cjs`），非 WorkBuddy 内置能力 | 提示 | 2026-09-23 后续处置：本机 xb CLI 未初始化、实测不可用，**xb 路线相关文件（lib.js / login.js / publish.js / config.js / config.example.json / references/commands.md / templates/article.txt）已全部删除**，技术路线整体切换为 playwright-core 直连 CDP |
| 4 | 启动前 `taskkill /F /IM chrome.exe` 会强制关闭用户全部 Chrome 窗口 | 提示 | 已在 SKILL.md 环境要求与已知限制中标注 |
| 5 | 上游仓库的样本文章（publish.js 内置正文）被移出脚本 | 优化 | 改为从 `articles/current.json` 读取 |

## 未发现的风险

- 无 `http/https` 外发、无 telemetry、无 webhook
- 无 `child_process` 执行远程下载内容（仅调用本机 Chrome 与 xb CLI）
- 无读取浏览器 cookie / 密码库等用户敏感文件的行为
- 无 `rm -rf` 类破坏性命令（仅删除自身工作区 `*.png`/`*.jpg`）

## 维护提示

若从上游重新拉取更新，**必须**重新执行本审查：上游存在公开泄露的账号密码，
且路径与工具依赖可能变化。
