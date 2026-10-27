# 讨论核查：先判断问题是否仍存在

2026-10-20；本轮真实读取 GitHub、通过产品核查两条讨论并收录一个已有组件。没有新增付费模型调用、机会卡片、访谈、试用或付费记录。

本轮产出是两个可追溯的研究决定：Talorys 的通用 MCP 接入已有未合并实现，先核对其范围；PhotoCraft 的通用 ComfyUI 桥接已有多个项目，先查明精度损失究竟发生在哪一层。两者均不足以成为一个新的商业机会结论。

## 为什么核查评论

原流程常规采集开放 Issue 的正文前 2,000 字符，模型深读前 1,200 字符。这个样本可发现问题线索，却可能漏掉后来的实现、替代与反证。Issue 仍 open 不能推出功能完全缺失，单个作者描述的失败也不能推出所有版本和路径都会失败。

研究表单现在可按需读取状态、较长正文和最早十条评论，保留原文、链接、身份关联与边界。这增加了可核查资料；本轮没有做用户用时对照，不能声称已经节省多少筛选时间或提高模型质量。

## Talorys：已有提案，但没有合并

- [Issue #1：Support for MCP Servers](https://github.com/rociiu/talorys/issues/1) 由 `shyim` 提出。产品在 **13:29:33 UTC** 读取时仍 open，评论一条，条数与分页核对完整，正文无截断。
- [评论 6159351086](https://github.com/rociiu/talorys/issues/1#issuecomment-6159351086) 来自 CONTRIBUTOR `michaeltuszynski`，原文：

  > I've opened #42 for the MCP part of this.

- 人工经官方 API 只读核对 [PR #42](https://github.com/rociiu/talorys/pull/42)，**13:30:21 UTC** 的状态为 `open`、`merged=false`、`merged_at=null`。PR 描述涉及远程 MCP、工具策略、审批和调用预算；插件系统、OAuth 与定时运行中的 MCP 工具均不在此 PR 范围。

**决定：** 不继续把“给 Talorys 加普通 MCP 接入”当作全新组合。不能说 MCP 已发布，也不能把未覆盖项自动当成新商机。下一次若研究 OAuth 或定时工具，先找实际工作障碍和维护方计划，再判断是否需新的组合。

这次 PR 状态由人工 API 核对并归档；产品只自动采集该 Issue 与评论，**不会自动跟随 #42、确认合并或检测发布**。PR 描述中的测试结果仍是贡献者陈述，本轮没有执行它。

## PhotoCraft：通用桥接已存在，精度问题需分路径复现

产品在 **13:29:22 UTC** 核查 [Issue #7734](https://github.com/storytold/photocraft/issues/7734)，当时 open、三条评论，条数与分页核对完整，正文及三条评论均无截断。原问题是外部应用编辑后的回传流程，包括临时文件、启动应用、检测返回、图层导入与取消，不是泛泛地要求“接入 AI”。

| 来源 | 实际说了什么 | 能支持的范围 |
| --- | --- | --- |
| [Bot 评论 6266258899](https://github.com/storytold/photocraft/issues/7734#issuecomment-6266258899) | 提供相关 Issue 链接 | 导航线索，不能算独立需求 |
| [3dvizor 评论 6287232504](https://github.com/storytold/photocraft/issues/7734#issuecomment-6287232504) | 自述做过 ComfyUI 桥接；导回图层出现 8-bit、原点定位问题，并指向 #7779 | 特定作者、环境与图层路径的失败陈述，本轮未复现 |
| [Filipe80oli 评论 6287537287](https://github.com/storytold/photocraft/issues/7734#issuecomment-6287537287) | Win11 / 0.10.0，用已知 16-bit PNG/TIFF 打开为新文档，观察 depth=16、保存 TIFF 的 BitsPerSample=16 | 构成对“所有文件往返必然变 8-bit”的反证；作者明确未检验 pixel-exact，不能证明数值无损 |

对现有 8-bit 文档插入新图层是否导致差异，后者明确称为未验证猜测。不能把这段猜测改写成根因。

人工还只读核对 [#7779](https://github.com/storytold/photocraft/issues/7779) 与 [#7864](https://github.com/storytold/photocraft/issues/7864)，当时均 open。前者由同一位 `3dvizor` 提出，要求 native-depth、坐标精确的 getPixels/putPixels；不能再次算作新的独立需求作者。后者由另一登录名提出外部 TIFF 编辑及回传，并指出 LightCraft 已有 launcher。它们都没有证明客户身份或付费。

### 在产品内寻找已有替代

实际 Edge 从 #7734 进入研究表单，以 `photocraft comfyui` 搜索，**13:30:57 UTC** 返回六个结果并展示六个。包括原 Issue 提到的 [the-aSak/ComfyUI-Photocraft-Bridge](https://github.com/the-aSak/ComfyUI-Photocraft-Bridge)，以及 Avgilles、zhuanqianfish、estesochoa386052-art、Peszemeszek、Philippsapegin 的相关仓库。

这些搜索结果只证明存在相关项目自述，未逐个安装或评测。结果随索引变化，不代表完整竞品清单，也不能把零 Star 视为不可用。

随后只按地址收录 **the-aSak/ComfyUI-Photocraft-Bridge**，采集时间 **13:31:32 UTC**，无 warning，保留 #7734 起点并带入第二组件。其 README 已进入真实项目档案，描述两个 ComfyUI 节点：读取 PhotoCraft 图像/选区、将结果作为图层回传。README 明确写道：

> Images travel as 8-bit PNG. 16-bit documents come back as 8-bit layers.

它还描述 `target`、坐标/填充处理和模型缩放导致的定位限制。这些是项目自述，不能冒充我们的实测，也不能据此证明所有其他桥接有同样限制。

**决定：** 停止“再做一个普通 PhotoCraft–ComfyUI 桥接”的方向。更具体的研究线索是已有流程的精度、色彩、位置和文档深度兼容性；首先区分桥接自身的格式转换、PhotoCraft 新文档导入、现有文档插层三个环节。当前证据不能排除单项目修改足够，无须为满足组合形式添加第二个无关组件。

### 如果继续，先做什么实验

实验尚未执行。先以固定 PhotoCraft 版本与桥接提交，在不运行生成模型的情况下做身份往返，隔离模型改变图像造成的混淆：

1. 用已知 uint16 渐变和不与 8/16 对齐的选区输入，记录数值、颜色空间与坐标；保留透明度测试。
2. 分别走“文件打开为新文档”“回传现有 16-bit 文档的新层”“回传现有 8-bit 文档的新层”和桥接路径。
3. 对比像素值/唯一值、尺寸、选区原点与未编辑区域；同时检查 depth 标识和 TIFF 元数据。仅元数据保留 16 位不算数值精度通过。
4. 只有复现限制并定位转换层，才考虑适配方案。若改一个桥接的文件编解码即可满足任务，优先记录为局部修复；若仍依赖尚未实现的上游协议，记录该前置条件，不能声称组件已兼容。

这能检验技术边界，不能检验付费意愿。用户愿在公开评论中协助测试，也不等于我们已经联系或获得试用反馈。

## 交付与验证

- 讨论核查经 iii `collect-evidence`、GitHub API、W2A 与 SQLite 保存。schema 9，项目快照与信号同事务；原 Issue 样本、扫描历史、观察时间不被刷新覆盖。
- 提示版本 `deepseek-opportunities-v4.3`。评论引用必须给出准确 commentId 并逐字匹配；失败旧评论与过时快照排除。单纯核查时间不改变分析 hash，状态、内容和完整性变化会改变。**本轮未对真实 DeepSeek 执行 v4.3 分析**，最新真实付费分析仍为 `66103e32-7f36-4b25-b012-706dc8c878f2`。
- 132 项测试通过，包与 Server 编译、Web 类型检查及生产构建通过。真实 iii + 临时 HTTP/SQLite + Edge 覆盖成功、评论失败保留、精确链接、Bot、过时提示、移动视口和零模型调用；旧 pipeline 覆盖模型替身、引用/起点、缓存、checkpoint、导出及隔离浏览器。替身测试不证明真实模型质量。
- 实际工作台通过两次讨论核查、组件搜索与收录、原问题保留、材料、发现页、导航和下载；没有页面错误或移动端溢出。旧材料回归脚本的 pre 选择器因新增讨论正文发生歧义，收紧到原文直接子节点后通过。
- 最终 58 个项目、85 条原始 Issue 样本、96 条观察、2 个讨论快照信号；未新增扫描或机会。Token 以 `/user` 实际认证返回 200，未输出凭证或账号信息。迁移后完整性 `ok`，既有项目与分析编号保留。
- 部署前备份：`.data/backups/opportunity-radar-2026-10-20T13-28-10-425Z.sqlite`（schema 8）。补证后备份：`.data/backups/opportunity-radar-2026-10-20T13-35-04-985Z.sqlite`（schema 9）。均 integrity `ok`。

本地原始记录位于 `.data/research/discussion-observations-2026-10-20.json`、`linked-discussion-checks-2026-10-20.json`、`photocraft-bridge-search-2026-10-20.json` 和 `photocraft-existing-bridge-2026-10-20.json`。这些是本工作区文件，未随源码发布；数据库也保留产品实际采集的讨论与桥接档案。仓库和评论 URL 可变，判断以所述核查时间和本地摘录为界。
