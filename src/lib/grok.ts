/**
 * Grok (xAI) helper — no package needed, just fetch.
 *
 * xAI's API is OpenAI-compatible: https://api.x.ai/v1/chat/completions
 *  - No region restrictions (unlike Gemini)
 *  - Free tier available
 *  - Grok has broad knowledge of songs/lyrics from training data
 *
 * Get an API key at https://console.x.ai/ (starts with "xai-")
 * Set GROK_API_KEY in your environment (.env or Vercel env vars).
 */

const XAI_BASE_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-beta"; // fast, capable, free-tier friendly

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callGrok(
  messages: ChatMessage[],
  timeoutMs = 30000
): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROK_API_KEY is not set. Get one at https://console.x.ai/"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(XAI_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      let msg = `Grok API error (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        msg = parsed?.error?.message || msg;
      } catch {
        msg = `${msg}: ${body.slice(0, 200)}`;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("Grok returned an empty response");
    return content;
  } finally {
    clearTimeout(timer);
  }
}
