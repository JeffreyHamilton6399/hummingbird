/**
 * AudD audio recognition — the "Shazam" approach.
 *
 * Records actual audio in the browser and sends it to AudD's API, which
 * matches the audio fingerprint against a database of millions of songs.
 * Works with humming, singing, or the original recording.
 *
 *  - Free tier: 10 requests/day, no credit card (just email)
 *  - Sign up at https://dashboard.audd.io/
 *  - Returns real song data: title, artist, album, streaming links
 *
 * Set AUDD_API_TOKEN in your environment (.env or Vercel).
 */

const AUDD_URL = "https://api.audd.io/";

export interface AudDResult {
  title: string;
  artist: string;
  album?: string;
  release_date?: string;
  lyrics?: string;
  song_link?: string;
  apple_music?: { url?: string };
  spotify?: { url?: string; uri?: string };
}

/**
 * Send an audio blob (webm/opus from MediaRecorder) to AudD for recognition.
 * Returns the matched song, or null if no match.
 */
export async function recognizeAudio(
  audioBlob: Blob,
  timeoutMs = 30000
): Promise<AudDResult | null> {
  const apiToken = process.env.AUDD_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "AUDD_API_TOKEN is not set. Get a free one at https://dashboard.audd.io/"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append("api_token", apiToken);
    // CRITICAL: AudD expects the field name "file", NOT "audio".
    formData.append("file", audioBlob, "recording.webm");
    formData.append("return", "apple_music,spotify,lyrics");

    const res = await fetch(AUDD_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      let msg = `AudD API error (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        msg = parsed?.error?.error_message || msg;
      } catch {
        msg = `${msg}: ${body.slice(0, 200)}`;
      }
      throw new Error(msg);
    }

    const data = await res.json();
    // AudD returns { status: "success", result: {...} } or { result: null }
    if (data?.result) {
      return data.result as AudDResult;
    }
    return null; // no match found
  } finally {
    clearTimeout(timer);
  }
}
