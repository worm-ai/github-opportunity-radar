# 第二个真实需求：离线研究交接

2026-10-23。PRD v0.33。需求来自助手维护本项目的实际工作，属于助手自用，不是独立使用者验证。此前社会模拟已暴露服务状态一致性问题，本轮回到研究工具本身的交接缺口，没有继续扩建示例游戏。

## 实际研究与工程选择

通过 Edge 在产品输入一次真实需求：从现有 React/TypeScript + Node.js 24 的结构化研究结果导出中文离线 HTML，用浏览器打印 PDF；保留来源、固定提交、失败/未知、判断及实测边界；不能增加服务器、数据库或导出模型调用；先验证静态 HTML 基线，再考虑复用/改造/组合。

保存任务 `792667cf-5d44-4e5a-bb36-dd8b33a5364f`，终态 `succeeded`，结果 `insufficient_evidence`，没有推荐路径。六次 GitHub Repository Search，成功采集六个仓库、12 份来源：MatthewHerbst/react-to-print、Kozea/WeasyPrint、rstudio/pagedown、BartoszJarocki/cv、bndw/wifi-card、OnedocLabs/react-print-pdf。早期摘要只计前三个；最终 API 记录才是本次事实依据。

六次模型调用均成功，回执合计 199,803 输入 / 8,338 输出 token，不能据此推导美元费用或用户收益。历史研究建议先执行零依赖静态 HTML 基线；若通过，不必引入打印库。候选未安装、未运行，未通过复核不表示它们不支持该功能。最终评估中的 react-print-pdf 仅为条件性改造候选。

四个初搜分别为 `html print`、`react print`、`"paged media"`、`json html report`，各返回有限预览。两条补搜分别为 `react-to-print standalone offline HTML export inline styles`、`react-to-print Chinese long URL pre-wrap print overflow regression`，均零结果。GitHub 仓库搜索空格通常为 AND，这两条把实现细节叠得过长，不能据此推断没有实现；问题已记录，下轮需改善补搜，避免重复调用整份研究掩盖检索缺陷。

## 实现及实际可交付物

研究结果前部新增“导出离线交接简报”。纯前端生成 HTML，内嵌样式、系统字体，不包含脚本、远程资源或运行时 API；对用户、模型及仓库文本转义，只保留无凭据 HTTP/HTTPS 链接，完整来源地址可见。保留关联判断及其保存时引文、源码五环节核查、候选覆盖、约束、剩余工程、反证、历史未执行实验、相关实测和本地改造版本/产物哈希。

研究历史、功能声明、判断和归档需成功读取才导出；旧服务未声明判断功能时明确标注未包含，归档缺损提示保留。来源全文和实测文件没有嵌入，需另行交接；本地下载入口需要原工作区，正文离线阅读不依赖它们。静态快照不会自动更新，不改写模型历史或当前判断。

产物位于 `.data/browser/demand-handoff/`：`social-original.html/.pdf`、`social-source.html/.pdf`、`self-use.html/.pdf`。`adversarial.html/.pdf` 仅为内存构造的恶意内容与长行夹具，不进入实际研究库。浏览器 `verification.json`、PDF `pdf-verification.json` 和 `study.json` 保留回执。

## 验证及边界

执行：

```text
corepack pnpm exec vitest run apps/web/src/demand-brief.test.ts apps/web/src/demand-lineage.test.ts apps/web/src/demand-experiments.test.ts
corepack pnpm --filter @radar/web typecheck
corepack pnpm --filter @radar/web exec vite build --outDir ../../.data/browser/demand-handoff/build
corepack pnpm exec tsx scripts/verify-demand-brief.mjs
.data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 scripts/verify-demand-brief-pdf.py
node scripts/verify-demand-lineage.mjs
node scripts/verify-demand-decisions.mjs
node scripts/verify-demand-result-focus.mjs
```

19 项测试通过；真实 Edge 从三份原任务点击下载，断网阅读零 HTTP 请求。1440/390 以及打印宽度无横向溢出。注入文本只以文字显示，恶意链接剔除，长中文、代码及 URL 可换行。历史/判断/实测 503 夹具阻止导出；原任务及判断逐条对比不变，零写请求、零页面错误。

PDF 使用既有 Python/pypdf 环境检查，不增加产品依赖：原研究 21 页/408 段，源码研究 21 页/379 段，本次自用 12 页/215 段，恶意内容夹具 14 页/220 段。合计 1,222 个正文/链接文本段全部可提取，来源链接注释保留，仅标准化空白。首次核查发现地址只有可点击标签，补完整可见地址后重新执行导出及 PDF 验证，没有通过放宽缺失文本检查来过关。

已有导航、选型判断及结果页回归通过；旧导航脚本不再假设历史永远只有两个需求组，保留逐条旧记录不变断言及独立同名需求分组断言。发布前服务空闲，备份 `.data/demand-live-20261023/backups/opportunity-radar-2026-10-23T07-38-14-453Z.sqlite`，schema 15、integrity ok。静态前端保留旧哈希资产、原子切换 HTML，4318/4317 两实例资源可读，未重启服务。

第一性原理结论：这个具体需求的基线已可用，新增服务和组合没有已证实必要性。对抗式结论：完整档案 12～21 页，不能宣称交接足够简短、打印排版跨浏览器通用或无障碍已达标；候选源码没有被采用，当前实现不代表上游能力。还没有独立使用者反馈、搜索对照耗时或收益证据，总目标继续 active。下一步优先收敛补搜质量和研究成本，而非继续增加同类报告。
