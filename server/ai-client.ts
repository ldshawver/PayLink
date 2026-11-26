/**
 * Self-hosted AI client. Talks only to an Ollama-compatible OpenAI API
 * (POST {AI_BASE_URL}/v1/chat/completions). Hosts that are OpenAI or xAI are
 * rejected before any request is made. There is no fallback provider.
 */
export const BLOCKED_AI_HOSTS = ["api.openai.com", "openai.com", "api.x.ai", "x.ai"] as const;

export const AI_NOT_CONFIGURED_MESSAGE =
  "AI is not set up on this server. Receipt scanning, proposal assist, and App Doctor use a self-hosted model, and that service is not configured.";

export interface AiEndpoint {
  baseUrl: string;
  model: string;
  visionModel: string | null;
  /** Full Authorization header value. Never logged. */
  authorization: string | null;
}

export interface AiEndpointResult {
  endpoint: AiEndpoint | null;
  reason: string | null;
}

export function aiHostIsBlocked(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  return BLOCKED_AI_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function authorizationFromEnv(env: NodeJS.ProcessEnv): string | null {
  const header = (env.AI_AUTH_HEADER || "").trim();
  if (header) {
    if (/^(bearer|basic)\s+/i.test(header)) return header;
    return `Bearer ${header}`;
  }
  const key = (env.AI_API_KEY || "").trim();
  return key ? `Bearer ${key}` : null;
}

/** Reads env only. Does not contact the network. */
export function readAiEndpoint(env: NodeJS.ProcessEnv = process.env): AiEndpointResult {
  const raw = (env.AI_BASE_URL || "").trim();
  if (!raw) return { endpoint: null, reason: "AI_BASE_URL is not set" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { endpoint: null, reason: "AI_BASE_URL is not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { endpoint: null, reason: "AI_BASE_URL must use http or https" };
  }
  if (url.username || url.password) {
    return { endpoint: null, reason: "Put credentials in AI_AUTH_HEADER, not in AI_BASE_URL" };
  }
  if (aiHostIsBlocked(url.hostname)) {
    return { endpoint: null, reason: "AI_BASE_URL points at an external AI service that is not allowed" };
  }
  const model = (env.AI_MODEL || "").trim();
  if (!model) return { endpoint: null, reason: "AI_MODEL is not set" };
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  const baseUrl = `${url.origin}${path === "/" ? "" : path}`;
  return {
    endpoint: {
      baseUrl,
      model,
      visionModel: (env.AI_VISION_MODEL || "").trim() || null,
      authorization: authorizationFromEnv(env),
    },
    reason: null,
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

export interface ChatArgs {
  endpoint: AiEndpoint;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  fetchImpl?: typeof fetch;
}

/** One chat completion against the configured endpoint. Throws on HTTP failure. */
export async function completeChat(args: ChatArgs): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.endpoint.authorization) headers.Authorization = args.endpoint.authorization;
  const body: Record<string, unknown> = {
    model: args.model || args.endpoint.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.2,
    max_tokens: args.maxTokens ?? 800,
  };
  if (args.json) body.response_format = { type: "json_object" };
  const response = await fetchImpl(`${args.endpoint.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Self-hosted AI returned HTTP ${response.status}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Self-hosted AI returned a non-JSON response");
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Self-hosted AI returned an empty response");
  }
  return content;
}
