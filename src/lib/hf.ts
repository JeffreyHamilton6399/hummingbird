/**
 * Hugging Face Inference helper — genuinely free, no credits/payment.
 *
 *  - Free tier: ~1000 requests/day, no billing needed
 *  - Free permanent token from https://huggingface.co/settings/tokens
 *  - No region restrictions (unlike Gemini)
 *  - Uses open models like Llama 3.1 8B that know songs/lyrics
 *  - OpenAI-compatible API — plain fetch, no package
 *
 * Set HUGGINGFACE_API_KEY in your environment (.env or Vercel).
 * Get one at https://huggingface.co/settings/tokens (create a "Read" token).
 */

const HF_BASE_URL = "https://router.huggingface.co/v1/chat/completions";
// Llama 3.1 8B Instruct — capable, knows songs/lyrics, on the free tier.
const MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callHuggingFace(
  messages: ChatMessage[],
  timeoutMs = 40000
): Promise<string> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "HUGGINGFACE_API_KEY is not set. Get a free one at https://huggingface.co/settings/tokens"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(HF_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      let msg = `HuggingFace API error (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        msg = parsed?.error?.message || parsed?.error || msg;
      } catch {
        msg = `${msg}: ${body.slice(0, 200)}`;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("HuggingFace returned an empty response");
    return content;
  } finally {
    clearTimeout(timer);
  }
}
