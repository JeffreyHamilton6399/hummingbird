"use client";

import * as React from "react";
import {
  Youtube,
  Music2,
  Music,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  HelpCircle,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type SongResult,
  type SongAlternative,
  confidenceTier,
  confidenceLabel,
} from "@/lib/types";

function buildLinks(title: string, artist: string) {
  const q = encodeURIComponent(`${title} ${artist}`);
  return {
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    apple: `https://music.apple.com/us/search?term=${q}`,
  };
}

function tierColor(tier: "strong" | "possible" | "weak") {
  if (tier === "strong") return "text-emerald-600 dark:text-emerald-400";
  if (tier === "possible") return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function tierBar(tier: "strong" | "possible" | "weak") {
  if (tier === "strong") return "bg-emerald-500";
  if (tier === "possible") return "bg-amber-500";
  return "bg-rose-500";
}

function SongLinks({
  title,
  artist,
  compact = false,
}: {
  title: string;
  artist: string;
  compact?: boolean;
}) {
  const links = buildLinks(title, artist);
  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
      <Button asChild variant="outline" size={compact ? "sm" : "sm"} className="h-8 rounded-full">
        <a href={links.youtube} target="_blank" rel="noopener noreferrer">
          <Youtube className="size-3.5 text-red-500" />
          <span>YouTube</span>
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
        <a href={links.spotify} target="_blank" rel="noopener noreferrer">
          <Music2 className="size-3.5 text-emerald-500" />
          <span>Spotify</span>
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
        <a href={links.apple} target="_blank" rel="noopener noreferrer">
          <Music className="size-3.5 text-rose-400" />
          <span>Apple Music</span>
        </a>
      </Button>
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const tier = confidenceTier(confidence);
  return (
    <div
      className="h-1.5 w-full rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(confidence)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-all", tierBar(tier))}
        style={{ width: `${Math.max(6, Math.min(100, confidence))}%` }}
      />
    </div>
  );
}

function GuessRow({
  index,
  item,
}: {
  index: number;
  item: SongAlternative;
}) {
  return (
    <li className="rounded-lg border bg-card p-3 animate-hum-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
              {index}.
            </span>
            <p className="font-medium truncate">
              {item.title}
              <span className="text-muted-foreground"> — {item.artist}</span>
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2 pl-5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.round(item.confidence)}%
            </span>
            <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full", tierBar(confidenceTier(item.confidence)))}
                style={{ width: `${Math.max(6, Math.min(100, item.confidence))}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 pl-5">
        <SongLinks title={item.title} artist={item.artist} compact />
      </div>
    </li>
  );
}

export function ResultCard({
  result,
  onRetry,
}: {
  result: SongResult;
  onRetry: () => void;
}) {
  const tier = confidenceTier(result.confidence);
  const strong = tier === "strong";
  const hasAlts = Array.isArray(result.alternatives) && result.alternatives.length > 0;
  const guesses: SongAlternative[] = [
    {
      title: result.title,
      artist: result.artist,
      year: result.year,
      confidence: result.confidence,
    },
    ...(result.alternatives ?? []),
  ];

  return (
    <div className="w-full max-w-xl mx-auto animate-hum-fade-in">
      {strong ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          {/* Confidence header */}
          <div className="flex items-center gap-2">
            <CheckCircle2 className={cn("size-5", tierColor(tier))} />
            <span className={cn("text-sm font-semibold", tierColor(tier))}>
              {confidenceLabel(result.confidence)}
            </span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {Math.round(result.confidence)}%
            </span>
          </div>
          <div className="mt-2">
            <ConfidenceBar confidence={result.confidence} />
          </div>

          {/* Title + artist */}
          <h2 className="mt-4 text-2xl font-bold tracking-tight">{result.title}</h2>
          <p className="text-muted-foreground">
            {result.artist}
            {result.year ? (
              <span className="text-muted-foreground/70"> ({result.year})</span>
            ) : null}
          </p>

          {/* Why */}
          {result.why && (
            <div className="mt-4 rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Why this match
              </p>
              <p className="mt-1 text-sm leading-relaxed">{result.why}</p>
            </div>
          )}

          {/* Lyrics snippet */}
          {result.lyrics_snippet && (
            <div className="mt-3 flex gap-2 rounded-lg border-l-2 border-emerald-500 bg-muted/30 px-3 py-2">
              <Quote className="size-4 shrink-0 text-emerald-500 mt-0.5" />
              <p className="text-sm italic text-foreground/90">{result.lyrics_snippet}</p>
            </div>
          )}

          {/* Links */}
          <div className="mt-4">
            <SongLinks title={result.title} artist={result.artist} />
          </div>

          {/* Alternatives */}
          {hasAlts && (
            <div className="mt-5 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Other possibilities
              </p>
              <ul className="space-y-2">
                {(result.alternatives ?? []).slice(0, 3).map((alt, i) => (
                  <GuessRow key={i} index={i + 1} item={alt} />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <HelpCircle className={cn("size-5", tierColor(tier))} />
            <span className={cn("text-sm font-semibold", tierColor(tier))}>
              Not 100% sure, but here are my best guesses
            </span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {guesses.map((g, i) => (
              <GuessRow key={i} index={i + 1} item={g} />
            ))}
          </ul>
          {result.lyrics_snippet && (
            <div className="mt-4 flex gap-2 rounded-lg border-l-2 border-amber-500 bg-muted/30 px-3 py-2">
              <Quote className="size-4 shrink-0 text-amber-500 mt-0.5" />
              <p className="text-sm italic text-foreground/90">{result.lyrics_snippet}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-center">
        <Button variant="ghost" size="sm" className="rounded-full" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Not it? Try again
        </Button>
      </div>

      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted-foreground/70">
        <ExternalLink className="size-3" />
        Links open a search — pick the right track there.
      </p>
    </div>
  );
}
