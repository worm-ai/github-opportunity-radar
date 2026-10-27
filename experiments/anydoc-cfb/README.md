# AnyDoc / CFB：公开 TextEdit DOC 样本边界实验

目的：验证 [AnyDoc #37](https://github.com/firecrawl/anydoc/issues/37) 的故障层，检验“宽松 OLE 读取后重新写出，再交给 AnyDoc”是否足够。不把转换器的一个兼容性缺陷推断为商业机会。

在仓库根目录执行：

```powershell
node experiments/anydoc-cfb/prepare.mjs
npm install --prefix .data/experiments/anydoc-cfb --ignore-scripts --no-audit --no-fund
node experiments/anydoc-cfb/run.mjs
```

准备脚本通过现有 GitHub 客户端下载 Issue 作者公开的 19,456 字节样本，校验固定 Git Blob SHA 和 SHA-256。依赖固定为 `@firecrawl/anydoc@0.2.4` 与 `cfb@1.2.2`，运行脚本核对 lockfile 完整性值。所有下载、依赖与结果位于忽略目录 `.data/experiments/anydoc-cfb`，不改主产品依赖。首次准备需要 GitHub 网络连接及已编译的 sensor 包；运行实验无需网络，也不读取 `.env`。

实验比较原文件的自动/显式格式转换、CFB 通用重写、仅对固定样本修正未使用的 MiniFAT，以及一个非 OLE 负例。修正前检查四个实际流均至少 4,096 字节，修正后比较每个流的名字、长度和 SHA-256；实际只将 512 字节零值 MiniFAT 改为 FREESECT。

2026-10-20 本机结果：原文件重现 `unsupported` / `malformed MiniFAT`；CFB 通用重写后依然因 FAT 验证失败；固定样本修正后得到 `Alpha paragraph.` 和 `Beta paragraph.`，四个流字节一致。这只定位了该样本的兼容性问题，不构成一般修复算法、完整文档保真证明或市场验证。不要把脚本用于用户文件。

`result.json` 保存成功与失败的真实输出、版本、输入哈希、流哈希和局限；`output.md` 是修正后的转换文本。运行 `node experiments/anydoc-cfb/publish.mjs` 可把经过校验的 JSON/Markdown 发布到本机产品的只读“技术实测”，不分发原始或修改后的 DOC。

`node experiments/anydoc-cfb/record-decision.mjs` 是真实操作：需要生产工作区已收录 AnyDoc 与 CFB，且已核查 #37 的讨论；通过 Edge 表单保存一条“代理研究，待人工复核”的停止判断。它同时验证归档下载哈希和移动端展示，禁止其他写请求，不调用模型。再次运行会按固定标题复用已有记录，不作为通用回归测试。
