# Stanford 状态恢复实验归档

本实验验证固定提交 `joonspk-research/generative_agents@fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4` 的两个记忆类，使用合成最小状态和文件存在检查替身。完整应用、三角色行为和用户收益未验证。

从仓库根目录执行：

```powershell
node experiments/stanford-state-recovery/publish.mjs
node experiments/stanford-state-recovery/verify.mjs
```

发布依赖已构建的服务端 schema、现有 `.data/experiments/stanford-state-20261024/` 材料及研究记录；五份源码先通过 Git blob 校验，再检查结果并发布到 `.data/demand-live-20261023/technical-experiments/`。验证依赖 4318 隔离实例、Playwright 和 Edge，读取真实归档、下载产物，检查需求回链和未改写历史，不调用模型。

`scripts/verify-stanford-state-recovery.py` 是原始探针，会重建本地 `recovery-probe` 目录并覆盖结果；重跑前应保留需要的旧结果。已有产物没有记录当时探针哈希，归档的复现脚本是发布时快照。原始探针使用本机隔离 Python 3.12.7。来源重建脚本 `scripts/prepare-stanford-state-probe.mjs` 依赖保存的研究数据库；本归档的 `reproduction.json` 同时包含源码和脚本快照供复核。
