# Map Design + GenOffice 技术实验

这是机会捕手研究过程中实际执行的接口实验，不是新的地图产品，也不是市场验证。完整结论见[实测报告](../../docs/research/2026-10-20-map-pptx-experiment.md)。

输入来自固定提交内的美国人口变化 CSV 示例，原仓库标注 US Census；没有独立复核统计源。更新和异常数据明确为人工诊断输入。上游代码保存在被忽略的 `.data/experiments`，保留其许可证及通知；不会作为机会捕手运行依赖安装到主工作区。

准备并执行（先完成项目依赖安装及包构建）：

```powershell
node experiments/map-pptx/prepare.mjs
npm.cmd install --prefix .data/experiments --ignore-scripts --no-audit --no-fund jszip@3.10.1 fast-xml-parser@5.3.4
node experiments/map-pptx/build-bridge.mjs
node experiments/map-pptx/run.mjs
```

`prepare` 通过 GitHub API 读取固定提交的文件，逐个验证 Git Blob 哈希；凭证只从本地环境读取。`build-bridge` 使用已安装的 esbuild 构建 GenOffice 演示文稿引擎及操作层，不构建桌面应用。`run` 调用 Map Design CLI，检查地区和值、缺失值、未匹配与重复数据，然后调用 GenOffice 的真实 `addPicture`、`replacePicture`、`setNotes`，保存并重新打开 PPTX。输入、日志、哈希和结果写入带时间的运行目录。

本机安装了 PowerPoint 的 Windows 环境可继续独立渲染：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments/map-pptx/render-powerpoint.ps1
node experiments/map-pptx/verify-powerpoint.mjs
node experiments/map-pptx/publish.mjs
```

PowerPoint 脚本只读打开刚生成的三个演示稿，不显示编辑窗口、不保存输入；若已有 PowerPoint 进程，不退出用户的应用。验证在同一个 PowerPoint 版本内比较重复更新，不能推断跨渲染器像素一致。`publish` 将通过检查的实际记录和八份产物归档到 `.data/technical-experiments`，工作台的“技术实测”页面只读展示；无付费模型调用，不写市场验证记录。

SQLite 备份不包含这些文件产物；保存完整研究记录时应一并复制 `.data/technical-experiments`。目前没有产品内执行上游代码或编辑实测记录的功能。
