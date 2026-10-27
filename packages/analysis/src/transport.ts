export type ModelProvider = "deepseek" | "opencode" | "codex" | "local-cli";
export type Completion = { content: string; promptTokens?: number; completionTokens?: number; finishReason?: string; model?: string };
export interface CompletionTransport {
  readonly provider: ModelProvider;
  readonly model: string;
  complete(system: string, input: unknown, outputSchema: unknown): Promise<Completion>;
}

export type DeepSeekOptions = {
  apiKey: string; model?: string; baseUrl?: string; fetcher?: typeof fetch; timeoutMs?: number;
};

export class DeepSeekTransport implements CompletionTransport {
  readonly provider = "deepseek" as const;
  readonly model: string;
  private readonly endpoint: string;
  constructor(private readonly options: DeepSeekOptions) {
    if (!options.apiKey.trim()) throw new Error("DEEPSEEK_API_KEY is required");
    this.model = options.model ?? "deepseek-v4-flash";
    const base = new URL(options.baseUrl ?? "https://api.deepseek.com");
    if (base.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new Error("The model endpoint must use HTTPS");
    this.endpoint = `${base.href.replace(/\/$/, "")}/chat/completions`;
  }
  async complete(system: string, input: unknown, outputSchema: unknown): Promise<Completion> {
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(this.endpoint, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({ model: this.model, thinking: { type: "disabled" }, response_format: { type: "json_object" }, max_tokens: 6000,
          messages: [{ role: "system", content: `${system} 输出必须严格符合 outputSchema 中的字段、枚举、字符长度和数组上限。` }, { role: "user", content: JSON.stringify({ taskData: input, outputSchema }) }] }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 90_000),
      });
    } catch { throw new Error("DeepSeek request timed out or could not connect; project evidence was retained"); }
    if (!response.ok) throw new Error(`DeepSeek returned HTTP ${response.status}; check the API key, balance, model and endpoint`);
    let payload: { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try { payload = await response.json() as typeof payload; }
    catch { throw new Error("DeepSeek returned an unreadable response; no new hypotheses were saved"); }
    return { content: payload.choices?.[0]?.message?.content ?? "", ...(payload.usage?.prompt_tokens !== undefined ? { promptTokens: payload.usage.prompt_tokens } : {}),
      ...(payload.usage?.completion_tokens !== undefined ? { completionTokens: payload.usage.completion_tokens } : {}),
      ...(payload.choices?.[0]?.finish_reason ? { finishReason: payload.choices[0].finish_reason } : {}) };
  }
}
