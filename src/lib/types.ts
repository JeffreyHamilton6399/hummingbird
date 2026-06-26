export interface SongAlternative {
  title: string;
  artist: string;
  year?: number;
  confidence: number; // 0-100
}

export interface SongResult {
  title: string;
  artist: string;
  year?: number;
  confidence: number; // 0-100
  why: string;
  lyrics_snippet?: string;
  alternatives?: SongAlternative[];
  error?: boolean;
  suggestion?: string;
}

export type ConfidenceTier = "strong" | "possible" | "weak";

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 70) return "strong";
  if (confidence >= 40) return "possible";
  return "weak";
}

export function confidenceLabel(confidence: number): string {
  const tier = confidenceTier(confidence);
  if (tier === "strong") return "Strong match";
  if (tier === "possible") return "Possible match";
  return "Not sure, but maybe...";
}
