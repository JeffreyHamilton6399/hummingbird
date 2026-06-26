import { NextResponse } from "next/server";
import { getGemini } from "@/lib/gemini";
import type { SongResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extractJson(content: string): unknown {
  if (!content) throw new Error("Empty response");
  let text = content.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }
  return JSON.parse(text);
}

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user hummed, sang, or spoke about a song.

Inputs you may receive:
- SPOKEN WORDS: sung lyrics or a description (PRIMARY signal — lean on it heavily).
- HUMMED MELODY: an approximate contour (direction sequence: up/down/same). The user may be a POOR singer — never match by absolute pitch. Match by contour SHAPE only.

If lyrics are present, they dominate. Even a few rough words can identify a song. For melody-only, try to match famous melodies by their contour shape (e.g. "up up up-a-lot same down" = Happy Birthday). You can use Google Search to look up lyrics and confirm matches.

Always return your best guess with alternatives — never return an error unless you truly have zero idea. If unsure, lower confidence and add 3-5 alternatives. Never invent lyrics.

Return ONLY a JSON object (no markdown, no prose):
{"title":string,"artist":string,"year":number|undefined,"confidence":0-100,"why":string,"lyrics_snippet":string|undefined,"alternatives":[{"title":string,"artist":string,"year":number|undefined,"confidence":number}]}`;

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

  // Build the user prompt
  const parts: string[] = [];
  if (description) parts.push(`Spoken words: "${description}"`);
  if (melody) parts.push(`Hummed melody: ${melody}`);
  const userContent = parts.join("\n\n");

  try {
    const { model } = getGemini();

    // Single call with Google Search grounding built-in.
    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: userContent },
    ]);

    const content = result.response.text();
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

    // If JSON parsing failed, try to salvage the raw text.
    return NextResponse.json({
      title: "Unknown",
      artist: "Unknown",
      confidence: 0,
      why: content.slice(0, 300),
      alternatives: [],
    });
  } catch (err) {
    console.error("[/api/identify] Gemini error:", err);
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "I couldn't identify that one. Try singing a few of the lyrics out loud — even rough words help a lot.",
      },
      { status: 500 }
    );
  }
}
