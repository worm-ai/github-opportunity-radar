# 研究判断

## 图表打印导出：先核对固定版本与已有绕过方案

- 阶段判断：等待变化
- 记录者：代理研究，待人工复核
- 保存时间：2026-10-21T04:04:39.990Z
- 项目：TanStack/charts
- 编号：776710ee-0758-46a3-a721-3674381dcfda

这是研究记录，不是模型机会、技术实测或市场验证。

### 研究问题

TanStack Charts 与浏览器 PDF 导出能否形成有增量价值的报告工具，还是仅需修复已有图表打印流程？

### 当前结论

暂不开发通用图表转报告产品。v1.1.0 标签内的渲染文档自述已有 SVG 路径，单纯包装导出不能证明增量价值；同标签比较文档仍明确测量的是未发布 workspace df25302，不能把比较表当作已发行包的实测。Issue \#228 描述 Chromium/Playwright 打印时尺寸重绘未发生，当前开放、无评论，并附 print media \+ 固定 width \+ flushSync 绕过方法。这里只确认一位公开作者的陈述；未安装运行图表包，未核实客户身份、重复需求或付费意愿。

### 下一步与重新审视条件

先按 Issue 的版本和复现比较现成绕过方法能否解决问题，并检查后续修复；仅当真实报告工作流仍有重复手工处理且已有方案不能覆盖时，再研究与导出组件的组合。若原生修复即可覆盖，停止通用包装方向。

### 保存时的原文

- 问题起点：项目 1314386748 #228

#### TanStack/charts · docs/comparison.md

    The latest published TanStack Charts release is `1.1.0`, while this page
    measures unreleased workspace source against pinned competitor packages.

- 来源：[原始来源](https://github.com/TanStack/charts/blob/57774e14a1a86081eddb3a23523724a40da05640/docs/comparison.md)
- 采集时间：2026-10-21T04:02:50.093Z
- 边界：文档摘录；版本 v1.1.0；固定提交 57774e14a1a86081eddb3a23523724a40da05640；Blob 518952ed1dfac756900a5a507bcb8331b2869bf3；未验证安装运行、发行状态或接口兼容性。
- 与当前已采集资料比较：内容一致，未核对远端最新状态

#### TanStack/charts · docs/reference/rendering-and-export.md

    TanStack Charts compiles a renderer-neutral scene. The default renderer turns
    that scene into accessible SVG markup; an optional Canvas renderer paints the
    same scene through Canvas 2D.

- 来源：[原始来源](https://github.com/TanStack/charts/blob/57774e14a1a86081eddb3a23523724a40da05640/docs/reference/rendering-and-export.md)
- 采集时间：2026-10-21T04:02:51.961Z
- 边界：文档摘录；版本 v1.1.0；固定提交 57774e14a1a86081eddb3a23523724a40da05640；Blob 810b560b9a3146a7adc4cd71141919c09a057693；未验证安装运行、发行状态或接口兼容性。
- 与当前已采集资料比较：内容一致，未核对远端最新状态

#### TanStack/charts \#228 · 问题原文

    Version: `@tanstack/charts` 1.1.0, Chromium. Also seen with Playwright `page.pdf()`.

- 来源：[原始来源](https://github.com/TanStack/charts/issues/228)
- 采集时间：2026-10-21T04:03:46.348Z
- 边界：讨论核查时open；作者 piecyk / NONE；评论条数与分页核对完整；单页评论读取；正文未截断。
- 与当前已采集资料比较：内容一致，未核对远端最新状态

#### TanStack/charts \#228 · 问题原文

    On the `print` media change, measure the container and pass it as a fixed `width` inside `flushSync`, then remove `width` when print ends. It works, but every app that prints has to know about it.

- 来源：[原始来源](https://github.com/TanStack/charts/issues/228)
- 采集时间：2026-10-21T04:03:46.348Z
- 边界：讨论核查时open；作者 piecyk / NONE；评论条数与分页核对完整；单页评论读取；正文未截断。
- 与当前已采集资料比较：内容一致，未核对远端最新状态
