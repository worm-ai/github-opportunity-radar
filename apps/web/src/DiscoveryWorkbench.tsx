import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, LoaderCircle, Search, X } from "lucide-react";
import { api, type DiscoveryItem } from "./api";

const day = (value: string | null) => value ? new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" }) : "未记录";
const time = (value: string) => new Date(value).toLocaleString("zh-CN");
const signed = (value: number) => value > 0 ? `+${value}` : String(value);

export function DiscoveryWorkbench() {
  const brief = useQuery({ queryKey: ["discovery-brief"], queryFn: api.discoveryBrief, refetchInterval: 30_000 });
  const [view, setView] = useState("diverse");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(6);
  const [selected, setSelected] = useState<string[]>([]);
  if (brief.isPending) return <section id="discovery" aria-label="发现工作台"><div className="loading-row"><LoaderCircle size={16} className="spin" /> 正在整理发现线索</div></section>;
  if (brief.isError) return <section id="discovery" aria-label="发现工作台"><p className="form-error">发现视图读取失败：{brief.error.message}<button className="button-secondary" onClick={() => void brief.refetch()}>重试</button></p></section>;
  const data = brief.data;
  const filtered = data.items.filter((item) => {
    const text = `${item.fullName} ${item.description ?? ""} ${item.clues.map((clue) => `${clue.label} ${clue.quote}`).join(" ")}`.toLowerCase();
    if (!text.includes(search.trim().toLowerCase())) return false;
    if (category !== "all" && !item.clues.some((clue) => clue.id === category)) return false;
    if (view === "resources") return item.kind === "resource_hint";
    if (view === "unclassified") return item.kind === "unclassified";
    if (view === "recent") return item.firstSeenInScan;
    if (view === "changes") return Boolean(item.observation.releaseChange);
    if (view === "issues") return item.issueCount > 0;
    return item.kind === "capability_hint";
  });
  const categories = new Set<string>();
  const first: DiscoveryItem[] = [], rest: DiscoveryItem[] = [];
  for (const item of filtered) {
    const key = item.clues[0]?.id ?? item.kind;
    if (!categories.has(key)) { first.push(item); categories.add(key); }
    else rest.push(item);
  }
  const visible = (view === "diverse" && category === "all" ? [...first, ...rest] : filtered).slice(0, limit);
  const chosen = selected.flatMap((id) => data.items.find((item) => item.id === id) ?? []);
  const choose = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : previous.length < 3 ? [...previous, id] : previous);
  const tabs = [
    { id: "diverse", label: "跨领域浏览", count: data.summary.withClues },
    { id: "recent", label: "本轮首次收录", count: data.summary.firstSeenInScan },
    { id: "changes", label: "版本标签变化", count: data.summary.releaseChanges },
    { id: "issues", label: "有问题样本", count: data.items.filter((item) => item.issueCount > 0).length },
    { id: "resources", label: "资料线索", count: data.summary.resources },
    { id: "unclassified", label: "待识别", count: data.summary.unclassified },
  ];
  return <section id="discovery" className="discovery-workbench" aria-label="发现工作台">
    <div className="section-head"><div><h2>先看有什么能力，再决定研究什么</h2><span>{data.summary.total} 个已收录项目 · 原文线索、观察对比与下一步检查</span></div><Link className="text-link" to="/projects">全部档案 <ArrowUpRight size={14} /></Link></div>
    <div className="discovery-tabs" role="group" aria-label="发现视图">{tabs.map((tab) => <button key={tab.id} aria-pressed={view === tab.id} onClick={() => { setView(tab.id); setCategory("all"); setLimit(6); }}>{tab.label}<b>{tab.count}</b></button>)}</div>
    <div className="discovery-controls"><label>能力方向 <select aria-label="能力方向" value={category} onChange={(event) => { setCategory(event.target.value); setLimit(6); }}><option value="all">全部方向</option>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.count}</option>)}</select></label><label className="inline-search"><Search size={15} /><input aria-label="搜索发现线索" placeholder="搜索项目、能力或原文" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(6); }} /></label></div>
    <p className="discovery-context">{view === "diverse" ? "先展示不同能力方向，再补同类项目；各类内按首次收录时间排列。标签来自项目描述的关键词线索，可展开原文核对。" : view === "changes" ? "仅比较最近两次均已知的版本标签。标签不同仍需阅读发布说明；首次读到标签不算新版本。" : view === "recent" ? `对照最近一次有结果的扫描（${data.scan ? time(data.scan.startedAt) : "尚无记录"}）。首次收录是本工作区第一次看到，不代表项目刚创建。` : view === "resources" ? "描述中有课程、教程或资料迹象，保留来源供阅读，复用前先核对是否提供独立软件组件。" : view === "unclassified" ? "描述不足或只有 README 关键词提及。先排除赞助内容、依赖与贡献者工具，再确认项目本身提供什么能力。" : "按首次收录时间排列；问题样本和技术描述用于研究，下一步需核查具体接口与工作场景。"}</p>
    {chosen.length > 0 && <div className="discovery-selection" aria-label="研究选择"><div><b>准备比较 {chosen.length} / 3 个组件</b><p>先明确各自分工和关键未知点，再填写研究问题。</p><div className="chosen-projects">{chosen.map((item) => <button key={item.id} onClick={() => choose(item.id)} aria-label={`移除 ${item.fullName}`}>{item.fullName}<X size={12} /></button>)}</div></div>{chosen.length >= 2 ? <Link className="button-primary" to={`/opportunities?${new URLSearchParams(chosen.map((item) => ["project", item.id])).toString()}`}>填写组合研究问题 <ArrowUpRight size={14} /></Link> : <small>再选一个有互补分工的组件</small>}</div>}
    <div className="discovery-grid">{visible.map((item) => <DiscoveryCard key={item.id} item={item} selected={selected.includes(item.id)} disabled={selected.length >= 3 && !selected.includes(item.id)} onChoose={() => choose(item.id)} />)}</div>
    {!visible.length && <div className="discovery-empty"><h3>{view === "changes" && !search && category === "all" ? "最近两次观察未确认版本标签变化" : "当前条件下没有线索"}</h3><p>{view === "changes" ? "已有标签、刚读到标签或仅 Star 变化均不计为新版本。可在项目档案查看现有发布。" : "调整能力方向或搜索词，也可切换到资料线索与待识别项目。"}</p></div>}
    <div className="discovery-footer"><span>展示 {visible.length} / {filtered.length} 个匹配项目</span>{visible.length < filtered.length && <button className="button-secondary" onClick={() => setLimit((previous) => previous + 6)}>再看 6 个</button>}</div>
  </section>;
}

