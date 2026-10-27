# 本地 PDF 预处理与人工复核实验

目的：核查 OpenDataLoader 的开源自动打标与 veraPDF 机械检查能否连接，并观察部门目录、同名文件、已有人工标签和图像输入的交付边界。不是通用修复器、合规认证或真实用户验证。

固定版本：OpenDataLoader 2.5.13、veraPDF 1.28.2、pypdf 6.21.1。源码标签与二进制 SHA-256 在 `prepare.ps1` 和实验目录 `runtime.json` 中保留。仅使用本地合成文件，无模型、Adobe、AWS或其他付费API。

## 运行

需要 Python 3.12 和 Java 17+。当前环境复用上一实验的隔离 Python 3.12.10，不修改其包目录；新 wheel 提取到本实验自己的目录。Java 默认指向本机 JBR 21.0.6，可通过 `RADAR_EXPERIMENT_JAVA` 指向自己的 `java.exe`。

在项目根执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/pdf-accessibility/prepare.ps1
& .data/experiments/actual-ecommerce-noter/python/python.exe experiments/pdf-accessibility/run.py
```

veraPDF 的 Maven JAR 默认入口是 GUI；实验明确以 `org.verapdf.apps.GreenfieldCliWrapper` 初始化并调用 CLI，在无界面模式运行。不要将内部 `VeraPdfCli` 直接当入口，它不会初始化默认解析 foundry。

`run.py` 生成四份单页诊断PDF，执行一次直接目录基线、两次按目录打标和两次独立验证。结果、原始日志、PDF输入输出和 `review-queue.csv` 位于 `.data/experiments/pdf-accessibility`。脚本断言两个部门内容分别保留、原输入不变、已有标签输入逐字节保留、两份独立校验实际完成且未通过；不把退出码本身当作有效校验报告。

## 已取得的结论

- 原CLI可递归读取四份输入，但平铺输出使两个部门的同名文件发生覆盖。
- 直接重新打标将已有人工Alt标记改成 `image 1`。实验分流选择保留已有标签的文件原字节；仍需审查原标签质量。
- 新Tagged PDF可以交给独立veraPDF检查，两份输出各有5条失败规则/6个失败检查。
- 图像输入进入OCR/人工队列，本次没有执行OCR。

合成文本使用未嵌入Helvetica，且缺少完整PDF/UA元数据、语言等条件。因此不能据此宣称上游工具造成了所有失败，或推断真实语料失败率。独立机械检查也不能证明阅读顺序和替代文本语义正确。

## 归档和工作区写入

完成实测后执行 `node experiments/pdf-accessibility/publish.mjs`，会在真实工作区增加一份技术实测归档；它不运行模型或写市场验证。重复发布同一次已执行结果核对不可变内容；重新运行实验会取得新执行时间，不要为回归检查反复发布相同研究。

`node experiments/pdf-accessibility/record-decision.mjs` 是真实研究操作：通过Edge保存一条明确标为代理作者的判断，核对六份准确引文、五份下载哈希、导出及桌面/手机布局。已有同标题判断时不重复写入；不是普通只读测试。完整研究及市场边界见[研究报告](../../docs/research/2026-10-20-pdf-workflow.md)。

## 真实公开长文档的有界检查

另一个实验使用已克隆 iii 仓库中的固定公开手册，不把合成输入当真实语料。准备脚本复用已保存的上游树，记录每份来源的 `available`、离线未尝试或获取失败状态；遇到首次网络错误后暂停剩余下载。当前 HTTPS 证书链不受信任，选择显式离线模式，不关闭校验或重试同一路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File experiments/pdf-accessibility/prepare-real-corpus.ps1 -Offline -IncludeLocalHandbook
& .data/experiments/actual-ecommerce-noter/python/python.exe -X utf8 experiments/pdf-accessibility/run-real-corpus.py
& .data/experiments/actual-ecommerce-noter/python/python.exe -X utf8 experiments/pdf-accessibility/verify-real-preservation.py
& .data/experiments/actual-ecommerce-noter/python/python.exe -X utf8 experiments/pdf-accessibility/build-real-handoff.py
```

每次主流程新建运行目录，最多12份已取得文件、单份25MiB/100页，每次Java调用180秒上限。已有结构或表单先保留；无文本层交人工分流；混合文档的无文本页显式进入人工检查。`verify-real-preservation.py` 使用打标器所附PDFBox，对每页72DPI像素、链接目标及位置作比较，不导出页面图片。局部查看页面可使用 `RenderLocalReview.java`，只供本地研究，不归档受限插图。

实际本轮只取得1份66页游戏手册，其余11份未取得，不是机构语料。前后机械失败规则8→3，文本/像素/122链接保留，但第13页表格变成列表、41个Figure均为image N替代文本。`build-real-handoff.py` 对这份已固定输入生成129项有重叠的待复核任务；不是通用专家检查器、已确认缺陷数量或工时估算。

完成检查后，`node experiments/pdf-accessibility/publish-real.mjs` 发布十份无PDF/页面图片的不可变技术产物；`node experiments/pdf-accessibility/record-real-decision.mjs` 通过真实界面修订原判断并保留历史。后者会写实际工作区，只用于授权研究操作，不作普通测试。当前决定是等待专家评估、暂停自动交付产品化；运行说明及来源边界见[真实公开文档报告](../../docs/research/2026-10-21-pdf-public-corpus.md)。
