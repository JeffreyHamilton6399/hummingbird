import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Google Gemini helper.
 *
 * Why Gemini:
 *  - Free, generous tier
 *  - Permanent API key (from https://aistudio.google.com/apikey)
 *  - Built-in Google Search grounding — one call does search + reasoning
 *
 * Set GEMINI_API_KEY in your environment (Vercel env vars or .env).
 */

let cachedClient: GoogleGenerativeAI | null = null;
let cachedModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null =
  null;

export function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey");
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenerativeAI(apiKey);
    cachedModel = cachedClient.getGenerativeModel({
      model: "gemini-2.0-flash",
      // Google Search grounding tool — lets Gemini search the web for lyrics.
      tools: [{ googleSearchRetrieval: {} }],
    });
  }
  return { client: cachedClient, model: cachedModel! };
}
