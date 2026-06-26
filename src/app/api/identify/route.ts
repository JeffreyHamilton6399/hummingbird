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
  // Strip markdown code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  // If there's still surrounding prose, grab the outermost JSON object.
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
  try {
    const body = await req.json();
    description = typeof body?.description === "string" ? body.description.trim() : "";
  } catch {
    return NextResponse.json(
      { error: true, suggestion: "I couldn't read your description. Try again." },
      { status: 400 }
    );
  }

  if (!description) {
    return NextResponse.json(
      {
        error: true,
        suggestion: "Tell me about the song first — hum it, or describe the lyrics, genre, or decade.",
      },
      { status: 400 }
    );
  }

  if (description.length > 1000) {
    description = description.slice(0, 1000);
  }

  try {
    const zai = await ZAI.create();

    // Step 1: web search for the description + lyrics context.
    const searchQuery = `song lyrics "${description.slice(0, 120)}" artist`;
    let searchContext = "";
    try {
      const searchResults = await zai.functions.invoke("web_search", {
        query: searchQuery,
        num: 8,
      });
      searchContext = compactSearchResults(searchResults);
    } catch {
      // Search is best-effort; the LLM can still reason from the description alone.
      searchContext = "";
    }

    // Step 2: ask the LLM to identify the song.
    const systemPrompt = `You are "Hummingbird", a music identification expert. A user hummed, sang, or described a song. Their description (possibly partial, misheard, or paraphrased) is provided. You also have web search results to ground your answer.

Identify the most likely song. Quote or reference the user's description when explaining the match. Consider lyrics, era/decade, genre, and the singer's gender if mentioned.

Return ONLY a JSON object (no markdown, no prose) with this exact shape:
{
  "title": string,
  "artist": string,
  "year": number | undefined,
  "confidence": number,            // 0-100, how sure you are
  "why": string,                   // 1-3 sentences explaining the match, referencing the user's words
  "lyrics_snippet": string | undefined,  // the line(s) the user was probably thinking of, <= 25 words
  "alternatives": [                // 0-4 other likely songs, ranked by confidence
    { "title": string, "artist": string, "year": number | undefined, "confidence": number }
  ]
}

Rules:
- If you are fairly sure (>= 70), still include 1-2 alternatives.
- If you are not sure, return your best guess with a lower confidence and 3-5 alternatives.
- If you truly cannot identify it, return: { "error": true, "suggestion": "Try being more specific — mention lyrics, genre, decade, or the singer's gender." }
- Never invent fake lyrics. If unsure of the exact snippet, omit lyrics_snippet.
- Keep "why" concise and human.`;

    const userContent = `User's description: "${description}"${
      searchContext ? `\n\nWeb search results:\n${searchContext}` : ""
    }`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content) as SongResult;

    // Basic sanity-check the shape.
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
        "Hmm, I couldn't pin that one down. Try mentioning a lyric, the genre, the decade, or the singer's gender.",
    });
  } catch (err) {
    console.error("[/api/identify] error:", err);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "Something went wrong while searching. Try again in a moment, or describe the song differently.",
      },
      { status: 500 }
    );
  }
}
