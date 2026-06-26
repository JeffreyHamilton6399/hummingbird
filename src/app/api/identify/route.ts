import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import type { SongResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    .slice(0, 8)
    .map((item, i) => {
      const title = truncate(item.name || "", 120);
      const snippet = truncate(item.snippet || "", 280);
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

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song. You receive up to two inputs:

1. SPOKEN WORDS (PRIMARY signal) — a transcript of sung lyrics or a spoken description. This is the MOST RELIABLE signal. If present, lean on it heavily: search for the lyrics, quote them, and match.
2. HUMMED MELODY (secondary, approximate) — a description of the melody's CONTOUR as a direction sequence (up / down / same) and coarse step sizes.

CRITICAL — the user may be a POOR singer:
- They will NOT sing in the original key. Never match by absolute pitch or exact semitones.
- Their exact intervals may be wrong. Do NOT compare semitone numbers to the original song.
- DO match the melody by its CONTOUR SHAPE — the sequence of ups, downs, and sames — which even a bad singer conveys. Famous melodies have distinctive contour shapes (e.g. "Twinkle Twinkle" = same-same-up-same-same; "Happy Birthday" = up-up-up-a-lot-same-down; "Somewhere Over the Rainbow" opens with a big upward leap).
- Combine both signals when both are present. If lyrics are present, they dominate; the melody is a confirming hint. If only the melody is present, match famous melodies by contour shape and be honest about lower confidence.

Return ONLY a JSON object (no markdown, no prose) with this exact shape:
{
  "title": string,
  "artist": string,
  "year": number | undefined,
  "confidence": number,
  "why": string,
  "lyrics_snippet": string | undefined,
  "alternatives": [
    { "title": string, "artist": string, "year": number | undefined, "confidence": number }
  ]
}

Rules:
- If you are fairly sure (>= 70), still include 1-2 alternatives.
- If you are not sure, return your best guess with a lower confidence and 3-5 alternatives.
- If you truly cannot identify it, return: { "error": true, "suggestion": "Try singing some of the lyrics out loud — even a few words helps a lot." }
- Never invent fake lyrics. If unsure of the exact snippet, omit lyrics_snippet.
- Keep "why" concise and human.`;

async function callLLM(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  userContent: string
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
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
      // Brief backoff before retry.
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  console.error("[/api/identify] LLM failed after retries:", lastErr);
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
          "I didn't catch any words or melody. Sing the lyrics out loud, or hum the tune clearly — make sure your mic is on and you're in a quiet spot.",
      },
      { status: 400 }
    );
  }

  if (description.length > 1000) description = description.slice(0, 1000);
  if (melody.length > 1000) melody = melody.slice(0, 1000);

  let searchContext = "";
  let searchResults: SearchResultItem[] = [];

  try {
    const zai = await ZAI.create();

    // Step 1: web search (best-effort).
    try {
      let searchQuery: string;
      if (description) {
        searchQuery = `song lyrics "${description.slice(0, 120)}" artist`;
      } else {
        const shapeMatch = melody.match(/shape: ([^.]+)\./i);
        const shape = shapeMatch?.[1] || "melody";
        searchQuery = `famous song ${shape} melody identify`;
      }
      const raw = await zai.functions.invoke("web_search", {
        query: searchQuery,
        num: 8,
      });
      if (Array.isArray(raw)) searchResults = raw as SearchResultItem[];
      searchContext = compactSearchResults(raw);
    } catch {
      // Search is best-effort; the LLM can still reason from the description.
      searchContext = "";
    }

    // Step 2: ask the LLM to identify the song (with retries).
    const parts: string[] = [];
    if (description) parts.push(`Spoken words: "${description}"`);
    if (melody) parts.push(`Hummed melody: ${melody}`);
    if (searchContext) parts.push(`Web search results:\n${searchContext}`);
    const userContent = parts.join("\n\n");

    let parsed: SongResult;
    try {
      const content = await callLLM(zai, userContent);
      parsed = extractJson(content) as SongResult;
    } catch (llmErr) {
      // LLM completely failed — fall back to raw search results so the user
      // gets *something* useful instead of a blank error.
      console.error("[/api/identify] LLM unavailable, returning search fallback");
      if (searchResults.length > 0) {
        const top = searchResults.slice(0, 4).map((r, i) => ({
          title: r.name || "Unknown",
          artist: r.host_name || "",
          confidence: 40 - i * 10,
        }));
        return NextResponse.json({
          title: top[0].title,
          artist: top[0].artist,
          confidence: 30,
          why: "The AI reasoning service was unavailable, but here are the top web search results for your description.",
          alternatives: top.slice(1),
        } satisfies SongResult);
      }
      throw llmErr;
    }

    // Sanity-check the shape.
    if (parsed && typeof parsed === "object") {
      if (parsed.error === true) {
        return NextResponse.json(parsed);
      }
      if (typeof parsed.title === "string" && typeof parsed.artist === "string") {
        if (typeof parsed.confidence !== "number") parsed.confidence = 50;
        return NextResponse.json(parsed);
      }
    }

    return NextResponse.json({
      error: true,
      suggestion:
        "Hmm, I couldn't pin that one down. Try singing the lyrics, or mention the genre, decade, or the singer's voice.",
    });
  } catch (err) {
    console.error("[/api/identify] fatal error:", err);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "The AI service is having trouble right now. Please try again in a moment — sing the lyrics or hum the tune.",
      },
      { status: 500 }
    );
  }
}
