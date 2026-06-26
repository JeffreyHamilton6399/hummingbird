import ZAI from "z-ai-web-dev-sdk";

/**
 * The z-ai-web-dev-sdk's built-in ZAI.create() only reads a `.z-ai-config`
 * FILE (project root, home dir, or /etc). It does NOT read environment
 * variables — which is a problem on Vercel/serverless where you can't ship
 * a config file.
 *
 * This helper bridges that gap:
 *  - Locally: `ZAI.create()` finds `/etc/.z-ai-config` (or `~/.z-ai-config`)
 *    and works automatically — no env var needed.
 *  - On Vercel (or anywhere the config file is absent): fall back to
 *    constructing the SDK directly from the `ZAI_API_KEY` environment
 *    variable, using the known Z.ai API base URL.
 *
 * Only `baseUrl` and `apiKey` are required; `chatId`/`userId`/`token` are
 * optional headers that the SDK adds when present.
 */

const ZAI_BASE_URL = "https://internal-api.z.ai/v1";

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>;

let cached: ZAIInstance | null = null;

export async function getZAI(): Promise<ZAIInstance> {
  if (cached) return cached;

  // 1. Try the file-based config (local dev / sandbox).
  try {
    cached = await ZAI.create();
    return cached;
  } catch {
    // No config file found — fall through to env-var construction.
  }

  // 2. Construct from env var (Vercel / serverless).
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ZAI not configured. Set ZAI_API_KEY in your environment, or create a .z-ai-config file."
    );
  }

  // The ZAI class constructor accepts a config object directly.
  cached = new ZAI({
    baseUrl: ZAI_BASE_URL,
    apiKey,
    chatId: process.env.ZAI_CHAT_ID,
    userId: process.env.ZAI_USER_ID,
    token: process.env.ZAI_TOKEN,
  } as ConstructorParameters<typeof ZAI>[0]) as ZAIInstance;

  return cached;
}
