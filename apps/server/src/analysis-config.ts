import { DeepSeekTransport, OpenCodeTransport, CodexTransport, LocalCliTransport, EvidenceFallbackTransport, ModelAnalysisProvider, DEFAULT_OPENCODE_MODEL, findOpenCodeBinary, findCodexBinary, configuredCodexModel, type CompletionTransport } from "@radar/analysis";

export function analysisConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.ANALYSIS_PROVIDER ?? "local";
  if (!["local", "codex", "opencode", "deepseek", "rules"].includes(mode)) throw new Error("ANALYSIS_PROVIDER must be local, codex, opencode, deepseek or rules");
  let provider: ModelAnalysisProvider | null = null;
  let transport: CompletionTransport | null = null;
  let state: "configured" | "needs_api_key" | "needs_cli" | "rules_only";
  let model: string;
  let missingMessage: string;
  let codexFallback = false;
  if (mode === "local" || mode === "codex") {
    const openCode = mode === "local" ? findOpenCodeBinary(env.OPENCODE_BIN) : null;
    const codex = findCodexBinary(env.CODEX_BIN);
    const codexModel = configuredCodexModel(env.CODEX_MODEL);
    const primary = openCode ? new OpenCodeTransport({ binary: openCode, model: env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL }) : null;
    const fallback = codex && codexModel ? new CodexTransport({ binary: codex, model: codexModel }) : null;
    codexFallback = mode === "local" && Boolean(fallback);
    const base = mode === "codex" ? fallback : primary || fallback ? new LocalCliTransport(primary, fallback) : null;
    transport = base ? new EvidenceFallbackTransport(base) : null;
    if (transport) provider = new ModelAnalysisProvider(transport);
    model = transport?.model ?? "本机 CLI 待配置";
    state = provider ? "configured" : "needs_cli";
    missingMessage = "请配置 CODEX_BIN 和 CODEX_MODEL（或 Codex 本机模型配置），或设置 OPENCODE_BIN。未调用 DeepSeek API";
  } else if (mode === "opencode") {
    const binary = findOpenCodeBinary(env.OPENCODE_BIN);
    model = env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL;
    transport = binary ? new EvidenceFallbackTransport(new OpenCodeTransport({ binary, model, timeoutMs: 90_000 })) : null;
    if (transport) provider = new ModelAnalysisProvider(transport);
    state = provider ? "configured" : "needs_cli";
    missingMessage = "未找到 OpenCode CLI：请在本地 .env 设置 OPENCODE_BIN 为 CLI 2.x 的可执行文件路径并重启。项目数据已保留；不会调用 DeepSeek";
  } else if (mode === "deepseek") {
    model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
    if (env.DEEPSEEK_API_KEY?.trim()) { transport = new DeepSeekTransport({ apiKey: env.DEEPSEEK_API_KEY.trim(), model, ...(env.DEEPSEEK_BASE_URL ? { baseUrl: env.DEEPSEEK_BASE_URL } : {}) }); provider = new ModelAnalysisProvider(transport); }
    state = provider ? "configured" : "needs_api_key";
    missingMessage = "请在本地 .env 填写 DEEPSEEK_API_KEY 并重启；项目数据已保留";
  } else {
    state = "rules_only"; model = "rules"; missingMessage = "定向研究需要配置模型";
  }
  return { mode, provider, transport, state, model, missingMessage, codexFallback };
}
