const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function responseOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (typeof content?.text === "string") return content.text;
      if (typeof content?.output_text === "string") return content.output_text;
    }
  }
  return null;
}

export function compactUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? null,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

export async function createResponse(body, options = {}) {
  const baseUrl = options.baseUrl ?? process.env.LLM_BASE_URL;
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
  const attempts = options.attempts ?? 5;
  if (!baseUrl) throw new Error("LLM_BASE_URL is required");
  if (!apiKey) throw new Error("LLM_API_KEY is required");

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = await response.text();
      let payload;
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
      if (response.ok) return payload;
      const message = payload?.error?.message ?? (responseText.slice(0, 600) || `HTTP ${response.status}`);
      const error = new Error(`Responses API ${response.status}: ${message}`);
      error.status = response.status;
      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error?.status && ![408, 409, 429, 500, 502, 503, 504].includes(error.status)) throw error;
    }
    if (attempt < attempts) {
      const rateLimitPause = lastError?.status === 429 ? 15_000 : 0;
      await delay(Math.max(rateLimitPause, Math.min(12_000, 1_500 * 2 ** (attempt - 1))));
    }
  }
  throw lastError;
}
