import { GoogleGenerativeAI } from "@google/generative-ai";
import ZAI from "z-ai-web-dev-sdk";

/**
 * AI provider helper — tries Gemini first (if GEMINI_API_KEY is set),
 * falls back to the Z.ai SDK (which reads /etc/.z-ai-config locally).
 *
 * This way the app works:
 *  - Locally with zero setup (Z.ai config file is provisioned)
 *  - On Vercel with just GEMINI_API_KEY (free, permanent key)
 */

export type IdentifyResult = {
  content: string;
};

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song.

Inputs you may receive:
- SPOKEN WORDS: sung lyrics or a description (PRIMARY signal — lean on it heavily).
- HUMMED MELODY: an approximate contour (direction sequence: up/down/same). The user may be a POOR singer — never match by absolute pitch. Match by contour SHAPE only.

If lyrics are present, they dominate. Even a few rough words can identify a song. For melody-only, try to match famous melodies by their contour shape (e.g. "up up up-a-lot same down" = Happy Birthday). You can use Google Search to look up lyrics and confirm matches.

Always return your best guess with alternatives — never return an error unless you truly have zero idea. If unsure, lower confidence and add 3-5 alternatives. Never invent lyrics.

Return ONLY a JSON object (no markdown, no prose):
{"title":string,"artist":string,"year":number|undefined,"confidence":0-100,"why":string,"lyrics_snippet":string|undefined,"alternatives":[{"title":string,"artist":string,"year":number|undefined,"confidence":number}]}`;

let geminiClient: GoogleGenerativeAI | null = null;
let geminiModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null =
  null;
let zaiCache: Awaited<ReturnType<typeof ZAI.create>> | null = null;

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(apiKey);
    geminiModel = geminiClient.getGenerativeModel({
      model: "gemini-1.5-flash",
      tools: [{ googleSearchRetrieval: {} }],
    });
  }
  return geminiModel;
}

async function getZAI() {
  if (zaiCache) return zaiCache;
  zaiCache = await ZAI.create();
  return zaiCache;
}

/**
 * Run the identification. Tries Gemini (with Google Search grounding),
 * falls back to Z.ai (web_search + LLM) if Gemini isn't configured.
 */
export async function identifySong(
  description: string,
  melody: string
): Promise<string> {
  const userContent = [
    description ? `Spoken words: "${description}"` : "",
    melody ? `Hummed melody: ${melody}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // --- Try Gemini first ---
  const model = getGeminiModel();
  if (model) {
    try {
      const result = await Promise.race([
        model.generateContent([{ text: SYSTEM_PROMPT }, { text: userContent }]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Gemini timed out")), 25000)
        ),
      ]);
      const text = result.response.text();
      if (text) return text;
    } catch (err) {
      console.error("[identify] Gemini failed, falling back to Z.ai:", err);
    }
  }

  // --- Fallback: Z.ai SDK (web_search + LLM) ---
  const zai = await getZAI();

  // Web search for context
  let searchContext = "";
  try {
    const searchQuery = description
      ? `song lyrics "${description.slice(0, 100)}"`
      : `famous song melody identify`;
    const raw = await Promise.race([
      zai.functions.invoke("web_search", { query: searchQuery, num: 6 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("search timed out")), 10000)
      ),
    ]);
    if (Array.isArray(raw)) {
      const items = raw as Array<{ name?: string; snippet?: string }>;
      searchContext = items
        .slice(0, 6)
        .map(
          (it, i) =>
            `[${i + 1}] ${(it.name || "").slice(0, 100)}\n${(it.snippet || "").slice(0, 180)}`
        )
        .join("\n\n");
    }
  } catch {
    // search best-effort
  }

  const fullContent = [
    userContent,
    searchContext ? `Web search results:\n${searchContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // LLM call
  const completion = await Promise.race([
    zai.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: fullContent },
      ],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM timed out")), 15000)
    ),
  ]);

  return completion.choices?.[0]?.message?.content ?? "";
}
