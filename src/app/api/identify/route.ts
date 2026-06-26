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

// Domains that indicate a search result is about a song.
const MUSIC_DOMAINS = [
  "genius.com",
  "azlyrics.com",
  "musixmatch.com",
  "lyrics",
  "youtube.com",
  "spotify.com",
  "apple.com",
  "wikipedia.org",
  "metrolyrics.com",
  "songlyrics.com",
];

function isMusicResult(item: SearchResultItem): boolean {
  const host = (item.host_name || "").toLowerCase();
  const text = ((item.name || "") + " " + (item.snippet || "")).toLowerCase();
  if (MUSIC_DOMAINS.some((d) => host.includes(d) || text.includes(d)))
    return true;
  if (text.includes("lyrics") || text.includes("song by") || text.includes("official video"))
    return true;
  return false;
}

/**
 * Smart parser: extract (title, artist) from a search result's title/snippet.
 * Handles common formats:
 *   "Artist - Song Title (Lyrics)"
 *   "Song Title by Artist | Lyrics"
 *   "Artist – Song Title (Official Video)"
 *   "Song Title Lyrics - Artist"
 */
function extractSongFromText(
  rawTitle: string,
  snippet: string
): { title: string; artist: string } | null {
  const clean = (s: string) =>
    s
      .replace(/\(.*?\)/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/\|.*$/, "")
      .replace(/lyrics/gi, "")
      .replace(/official (video|audio|music video)/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const candidates = [rawTitle, snippet, `${rawTitle} ${snippet}`];

  for (const text of candidates) {
    if (!text) continue;
    const t = clean(text);
    if (!t) continue;

    // Pattern: "Artist - Title" or "Artist – Title"
    let m = t.match(/^(.+?)\s+[-–—]\s+(.+?)$/);
    if (m && m[1] && m[2] && m[1].length > 1 && m[2].length > 1) {
      // If the right side looks like a song title (shorter, no "by")
      if (!m[2].toLowerCase().includes(" by ")) {
        return { artist: m[1].trim(), title: m[2].trim() };
      }
    }

    // Pattern: "Title by Artist"
    m = t.match(/^(.+?)\s+by\s+(.+?)$/i);
    if (m && m[1] && m[2] && m[1].length > 1 && m[2].length > 1) {
      return { title: m[1].trim(), artist: m[2].trim() };
    }

    // Pattern: "Title Lyrics" (just the title, artist unknown)
    m = t.match(/^(.+?)\s*lyrics\s*$/i);
    if (m && m[1] && m[1].length > 2) {
      // Try to find artist in the other field
      const otherText = text === rawTitle ? snippet : rawTitle;
      const artistMatch = otherText.match(/by\s+([A-Z][\w\s&.'-]+)/);
      return {
        title: m[1].trim(),
        artist: artistMatch ? artistMatch[1].trim() : "Unknown artist",
      };
    }
  }

  // Last resort: just use the cleaned title
  const fallback = clean(rawTitle);
  if (fallback && fallback.length > 2) {
    return { title: fallback, artist: "Unknown artist" };
  }
  return null;
}

/**
 * Parse search results server-side to extract best-guess songs.
 * Returns ranked candidates.
 */
function parseSongsFromSearch(
  results: SearchResultItem[],
  description: string
): SongResult | null {
  if (results.length === 0) return null;

  // Prefer music-related results
  const musicResults = results.filter(isMusicResult);
  const pool = musicResults.length > 0 ? musicResults : results;

  const candidates: Array<{
    title: string;
    artist: string;
    source: string;
  }> = [];

  for (const r of pool.slice(0, 6)) {
    const extracted = extractSongFromText(r.name || "", r.snippet || "");
    if (extracted && extracted.title.length > 1) {
      // Filter out obvious garbage
      if (
        !extracted.title.includes(".") &&
        !extracted.artist.includes(".") &&
        extracted.title.length < 80
      ) {
        candidates.push({
          title: extracted.title,
          artist: extracted.artist,
          source: r.name || "",
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Deduplicate by title (case-insensitive)
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = c.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const top = unique[0];
  const alternatives = unique.slice(1, 4).map((c, i) => ({
    title: c.title,
    artist: c.artist,
    confidence: 35 - i * 8,
  }));

  return {
    title: top.title,
    artist: top.artist,
    confidence: 50,
    why: `Based on web search results for "${description.slice(
      0,
      50
    )}", this is the closest match. The AI reasoning service was busy, so verify via the links below.`,
    alternatives,
  };
}

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song.

Inputs you may receive:
- SPOKEN WORDS: sung lyrics or a description (PRIMARY signal — lean on it heavily).
- HUMMED MELODY: an approximate contour (direction sequence: up/down/same). The user may be a POOR singer — never match by absolute pitch. Match by contour SHAPE only.
- Web search results.

If lyrics are present, they dominate. Even a few rough words can identify a song. For melody-only, try to match famous melodies by their contour shape (e.g. "up up up-a-lot same down" = Happy Birthday).

Return ONLY a JSON object (no markdown):
{"title":string,"artist":string,"year":number|undefined,"confidence":0-100,"why":string,"lyrics_snippet":string|undefined,"alternatives":[{"title":string,"artist":string,"year":number|undefined,"confidence":number}]}

Always return your best guess with alternatives — never return an error unless you truly have zero idea. If unsure, lower confidence and add 3-5 alternatives. Never invent lyrics.`;

async function callLLM(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  userContent: string
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
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
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
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
          searchQuery = `song lyrics "${description.slice(0, 100)}"`;
        } else {
          // For melody-only, search for the contour shape keywords
          const shapeMatch = melody.match(/shape: ([^.]+)/i);
          const shape = shapeMatch?.[1] || "melody";
          searchQuery = `famous song ${shape} melody`;
        }
        const raw = await zai.functions.invoke("web_search", {
          query: searchQuery,
          num: 8,
        });
        if (Array.isArray(raw)) {
          searchResults = raw as SearchResultItem[];
          searchContext = compactSearchResults(raw);
        }
        break;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Step 2: ask the LLM.
    const parts: string[] = [];
    if (description) parts.push(`Spoken words: "${description}"`);
    if (melody) parts.push(`Hummed melody: ${melody}`);
    if (searchContext) parts.push(`Web search results:\n${searchContext}`);
    const userContent = parts.join("\n\n");

    try {
      const content = await callLLM(zai, userContent);
      const parsed = extractJson(content) as SongResult;

      if (parsed && typeof parsed === "object") {
        // If the LLM returned an error, DON'T pass it through — fall through
        // to the search-result fallback so the user gets something useful.
        if (parsed.error !== true) {
          if (
            typeof parsed.title === "string" &&
            typeof parsed.artist === "string"
          ) {
            if (typeof parsed.confidence !== "number")
              parsed.confidence = 50;
            return NextResponse.json(parsed);
          }
        }
      }
    } catch {
      // LLM failed entirely — fall through to search parsing
    }

    // Fallback: parse search results server-side.
    const fallback = parseSongsFromSearch(searchResults, description);
    if (fallback) return NextResponse.json(fallback);

    // No search results either — graceful error.
    return NextResponse.json({
      error: true,
      suggestion:
        "I couldn't find a match. Try singing a few of the lyrics out loud — even rough words help a lot.",
    });
  } catch (err) {
    console.error("[/api/identify] fatal:", err);
    const fallback = parseSongsFromSearch(searchResults, description);
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "The service is having trouble right now. Please try again in a moment.",
      },
      { status: 500 }
    );
  }
}