function DiscoveryCard({ item, selected, disabled, onChoose }: { item: DiscoveryItem; selected: boolean; disabled: boolean; onChoose: () => void }) {
  const clue = item.clues[0];
  const comparison = item.observation.comparison;
  const release = item.observation.releaseChange;
  return <article className={`discovery-card${selected ? " selected" : ""}`} data-project-id={item.id}>
    <div className="discovery-card-top"><span>{item.kind === "resource_hint" ? "资料线索" : item.kind === "unclassified" ? "能力待识别" : clue?.label}</span><label><input type="checkbox" checked={selected} disabled={disabled} onChange={onChoose} aria-label={`选择 ${item.fullName} 研究`} />选作组件</label></div>
    <Link className="repo-name" to={`/projects/${item.id}`}><b>{item.fullName}</b></Link>
    <p className="discovery-description">{item.description ?? "项目未提供描述，可进入档案阅读已采集的 README。"}</p>
    <div className="discovery-tags">{item.clues.slice(1, 4).map((value) => <span key={value.id}>{value.label}</span>)}{item.firstSeenInScan && <span>本轮首次收录</span>}</div>
    <div className="discovery-dates">创建 {day(item.createdAt)}<br />首次收录 {day(item.firstSeenAt)} · {item.license ? `许可证标识 ${item.license}` : "许可证未知"}<br />已读版本 {item.releaseTag ?? "未知"}{item.releaseUrl && <> · <a href={item.releaseUrl} target="_blank" rel="noreferrer">发布说明 ↗</a></>}</div>
    <div className="discovery-observation">{release ? <p>版本标签 {release.from} → {release.to}<br /><small>观察区间 {time(release.fromObservedAt)} ～ {time(release.toObservedAt)}；具体能力变化待读发布说明。</small></p> : comparison ? <p>最近两次观察：Star {signed(comparison.stars)} · Fork {signed(comparison.forks)}<br /><small>{time(comparison.from)} ～ {time(comparison.to)}；未确认版本标签变化。</small></p> : <p>仅一次观察，尚无变化基线。<br /><small>已读版本 {item.releaseTag ?? "未知"}，不据此推断新发布。</small></p>}</div>
    <p className="discovery-next"><b>下一步检查</b>{item.kind === "resource_hint" ? "先确认这是学习资料还是可独立调用的组件，再决定是否参与组合。" : item.kind === "unclassified" ? "先读 README 的安装和用法，确认关键词属于项目自身能力，再核对输入输出与可调用接口。" : clue?.nextCheck}</p>
    <details className="discovery-evidence"><summary>查看原文依据与资料（{item.clues.length} 条能力线索）</summary>{item.resourceQuote && <blockquote><b>资料迹象 · 项目描述</b><p>{item.resourceQuote}</p></blockquote>}{item.clues.map((value) => <blockquote key={value.id}><b>{value.label} · {value.source === "description" ? "项目描述" : "README 提及，需核对是否项目自身能力"}</b><p>{value.quote}</p><a href={value.url} target="_blank" rel="noreferrer">打开原文 <ArrowUpRight size={12} /></a></blockquote>)}<p className="context-note">档案最近观察 {time(item.observedAt)}；README 获取失败时可能保留先前摘录。{item.issuesFetchedAt ? `${item.issueCount} 条公开 Issue 样本` : "Issue 尚未采集"} · {item.documentationCount} 份可用补充文档。</p></details>
    <Link className="text-link" to={`/projects/${item.id}`}>检查完整档案与问题样本 <ArrowUpRight size={14} /></Link>
  </article>;
}
