# 运行与凭证配置

## 1. iii Engine

本项目锁定 Engine 和 SDK 为 `0.24.5`。Windows x64 安装：

```powershell
cd D:\personal\github-opportunity-radar
corepack pnpm install
corepack pnpm engine:install
```

安装脚本从 iii 官方 GitHub Release 下载并核对固定 SHA-256；二进制只留在被 Git 忽略的 `.tools`，不随源码分发。其他系统可以自行安装同版 iii 并加入 PATH，或通过 `III_BIN` 指定路径。

如果还没有 `.env`，复制 `.env.example`；已有文件直接编辑，保留原有值：

```dotenv
III_URL=ws://127.0.0.1:49134
ANALYSIS_PROVIDER=local
OPENCODE_BIN=
OPENCODE_MODEL=opencode/glm-5.3-flash-free
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=
GITHUB_TOKEN=
```

```powershell
corepack pnpm build
corepack pnpm start
```

`start` 在本机默认端口未运行 Engine 时启动它，然后启动生产服务。打开 <http://127.0.0.1:4317/settings>。Engine 和 API 都绑定 `127.0.0.1`。开发模式需另开终端运行 `corepack pnpm engine:start`，再运行 `corepack pnpm dev`。

设置 `III_URL` 后，断线会明确报错，不会自动转用本地执行。只有主动清空 `III_URL` 才使用进程内执行器。Engine 当前提供函数路由；周期计时器仍在应用进程中，不提供持久化队列或跨重启任务恢复。

运行 `corepack pnpm test:engine` 可验证真实 Engine 的连接、函数注册和嵌套调用；应用须有可用的 Engine。此检查使用单独 namespace，不运行 GitHub 或付费模型请求。

## 2. 获取 GitHub Token

1. 登录 GitHub，打开 [新建 Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new)。完整路径为头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. Token name 填 `opportunity-radar`，设置有效期，例如 90 天；Resource owner 选自己的账号。
3. Repository access 选 **Public repositories**。当前应用只读取公开仓库的 Search、README、Release、Issue 和用户主动指定的同仓库技术文档，不需要仓库写权限，也不需要私有仓库权限；保留默认只读公开访问，不添加额外写权限。
4. 点击 Generate token，复制到本地 `.env` 的 `GITHUB_TOKEN=` 后面。不要把 Token 发到聊天、放入前端代码或提交 Git。
5. 重启服务，在设置页确认“Token 已配置”，执行一次扫描来验证实际访问。这个配置提示只表示存在凭证，不保证它未过期或配额仍有余额。

GitHub REST API 常规 core 配额通常从匿名的每 IP 每小时 60 次提升到认证用户每小时 5,000 次；Search 还有独立限额和二级限流，Token 不能保证所有请求都不限流。具体以 GitHub 响应头为准。

