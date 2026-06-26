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

  try {
    const zai = await ZAI.create();

    // Step 1: web search. Use the spoken words if available (most effective);
    // fall back to a melody-based query if the user only hummed.
    let searchContext = "";
    try {
      let searchQuery: string;
      if (description) {
        searchQuery = `song lyrics "${description.slice(0, 120)}" artist`;
      } else {
        // Melody-only: extract the shape keyword for a broad search.
        const shapeMatch = melody.match(/Contour shape: ([^.]+)\./);
        const shape = shapeMatch?.[1] || "melody";
        searchQuery = `famous song ${shape} melody identify`;
      }
      const searchResults = await zai.functions.invoke("web_search", {
        query: searchQuery,
        num: 8,
      });
      searchContext = compactSearchResults(searchResults);
    } catch {
      searchContext = "";
    }

    // Step 2: ask the LLM to identify the song.
    const systemPrompt = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song. You receive up to two inputs:

1. SPOKEN WORDS — a transcript of what the user said (lyrics, a description, the era, the singer's gender, etc.). May be empty.
2. HUMMED MELODY — a textual description of the melody's pitch contour, given as relative intervals in semitones from the first note plus a shape description. May be null.

Famous melodies have distinctive interval patterns. Match the hummed contour to well-known songs using your knowledge of melody. If the user also spoke words, combine both signals. Quote or reference the user's words when explaining the match.

Return ONLY a JSON object (no markdown, no prose) with this exact shape:
{
  "title": string,
  "artist": string,
  "year": number | undefined,
  "confidence": number,            // 0-100
  "why": string,                   // 1-3 sentences explaining the match, referencing the user's words/melody
  "lyrics_snippet": string | undefined,  // <= 25 words, or omit if unsure
  "alternatives": [                // 0-4 other likely songs, ranked by confidence
    { "title": string, "artist": string, "year": number | undefined, "confidence": number }
  ]
}

Rules:
- If you are fairly sure (>= 70), still include 1-2 alternatives.
- If you are not sure, return your best guess with a lower confidence and 3-5 alternatives.
- If you truly cannot identify it, return: { "error": true, "suggestion": "Try singing the lyrics out loud, or mention the genre, decade, or the singer's voice. Humming works best with famous melodies." }
- Never invent fake lyrics. If unsure of the exact snippet, omit lyrics_snippet.
- Keep "why" concise and human.`;

    const parts: string[] = [];
    if (description) parts.push(`Spoken words: "${description}"`);
    if (melody) parts.push(`Hummed melody: ${melody}`);
    if (searchContext) parts.push(`Web search results:\n${searchContext}`);
    const userContent = parts.join("\n\n");

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as SongResult;

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
    console.error("[/api/identify] error:", err);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "Something went wrong while searching. Try again in a moment, or sing the lyrics instead.",
      },
      { status: 500 }
    );
  }
}
