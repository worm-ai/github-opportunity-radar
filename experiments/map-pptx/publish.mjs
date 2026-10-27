import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const latest = JSON.parse(readFileSync(resolve(root, ".data/experiments/latest-map-pptx.json"), "utf8"));
const run = resolve(root, latest.directory);
const core = JSON.parse(readFileSync(resolve(run, "result.json"), "utf8"));
const rendering = JSON.parse(readFileSync(resolve(run, "powerpoint-verification.json"), "utf8"));
if (!Object.values(core.checks).every((value) => value === true) || rendering.pixels.repeatedChangedPixels !== 0) throw new Error("Experiment checks have not passed");
const id = "map-pptx-2026-10-20";
const target = resolve(root, process.env.DATA_DIR || ".data", "technical-experiments", id);
mkdirSync(target, { recursive: true });
const files = [
  ["baseline-powerpoint.png", "原始数据：PowerPoint 实际渲染"],
  ["updated-1-powerpoint.png", "模拟更新：加州改为 10%，PowerPoint 实际渲染"],
  ["baseline.pptx", "原始地图 PPTX"], ["updated-1.pptx", "模拟更新 PPTX（非真实人口更新）"],
  ["baseline.csv", "上游人口数据样本 CSV（未独立核对统计源）"],
  ["updated.csv", "模拟更新 CSV（诊断用）"],
  ["result.json", "引擎实测原始结果 JSON"], ["powerpoint-verification.json", "PowerPoint 渲染与像素检查 JSON"],
];
const artifacts = files.map(([name, label]) => {
  const bytes = readFileSync(resolve(run, name));
  copyFileSync(resolve(run, name), resolve(target, name));
  return { name, label, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const record = {
  id, title: "地区 CSV → 地图 → PPTX：真实文件交接与更新实验",
  question: "Map Design 生成的地图能否由 GenOffice 写入并重复更新 PPTX，同时保留正确地区、来源与图片位置？",
  conclusion: "固定版本的地图生成、PNG 嵌入和重复替换已跑通，并由本机 PowerPoint 正常打开与渲染。支持这组组件的文件接口假设；尚未证明能减少用户整理时间或存在付费需求。",
  executedAt: core.executedAt,
  environment: `Windows；Node.js ${core.node}；GenOffice 源码引擎及操作层；Microsoft PowerPoint ${rendering.version}；Edge 图像检查。未安装或测试 GenOffice 打包 CLI。`,
  inputOrigin: "Map Design 固定提交内的美国人口变化示例，原仓库标注 US Census Vintage 2024；没有独立复核统计源。加州 10% 及异常行由本实验人工注入，仅用于诊断。",
  projectIds: ["1423935509", "1318187016"], sources: core.source,
  checks: [
    { label: "地区与数值匹配", observation: "原始 CSV 的 51 个州及特区匹配；California=-0.31%；无未匹配或警告。模拟更新后 California=10.00%。", outcome: "supported" },
    { label: "图片交接与连续更新", observation: "PPTX 当前图片引用的 PNG 字节哈希与地图产物一致。两次替换后均为 1 页、1 张图，位置及尺寸保持。输入哈希写入演示稿备注。", outcome: "supported" },
    { label: "实际 PowerPoint 显示", observation: `本机 PowerPoint ${rendering.version} 成功打开三个 PPTX 并渲染。原始与更新图有 ${rendering.pixels.changedPixels.toLocaleString("en-US")} 个像素变化；两次相同更新在同一渲染器中为 0 像素差异。`, outcome: "supported" },
    { label: "退出成功就代表数据完整", observation: "反例成立：未知 FIPS、重复 California、缺失数值三种输入的 render 命令均退出 0，但报告包含未匹配或警告。重复时保留第一条；缺失值被留空，没有变成零。集成必须读取诊断并要求确认。", outcome: "refuted" },
    { label: "减少人工时间与商业需求", observation: "尚未观察真实用户的汇报任务，也没有与现有 Excel、PowerPoint 或 BI 工作方式做耗时对照。技术实验不能回答这一项。", outcome: "inconclusive" },
  ],
  limitations: ["仅覆盖一个固定版本组合、州级地图及本机 PowerPoint 14.0；未证明其他模板、平台或 Office 版本兼容。", "地图在 PPTX 中是完整栅格图片，区域和文字不是可单独编辑的原生对象；高分辨率仍不能代替矢量编辑。", "重复渲染比较发生在同一个 PowerPoint 版本，不是跨渲染器逐像素一致保证。", "实验由项目开发过程人工执行，独立于模型淘汰记录；不会修改机会评分或标记市场已验证。"],
  nextAction: "用一项真实地区汇报任务对照现有工作方式，记录人工步骤、纠错与总耗时；若现有工具更省事或用户没有重复任务，停止把它包装为产品机会。机会捕手继续研究其他能力，不围绕此案例开发地图产品。",
  artifacts,
};
writeFileSync(resolve(target, "record.json.tmp"), JSON.stringify(record, null, 2));
renameSync(resolve(target, "record.json.tmp"), resolve(target, "record.json"));
console.log(JSON.stringify({ id, artifacts: artifacts.length, directory: target, paidModelCalls: 0 }));