官方说明：[管理 Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[REST API 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。

### GitHub HTTPS 证书校验失败

出现 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`SEC_E_UNTRUSTED_ROOT` 或证书链错误时，先检查系统时间及当前网络的证书配置。可在保持校验的前提下运行 `curl.exe -I --max-time 20 https://api.github.com/rate_limit`；即使返回认证或限流响应，也应先确认 TLS 连接已成功。Windows HTTP 与 Node 都失败时，不能只把原因归为 Node 缺少系统 CA。企业网络请按管理员核实的可信 CA 配置处理，不导入来源未确认的证书，不关闭 TLS 校验。

2026-10-24 的隔离验收中，Node 系统 CA 模式和 Windows HTTP 均失败，严格诊断记录到不完整证书链；尚未修复。连接恢复后再重新研究，旧任务和材料保留；重新研究会重新搜索并调用模型。搜索失败不代表 GitHub 没有相关实现，详见[验收记录](research/2026-10-24-demand-search-failure.md)。

如果企业网络确实使用 HTTPS 检查代理，只有在管理员通过可信渠道确认其 CA 后，才在本地 `.env` 设置 `RADAR_GITHUB_CA_FILE` 为 PEM CA bundle 的绝对路径并重启服务。应用会继续执行主机名、有效期和签名链校验；该文件必须是代理的受信 CA 链，不能是从失败连接中保存的 GitHub 叶证书。未配置时仍使用 Windows 系统信任和 Node 回退。配置后先运行 `node scripts/verify-evidence-fallback-live.mjs`，确认 `/rate_limit` 成功后再重新提交研究。

## 3. 模型分析：OpenCode 免费优先

默认 `ANALYSIS_PROVIDER=local` 先通过本机 OpenCode CLI 2.x 调用联网模型，首选 `opencode/glm-5.3-flash-free`，其次 MiniMax，再尝试 Nemotron Lightning、LongCat、Nemotron Super 与其他免费候选。程序从 CLI 的 `/api/model` 目录核对 `opencode` 来源、启用状态、输入/输出及缓存价格，只有全部零价格模型可被选择，模型名称不足以证明免费。403/404/429/502/503 和单模型超时触发切换，每阶段最多六个。明确服务不可用冷却 30 秒；超时不跨阶段冷却，下次仍可尝试 MiniMax。每个阶段的目录、建会、推理和回执共用 90 秒核心预算，单模型最多 75 秒，给后续候选合计预留至多 20 秒；预留不足时给下个候选至多 5 秒，仍受实际剩余时间约束。清理也消耗剩余时间，不保证六个候选均完成。失败会话的 interrupt 和 delete 分别最多 5 秒；目录声明 low 变体时使用低推理档。免费候选不可用时才使用本机 Codex，单阶段额外最多 90 秒。iii 分析调度包络为 720 秒，完整扫描为 900 秒，操作系统进程退出和文件清理无独立硬限，不作为端到端最坏耗时承诺。401、权限、JSON、回执和证据错误不触发换服务。

Windows 自动查找 OpenCode 桌面版 CLI；也可在本地 `.env` 指定：

```dotenv
ANALYSIS_PROVIDER=local
OPENCODE_BIN="C:\Users\1003584\AppData\Roaming\ai.opencode.desktop\cli\2.1.1-x64\opencode-cli.exe"
OPENCODE_MODEL=opencode/glm-5.3-flash-free
CODEX_BIN=
CODEX_MODEL=
```

每次在临时目录创建独立会话，默认禁止全部工具，仅允许读取本轮临时输入文件，仅附加本轮有界公开证据与 JSON 契约；不继承项目的 GitHub/DeepSeek 凭证，不执行仓库代码。失败时中断背景会话，结束后删除本次会话和临时文件。CLI 仍通过网络访问供应商；免费目录不保证额度和访问权限。本项目不绕过供应商访问限制，不自动调用付费 DeepSeek API。设置页和报告区分首选模型与成功返回的实际模型；失败信息保留已尝试的模型和状态，不存储供应商原始错误体。测试替身不能证明真实推理可用。

`corepack pnpm test:opencode` 可执行一次轻量真实免费模型探针，结果保存在 `.data/opencode-integration/real-probe.json`，不写入项目或机会。CLI 2.x 没有 `step_finish` 时，程序会读取本次 assistant 消息核验模型、完成状态和完整文本，不能仅凭 CLI 退出码判定成功。2026-10-21 实测 GLM 返回 429 后切换 `opencode/minimax-m3.1-flash-free` 成功；免费额度及可用性会变化。

Codex 默认自动发现桌面版 CLI，并从用户 `~/.codex/config.toml` 顶层读取模型名；也可设置 `CODEX_BIN` 与 `CODEX_MODEL`。CLI 复用自己的认证及服务配置，程序不复制密钥、不修改全局配置。费用和额度由该服务决定，界面不称其免费。`ANALYSIS_PROVIDER=opencode` 只使用免费候选；`codex` 直接使用本机 Codex。`corepack pnpm test:codex` 运行轻量真实探针，结果保存在 `.data/codex-integration/real-probe.json`。

Codex 每次创建临时目录，用 `-a never exec --ephemeral --sandbox read-only --json` 和明确 `-m` 选择模型，通过 stdin 传入材料与输出 schema，避免长命令限制；禁用 shell、插件、hooks、多代理、web search 和本机已配置 MCP。拒绝工具事件、失败/混合/未结束会话及最后消息不一致。当前本机网关带 `--output-schema` 曾返回上游错误，因此使用普通 JSON 输出并在本地执行相同 Zod、引用和反方核验，不能因语法不合格自动换服务。模型标为 `codex/<配置模型>`，表示明确提交给 CLI 的模型名；网关底层路由不可由普通 JSONL 独立证明。临时本地输出会清理，`--ephemeral` 不表示云端服务不留存。

如需主动使用付费 DeepSeek，显式改为 `ANALYSIS_PROVIDER=deepseek`，填写下列配置并重启；保留 Key 本身不会启用该服务：

### 可选：DeepSeek API Key

登录 [DeepSeek 开放平台 API Keys](https://platform.deepseek.com/api_keys)，创建 API Key，并确保账号具备 API 余额。网页聊天账号的使用额度不等于 API 余额。把 Key 填入 `.env` 的 `DEEPSEEK_API_KEY`，设置 `ANALYSIS_PROVIDER=deepseek` 并重启服务，再在设置页点击“分析已有项目”，无需重复采集 GitHub。

默认模型 `deepseek-v4-flash` 来自接入时查询到的官方模型文档；可以通过 `DEEPSEEK_MODEL` 改为账号当前可调用的模型。模型列表及计费会变化，以[官方 API 文档](https://api-docs.deepseek.com/)为准。

每轮先浏览最多 200 个已有项目的能力目录。超过 12 个项目时先选择 0～4 组、每组 2～3 个互补组件，再深读最多 12 个唯一项目；12 个及以下直接深读。目录选择和排除理由属于模型推断，运行轨迹与简报可以查看。深读发送公开描述、优先保留接口/用法/限制章节的 README 原文片段（最多 8,500 字符）和每仓库最多 5 条 Issue（未核查时正文前 1,200 字符；有效讨论快照为前 8,000 字符及最多 10 条有界评论，长讨论为最早 5 + 最新 5 条，中间可能遗漏），先提出最多五个组合，再反方审查。提案与反方分次调用模型，免费回退可能更换模型；角色分离和换模型都不代表独立验证，通过只表示本轮未被否决。模型可以返回零个机会。系统不发送 GitHub Token、私有源码，也不执行仓库代码。

候选逐项校验；每个组件都必须有角色、输入输出和不少于 16 字符的连续原文引用。引用必须在模型实际收到的字段内；Issue 引用还绑定真实 issue number、URL 和采集时间，引用评论必须用同一 Issue 中的 commentId。反方检查互补分工、能力证据、集成假设、具体问题、假设措辞与 Issue 关联性，任一失败即淘汰，即使模型 verdict 写 keep 也不能绕过。顶层结构错误或审查不完整使本轮失败。当前提示词版本为 `deepseek-opportunities-v4.4`；此次提示与 schema 改变不自动重跑历史分析。

运行轨迹中的“候选与审查快照”可展开完整提案和六项检查，包括最终被拒候选。提案在发起反方请求前保存；反方失败或服务中断仍保留已取得提案，缺审查时不推断通过。旧记录或旧缓存未留存快照会明确提示，不会为补历史自动重新付费。快照是模型输出，仍需人工复核，未保存所有历史输入，不保证完整重放。

如果已有具体线索，可在机会页“研究一个具体组合”选择 2～3 个不同项目，并填写 12～1200 字符的研究问题。也可从项目详情进入并预选该项目。定向研究跳过目录选择，只深读选定组件，要求每个候选包含全部选定组件；研究问题只限定范围，不能被引用为能力或需求证据。仍允许零结果与否定结论，不保证提案被保留。没有相关 Issue 时保持问题假设，不能宣称存在客户需求。

项目详情的“补充技术文档”可单独采集接口证据，不调用付费模型。路径留空时从 README 中寻找最多两个同仓库文档链接；也可每行填写一个文件路径，例如 `packages/cli/README.md`。版本可填 `v1.1.0` 等 tag、分支或 commit：程序先解析为固定提交，再读取相应 README/文件，保存版本与提交链接。版本留空时读取默认分支，链接指向可变 HEAD。指定版本解析失败时明确报错，不回退 HEAD；单个路径读取失败保留旧文件及原版本，标为失效并排除分析。支持 `.md/.mdx/.rst/.txt`，每次最多两个、每份不超过 512 KB。每项目最多六份留存，同路径仅当前一版；模型接收最新排列的两份有效文档。文档自述不证明版本已发行或接口已运行。完成补证后，再由用户按需触发重新分析。

同一输入、研究范围/问题、模型和提示词版本复用已成功分析，避免重复付费；组件选择顺序不改变研究范围。缓存复用产生独立运行记录，标注来源运行编号、本次未调用模型，用量为 null 而非再次累计旧回执。失败不自动重试，原始项目数据和既有机会保留，失败记录也保留研究问题。一次成功研究只替换相同范围的未收藏候选；定向零结果不会隐藏其他问题或自由发现的结果。设置页显示实际调用结果、被拒数量和 token 用量；配置了 API Key 但没调用过，会显示“尚待实际调用验证”。

`ANALYSIS_PROVIDER=rules` 可以显式切回规则模式；任一模型缺配置或失败时不会静默生成规则卡片冒充模型分析。两种模型服务共用下述证据与反方门槛。

## 4. 诊断

- `/api/v1/health/ready`：数据库和运行时是否就绪，Engine 断开返回 HTTP 503。
- `/api/v1/integrations`：执行器、连接状态、凭证是否存在及最近分析结果；不会返回密钥。
- `/api/v1/analysis/runs`：模型分析运行记录；`POST /api/v1/analysis` 对已有项目重新分析。
- `POST /api/v1/analysis` 可传 `{"focus":{"projectIds":["1318187016","1423935509"],"question":"待验证：地区 CSV 生成地图并放入 PPTX，能否减少每周整理时间？"}}`；ID 必须已经采集，重复 ID、未知项目或问题长度不符返回 400。空对象仍执行自由发现。
- `/api/v1/scans`：采集结果和 warning；采集成功而模型缺少 Key 或失败时记录为 `partial`。
- `/api/v1/discovery/plan`：设置对应的有限查询与预算；每轮查询结果保存在扫描记录。
- `POST /api/v1/components/search`：`{"query":"\"mail merge\" docx"}`，从 GitHub 预览六个相关项目，不加新建时间窗口、不写项目或调用模型。
- `POST /api/v1/components/import`：`{"repository":"owner/repository"}` 或 GitHub 仓库首页地址，经 iii 采集单项目 README/Release/有限 Issue，保存 W2A 与档案并返回部分失败 warning。与扫描、文档补证和分析互斥；不自动研究或改变扫描周期。GitHub 限流返回 429、错误查询 422、资源不可见 404。
- `POST /api/v1/projects/:id/documentation`：补充技术文档；可传 `{"paths":["docs/api.md"],"ref":"v1.1.0"}`，省略 paths 时从相应 README 自动发现，省略 ref 读取默认分支。报告与各份文件分别携带可选 ref/commitSha，保留旧文件时应以文件自己的版本为准。响应包含成功文档、尝试路径和警告；与扫描、分析互斥。
- `POST /api/v1/projects/:id/issues/:number/context`：传 `{}`，只核查该项目当前有效已采集材料中的 Issue，包括自动样本和有效的按需补充讨论；其他编号使用下述收录入口。经 iii 保存当前状态、正文前 8,000 字符及最多 10 条评论；长讨论取最早 5 + 最新 5 条、中间可能遗漏（每条前 2,000 字符），返回采集时间、截断、完整性与评论错误。主请求失败保留旧快照；评论失败时保留旧评论供查看并排除其进入模型，不等同没有回复。评论最多读取三页；随后核查已读样本中最多三个同仓库提及的 PR，返回草稿、开放未合并、关闭未合并、已合并或读取错误。只请求本仓库规范 API 路径，不跟跨仓库或任意外链，不调用模型。已合并不证明发行或运行有效。评论失败保留旧采样方式；旧快照不追认为新采样。
- `POST /api/v1/projects/:id/issues/import`：传 `{"issue":4616}` 或 `{"issue":"https://github.com/actualbudget/actual/issues/4616"}`（需先收录对应项目），按需选择初始样本之外的公开讨论，开放/关闭均支持；仅接收本仓库编号/地址，拒绝跨仓库和 PR。自动样本不改写；有效选择并入档案和研究起点，刷新保留选择。仍只保留最近十份核查；过时材料退出、已保存判断快照保留，不创建监控或付费任务。
- `/api/v1/projects/:id/observations`：命中采集时的 star/fork/Issue 计数及 Release 观察历史。
- `/api/v1/reports/latest.md`：最近一次分析的 Markdown 研究简报，包含原文链接、反证、实验与淘汰记录。
- `/api/v1/analysis/runs/:id/report.md`：指定历史运行的研究结论、范围、用量与问题，未知 ID 返回 404。扫描信息与工作区累计数是导出时上下文，不是该历史运行的完整输入快照。
- `/api/v1/opportunities/:id/report.md`：单个方向的验证方案。
- `GET /api/v1/research-notes`：最近最多 100 条研究判断，含修订关系、原文快照和 same/changed/unavailable 的本地资料比较；`GET /api/v1/research-notes/:id` 查看固定记录，`/:id/report.md` 独立导出。
- `POST /api/v1/research-notes`：保存判断或修订。前端生成 requestId，填写 1～3 个项目、可选 originIssue、author（user/assistant）、title、question、decision（continue/watch/stop）、conclusion、nextAction，以及 1～6 个 evidence（结构化 ref + 16～2,000 字符 quote）；更新时加 supersedesId，旧记录保留。重复请求幂等、冲突 409、引用不在有效来源中 422。可在研究表单操作，无需手写请求，不调用 iii 或模型。

`needs_cli` 表示当前模式没有可用的 CLI/模型配置；`needs_api_key` 表示显式 DeepSeek 模式缺少 Key；`configured` 仅表示具备调用配置。真实模型成功以当前模型配置对应的分析记录 `succeeded` 为准；缓存复用不代表本次发起调用。测试中的 CLI/HTTP 替身与临时数据库不进入实际工作区，不能作为真实供应商推理质量的证明。

检查命令：`corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`、`corepack pnpm test:engine` 和 `corepack pnpm test:pipeline`。最后两个需要运行中的 Engine，均使用单独 namespace。

`corepack pnpm test:browser` 需要本机 Edge 和运行中的生产页面，执行只读导航、项目过滤、Issue 展开、报告下载和移动视口检查，结果进入 `.data/browser`。临时数据库中的收藏/验证交互由集成检查另行验证，不向真实库写测试结论。

`node scripts/verify-components.mjs` 使用真实 iii 与临时 GitHub HTTP/SQLite 验证组件搜索、W2A 保存和无模型调用；设置 `RADAR_TEST_BROWSER=1` 后，通过浏览器拦截将所有收录写请求转到临时服务，不写真实库。`scripts/research-mailmerge-components.mjs` 则是已执行的真实研究操作，会收录/刷新 Gradio，不作为只读回归命令。所有实例必须使用独立 `III_NAMESPACE`，适配器同时设置 SDK namespace 与函数前缀。

`node scripts/verify-issue-context.mjs` 使用真实 iii、临时 GitHub HTTP/SQLite 验证讨论刷新和失败保留。设置 `RADAR_TEST_BROWSER=1` 时，Edge 只访问临时服务及其构建后的前端，检查准确评论/PR链接、三种PR状态、失败提示、新样本过时提示和移动视口；不需要生产页面，不写真实库、不调用付费模型。运行前完成包、Server 和 Web 构建。讨论快照在 schema 9 引入；模型 prompt `deepseek-opportunities-v4.4` 的 hash 排除单纯核查时间，但包含讨论内容、状态与完整性变化。

当前数据库为 schema 12，保留 schema 10 的研究判断与 schema 11 的持续关注表，并支持有界讨论跟进；模型 prompt 为 v4.4。`node scripts/verify-research-notes.mjs` 使用临时 SQLite/HTTP 与本机 Edge 验证原文核验、资料变化、修订、作者区分、重复提交和导出；只访问临时服务，不访问真实工作区或付费模型。需要先构建包、Server、Web，可通过 `RADAR_TEST_WEB_DIR` 指定独立构建目录。判断里的 watch 不会创建后台监控任务，持续关注须在项目档案另行开启。

`node scripts/verify-monitoring.mjs` 使用真实 iii、临时 GitHub HTTP/SQLite 和 Edge 验证手动刷新、首次关注自动调度、取消、失败保留、重开持久化和移动界面；零生产写入、零外部 GitHub 请求、零模型调用。默认读取 `.data/monitoring-preview`，先在 `apps/web` 执行 `corepack pnpm exec vite build --outDir ../../.data/monitoring-preview`，或设置 `RADAR_TEST_WEB_DIR` 指向构建目录。隔离实例使用独立 namespace，不占用生产函数名。

## 5. 采集、调度与备份

默认广度模式把 32 个仓库预算分配到五个官方查询；可调整到 1～60 或切成单查询。重复仓库合并渠道。每个仓库最多保留 20,000 字符 README 原文片段与 5 个开放 Issue；长 README 优先保留 CLI/API/MCP、用法、部署、限制和许可证章节，省略处有标记。Issue API 取最近更新的 15 项后过滤 PR，可能只得到少量或零条，不能视为全部问题。瞬时网络失败和 5xx 最多尝试三次，重试等待 350、700 毫秒且受总预算约束；每批两个仓库补充资料，总采集预算 180 秒。失败字段保留既有资料并在运行轨迹中显示来源警告。

周期计时器只在应用运行期间有效；重启后按最近持久化扫描开始时间计算下一次到期，已过期时补一次，Engine 不通时延后重查。它不恢复中断任务，也不会在关机时执行。

在项目档案开启“持续关注此项目”可独立于 Search 刷新该仓库，最多 20 个，每分钟检查到期项、单批两个；成功间隔沿用设置，失败约一小时重试。首页可看最近结果和下次到期。GitHub 限流会暂停关注队列；取消后重新关注不能绕过等待。刷新不自动分析，指定 Issue 评论和补充技术文档仍需分别核查。“刷新仓库资料”只执行一次，不自动关注。升级前请先备份，启动时自动迁移到 schema 11，已有项目不默认订阅。

备份运行：

```powershell
corepack pnpm backup
```

使用 SQLite `VACUUM INTO` 生成 `.data/backups` 中的一致性副本并校验完整性，可在服务运行时执行。恢复须先停止本项目服务，保留当前库及其 WAL/SHM 文件，再以备份替换数据库；不要运行中只复制主文件。备份含公开研究数据和本地验证笔记，按本地文件管理。

搜索轮换进度一并存于 SQLite。设置页“下次扫描范围”显示已保存配置的实际查询与页码，首页和后续页交替；旧库首次升级从第一页开始。改变相关查询/窗口/模式/每页数量会重置相应渠道，仅改变扫描间隔不重置。失败或资料未完整取得会重试本页，搜索排名变化仍可能重复/遗漏，不代表全站覆盖。`node scripts/verify-discovery-rotation.mjs` 用真实 iii 和隔离 HTTP/SQLite 验证轮换、重启、失败位置与 W2A 保存，不调用模型。
