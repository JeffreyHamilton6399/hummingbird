import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import type { SongResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SearchResultItem {
  name?: string;
  snippet?: string;
  url?: string;
  host_name?: string;
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function compactSearchResults(results: unknown): string {
  if (!Array.isArray(results)) return "";
  const items = results as SearchResultItem[];
  if (items.length === 0) return "";
  return items
    .slice(0, 6)
    .map((item, i) => {
      const title = truncate(item.name || "", 120);
      const snippet = truncate(item.snippet || "", 200);
      return `[${i + 1}] ${title}\n${snippet}`;
    })
    .join("\n\n");
}

function extractJson(content: string): unknown {
  if (!content) throw new Error("Empty LLM response");
  let text = content.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }
  return JSON.parse(text);
}

/**
 * Parse search results server-side to extract a best-guess song, even when
 * the LLM is unavailable. Looks for "Title - Artist" or "Title by Artist"
 * patterns in result titles/snippets.
 */
function parseSongFromSearch(
  results: SearchResultItem[],
  description: string
): SongResult | null {
  if (results.length === 0) return null;

  // Common patterns: "Song Title - Artist", "Song Title by Artist", "Artist – Song Title Lyrics"
  const patterns = [
    /^(.+?)\s+[-–—]\s+(.+?)(?:\s+lyrics|\s+official|\s+video|\s*\|.*|$)$/i,
    /^(.+?)\s+by\s+(.+?)(?:\s*\|.*|$)$/i,
    /^(.+?)\s+[-–—]\s+(.+?)\s+lyrics/i,
  ];

  const candidates: Array<{ title: string; artist: string; source: string }> =
    [];

  for (const r of results.slice(0, 6)) {
    const title = (r.name || "").trim();
    const snippet = (r.snippet || "").trim();
    for (const pat of patterns) {
      const m = title.match(pat);
      if (m && m[1] && m[2]) {
        // Filter out obvious non-song results (pure domain names, etc.)
        if (
          m[1].length > 1 &&
          m[2].length > 1 &&
          !m[1].includes(".") &&
          !m[2].includes(".")
        ) {
          candidates.push({
            title: m[1].trim(),
            artist: m[2].trim(),
            source: title,
          });
        }
      }
    }
    // Also try the snippet
    const sm = snippet.match(patterns[0]);
    if (sm && sm[1] && sm[2] && candidates.length < 3) {
      candidates.push({
        title: sm[1].trim(),
        artist: sm[2].trim(),
        source: snippet.slice(0, 60),
      });
    }
  }

  if (candidates.length === 0) return null;

  const top = candidates[0];
  const alternatives = candidates.slice(1, 4).map((c, i) => ({
    title: c.title,
    artist: c.artist,
    confidence: 30 - i * 8,
  }));

  return {
    title: top.title,
    artist: top.artist,
    confidence: 45,
    why: `Based on web search results for "${description.slice(0, 60)}", this looks like the closest match. (AI reasoning was unavailable, so confidence is lower — verify via the links.)`,
    alternatives,
  };
}

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song.

Inputs you may receive:
- SPOKEN WORDS: sung lyrics or a description (PRIMARY signal — lean on it heavily).
- HUMMED MELODY: an approximate contour (direction sequence: up/down/same + coarse step sizes). The user may be a POOR singer — never match by absolute pitch or exact semitones. Match by contour SHAPE only.
- Web search results.

If lyrics are present, they dominate. Return ONLY a JSON object (no markdown):
{"title":string,"artist":string,"year":number|undefined,"confidence":0-100,"why":string,"lyrics_snippet":string|undefined,"alternatives":[{"title":string,"artist":string,"year":number|undefined,"confidence":number}]}

If unsure, lower confidence and add 3-5 alternatives. If truly unknown: {"error":true,"suggestion":"Try singing some lyrics out loud."} Never invent lyrics.`;

async function callLLM(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  userContent: string
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      });
      const content = completion.choices?.[0]?.message?.content ?? "";
      if (content) return content;
    } catch (err) {
      lastErr = err;
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  console.error("[/api/identify] LLM failed after 5 retries:", lastErr);
  throw lastErr instanceof Error ? lastErr : new Error("LLM unavailable");
}

export async function POST(req: Request) {
  let description = "";
  let melody = "";
  try {
    const body = await req.json();
    description =
      typeof body?.description === "string" ? body.description.trim() : "";
    melody = typeof body?.melody === "string" ? body.melody.trim() : "";
  } catch {
    return NextResponse.json(
      { error: true, suggestion: "I couldn't read your input. Try again." },
      { status: 400 }
    );
  }

  if (!description && !melody) {
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "I didn't catch any words or melody. Sing the lyrics out loud, or hum the tune clearly — make sure your mic is on.",
      },
      { status: 400 }
    );
  }

  if (description.length > 800) description = description.slice(0, 800);
  if (melody.length > 800) melody = melody.slice(0, 800);

  let searchResults: SearchResultItem[] = [];
  let searchContext = "";

  try {
    const zai = await ZAI.create();

    // Step 1: web search (best-effort, with retry).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let searchQuery: string;
        if (description) {
          searchQuery = `song lyrics "${description.slice(0, 100)}" artist`;
        } else {
          searchQuery = `famous song melody identify`;
        }
        const raw = await zai.functions.invoke("web_search", {
          query: searchQuery,
          num: 6,
        });
        if (Array.isArray(raw)) {
          searchResults = raw as SearchResultItem[];
          searchContext = compactSearchResults(raw);
        }
        break;
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // Step 2: ask the LLM (with 5 retries + exponential backoff).
    const parts: string[] = [];
    if (description) parts.push(`Spoken words: "${description}"`);
    if (melody) parts.push(`Hummed melody: ${melody}`);
    if (searchContext) parts.push(`Web search results:\n${searchContext}`);
    const userContent = parts.join("\n\n");

    let parsed: SongResult;
    try {
      const content = await callLLM(zai, userContent);
      parsed = extractJson(content) as SongResult;
    } catch {
      // LLM completely failed after all retries — parse search results
      // server-side as a strong fallback.
      console.error("[/api/identify] LLM unavailable, parsing search results");
      const fallback = parseSongFromSearch(searchResults, description);
      if (fallback) {
        return NextResponse.json(fallback);
      }
      // No search results either — return a graceful error.
      return NextResponse.json({
        error: true,
        suggestion:
          "The AI service is having trouble right now. Please try again in a moment — sing the lyrics or hum the tune.",
      });
    }

    // Sanity-check the LLM response shape.
    if (parsed && typeof parsed === "object") {
      if (parsed.error === true) {
        return NextResponse.json(parsed);
      }
      if (typeof parsed.title === "string" && typeof parsed.artist === "string") {
        if (typeof parsed.confidence !== "number") parsed.confidence = 50;
        return NextResponse.json(parsed);
      }
    }

    // LLM returned unparseable JSON — try search fallback before erroring.
    const fallback = parseSongFromSearch(searchResults, description);
    if (fallback) return NextResponse.json(fallback);

    return NextResponse.json({
      error: true,
      suggestion:
        "Hmm, I couldn't pin that one down. Try singing the lyrics, or mention the genre, decade, or the singer's voice.",
    });
  } catch (err) {
    console.error("[/api/identify] fatal error:", err);
    // Last resort: try to parse any search results we got.
    const fallback = parseSongFromSearch(searchResults, description);
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "The AI service is having trouble right now. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}
