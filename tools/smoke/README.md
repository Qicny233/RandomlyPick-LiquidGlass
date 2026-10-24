# 部署冒烟检查

CI 在每次 Pages 部署后运行 `check_deploy.mjs`，只用 Node 自带的 `fetch`，零依赖。检查内容：

- 正式版首页、`version.json` 版本号、渠道设置是否还在
- Beta 首页、`version.json` 版本号、赛车资源是否齐全
- 两版互不污染：正式版根目录不能出现 `race.html`

本地手动验证已部署站点：

```bash
SMOKE_BASE=https://qicny233.github.io/RandomlyPick-LiquidGlass/ node tools/smoke/check_deploy.mjs
```

交互级验证（引导、渠道弹窗、赛车、音效、移动端布局）仍用本地 `_lx_*_probe.js`，
通过 headless Edge 的 CDP 跑；这类测试依赖浏览器，不放进 CI。
