import { NextResponse } from "next/server";
import { recognizeAudio, type AudDResult } from "@/lib/audd";
import { callHuggingFace } from "@/lib/hf";
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

function auddToSongResult(r: AudDResult): SongResult {
  const year = r.release_date
    ? parseInt(r.release_date.slice(0, 4), 10)
    : undefined;
  return {
    title: r.title,
    artist: r.artist,
    year: isNaN(year as number) ? undefined : year,
    confidence: 90,
    why: "Matched by audio fingerprint — this is the song in your recording.",
    lyrics_snippet: r.lyrics
      ? r.lyrics.split("\n").slice(0, 2).join(" ").slice(0, 150)
      : undefined,
    alternatives: [],
  } as SongResult;
}

const SYSTEM_PROMPT = `You are "Hummingbird", a music identification expert. A user sang some lyrics or described a song. Match the lyrics to the song. Even a few rough words can identify a song.

Always return your best guess with alternatives — never return an error unless you truly have zero idea. Never invent lyrics.

Return ONLY a JSON object (no markdown, no prose):
{"title":string,"artist":string,"year":number|undefined,"confidence":0-100,"why":string,"lyrics_snippet":string|undefined,"alternatives":[{"title":string,"artist":string,"year":number|undefined,"confidence":number}]}`;

export async function POST(req: Request) {
  let audioBlob: Blob | null = null;
  let transcript = "";

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const audioFile = formData.get("audio");
      if (audioFile instanceof Blob) {
        audioBlob = audioFile;
      }
      transcript = (formData.get("transcript") as string)?.trim() || "";
    } else {
      const body = await req.json();
      transcript =
        typeof body?.description === "string" ? body.description.trim() : "";
    }
  } catch {
    return NextResponse.json(
      { error: true, suggestion: "I couldn't read your input. Try again." },
      { status: 400 }
    );
  }

  if (!audioBlob && !transcript) {
    return NextResponse.json(
      {
        error: true,
        suggestion:
          "I didn't catch any sound. Sing the lyrics or hum the tune — make sure your mic is on.",
      },
      { status: 400 }
    );
  }

  // --- PRIMARY: AudD audio fingerprinting ---
  if (audioBlob && audioBlob.size > 100) {
    const auddToken = process.env.AUDD_API_TOKEN;
    if (!auddToken) {
      console.error("[/api/identify] AUDD_API_TOKEN not set — cannot do audio recognition");
      return NextResponse.json({
        error: true,
        suggestion:
          "Audio recognition isn't configured. The owner needs to set AUDD_API_TOKEN (free at audd.io) for humming/singing to work. Without it, the app can only guess from lyrics — which is often wrong.",
      });
    }
    try {
      const result = await recognizeAudio(audioBlob);
      if (result) {
        return NextResponse.json(auddToSongResult(result));
      }
      // No fingerprint match — fall through to lyrics LLM if we have words.
    } catch (err) {
      console.error("[/api/identify] AudD error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not set")) {
        return NextResponse.json({
          error: true,
          suggestion:
            "Audio recognition isn't configured (AUDD_API_TOKEN missing). Set it for humming to work.",
        });
      }
      if (msg.includes("limit") || msg.includes("exceeded") || msg.includes("requests")) {
        return NextResponse.json({
          error: true,
          suggestion:
            "AudD free tier limit reached (10/day). Try again tomorrow, or upgrade at audd.io.",
        });
      }
      // Other AudD error — fall through to LLM if we have words.
    }
  }

  // --- FALLBACK: LLM lyrics matching (less reliable — may hallucinate) ---
  if (transcript) {
    try {
      const content = await callHuggingFace([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Spoken words: "${transcript.slice(0, 800)}"`,
        },
      ]);
      const parsed = extractJson(content) as SongResult;
      if (parsed && typeof parsed === "object" && parsed.title && parsed.artist) {
        // Cap confidence — the small LLM hallucinates, so never claim high confidence.
        if (typeof parsed.confidence !== "number") parsed.confidence = 30;
        parsed.confidence = Math.min(parsed.confidence, 40);
        parsed.why = `(Lyrics-only guess — audio recognition unavailable, so this may be wrong.) ${
          parsed.why || ""
        }`.trim();
        return NextResponse.json(parsed);
      }
    } catch (err) {
      console.error("[/api/identify] LLM fallback error:", err);
    }
  }

  return NextResponse.json({
    error: true,
    suggestion: audioBlob
      ? "I couldn't find a match for that audio. Try singing the lyrics out loud instead of humming, or hum a more recognizable part of the melody."
      : "I couldn't identify that one. Try singing a few of the lyrics out loud.",
  });
}
