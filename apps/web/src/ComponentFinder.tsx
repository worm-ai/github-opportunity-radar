import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Project } from "./api";

export function ComponentFinder({ selectedIds, blocked, onSelect, onBusy }: { selectedIds: string[]; blocked: boolean; onSelect: (id: string) => void; onBusy: (busy: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [repository, setRepository] = useState("");
  const queryClient = useQueryClient();
  const search = useMutation({ mutationFn: api.findComponents });
  const collect = useMutation({ mutationFn: api.importComponent, onSuccess: async (result) => {
    // Load the imported record before selecting it, so the materials and Issue picker use real data.
    const project = await api.project(result.id);
    queryClient.setQueryData<Project[]>(["projects"], (previous) => [project, ...(previous ?? []).filter((item) => item.id !== project.id)]);
    onSelect(result.id);
    void queryClient.invalidateQueries();
  } });
  const pending = search.isPending || collect.isPending;
  useEffect(() => { onBusy(pending); return () => onBusy(false); }, [pending, onBusy]);
  const disabled = blocked || pending;
  const full = selectedIds.length >= 3;
  return <details className="component-finder">
    <summary>缺少组件？搜索 GitHub 或粘贴仓库地址</summary>
    <section aria-label="寻找互补组件">
      <p className="context-note">先写下实际缺失的能力，再搜索相关组件。结果是 GitHub 相关性排序的项目自述，需要核对接口与替代方案；搜索不受新项目时间窗口限制。</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!disabled && query.trim().length >= 2) search.mutate(query.trim()); }}>
        <label>GitHub 搜索条件<input aria-label="GitHub 组件搜索" minLength={2} maxLength={256} required disabled={pending} value={query} onChange={(event) => { setQuery(event.target.value); search.reset(); }} placeholder={'例如："mail merge" docx，或 topic:gui language:Python'} /></label>
        <button className="button-secondary" type="submit" disabled={disabled || query.trim().length < 2}>{search.isPending ? "正在搜索" : "搜索组件"}</button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); if (!disabled && !full && repository.trim()) collect.mutate(repository.trim()); }}>
        <label>已有仓库地址<input aria-label="按地址收录组件" maxLength={240} required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repository 或 https://github.com/owner/repository" /></label>
        <button className="button-secondary" type="submit" disabled={disabled || full || !repository.trim()}>收录并选择</button>
      </form>
      <p className="context-note">搜索只预览最多 6 个结果。收录才读取 README、Release 和有限 Issue 并保存档案；这两步均不调用模型，也不生成机会卡片。</p>
      {full && <p className="context-note">已选择 3 个组件，请先移除一个，再补充其他组件。</p>}
      {search.isError && <p className="form-error" role="alert">{search.error.message}</p>}
      {collect.isError && <p className="form-error" role="alert">{collect.error.message}</p>}
      {collect.isSuccess && <p className="context-note" role="status">已收录 {collect.data.fullName} 并带入组件选择；未启动模型分析。{collect.data.warning && <span className="form-error">部分采集失败：{collect.data.warning}</span>}</p>}
      {search.data && <div className="component-results" aria-label="组件搜索结果">
        <p className="context-note">查询：<code>{search.data.query}</code> · GitHub 返回总数 {search.data.total}，展示 {search.data.items.length} 个{search.data.incomplete ? " · 搜索结果不完整" : ""} · {new Date(search.data.observedAt).toLocaleString("zh-CN")}</p>
        {!search.data.items.length && <p className="context-note">没有匹配项目。可减少关键词或改用组件通常使用的英文术语；这不表示不存在方案。</p>}
        {search.data.items.map((item) => <article className="component-result" key={item.id}>
          <a href={item.url} target="_blank" rel="noreferrer"><b>{item.fullName} ↗</b></a>
          <p>{item.description ?? "仓库未提供描述，需核对 README。"}</p>
          <small>{item.language ?? "语言未知"} · 许可证 {item.license ?? "未知"} · {item.stars.toLocaleString()} stars{item.archived ? " · 已归档" : ""}{item.fork ? " · Fork" : ""} · {item.collected ? "已收录" : "尚未收录"}</small>
          <button className="button-secondary" type="button" disabled={disabled || full || selectedIds.includes(String(item.id))} onClick={() => collect.mutate(item.fullName)}>{selectedIds.includes(String(item.id)) ? "已选择" : item.collected ? "刷新并选择" : "收录并选择"}</button>
        </article>)}
      </div>}
    </section>
  </details>;
}
