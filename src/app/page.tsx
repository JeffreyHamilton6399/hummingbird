"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Heart,
  AlertTriangle,
  Lock,
  AudioLines,
  MicOff,
  Music4,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HummingbirdLogo } from "@/components/hummingbird-logo";
import { MicButton } from "@/components/mic-button";
import { LoadingDots } from "@/components/loading-dots";
import { ResultCard } from "@/components/result-card";
import { SettingsMenu } from "@/components/settings-menu";
import { TermsGate } from "@/components/terms-gate";
import { useHummingCapture, type MelodyContour } from "@/lib/audio-capture";
import type { SongResult } from "@/lib/types";

type AppState = "idle" | "listening" | "thinking" | "result" | "error";

export default function Home() {
  const [state, setState] = React.useState<AppState>("idle");
  const [result, setResult] = React.useState<SongResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [submittedLabel, setSubmittedLabel] = React.useState("");

  const identify = React.useCallback(
    async (
      transcript: string,
      melody: MelodyContour | null,
      heard: boolean
    ) => {
      const words = transcript.trim();
      const melodyDesc = melody?.description ?? "";

      if (!words && !melodyDesc) {
        // Distinguish "silent / mic off" from "heard you but couldn't track".
        if (heard) {
          setErrorMsg(
            "I could hear you, but didn't catch any words or melody. Singing even a few of the lyrics out loud works best — you don't need to be on key. Otherwise, hum a steady tune clearly."
          );
        } else {
          setErrorMsg(
            "I didn't catch any sound. Make sure your mic is on and allowed, then sing some lyrics or hum the tune."
          );
        }
        setState("error");
        return;
      }

      // Build a short label for the thinking state.
      if (words && melodyDesc) {
        setSubmittedLabel(
          `“${words.length > 80 ? words.slice(0, 80) + "…" : words}” + hummed melody`
        );
      } else if (words) {
        setSubmittedLabel(
          `“${words.length > 100 ? words.slice(0, 100) + "…" : words}”`
        );
      } else {
        setSubmittedLabel(`Hummed melody: ${melody?.shape ?? "melody"}`);
      }

      setState("thinking");
      setResult(null);
      setErrorMsg("");

      try {
        const body: Record<string, string> = {};
        if (words) body.description = words;
        if (melodyDesc) body.melody = melodyDesc;

        const res = await fetch("/api/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as SongResult;
        if (data.error) {
          setErrorMsg(
            data.suggestion ||
              "Try singing the lyrics, or mention the genre, decade, or the singer's voice."
          );
          setState("error");
          return;
        }
        setResult(data);
        setState("result");
      } catch {
        setErrorMsg("Network hiccup — please try again in a moment.");
        setState("error");
      }
    },
    []
  );

  const handleCaptureEnd = React.useCallback(
    (captured: {
      transcript: string;
      melody: MelodyContour | null;
      heard: boolean;
    }) => {
      identify(captured.transcript, captured.melody, captured.heard);
    },
    [identify]
  );

  const handleCaptureError = React.useCallback((error: string) => {
    setState("idle");
    if (error === "not-allowed" || error === "service-not-allowed" || error === "mic-denied") {
      toast.error("Microphone access was blocked. Allow mic permission and try again.");
    } else if (error === "unsupported") {
      toast.error("Voice input isn't supported in this browser. Try Chrome, Edge, or Safari.");
    }
  }, []);

  const {
    supported,
    listening,
    transcript,
    level,
    hasMelody,
    heard,
    currentNote,
    start,
    stop,
  } = useHummingCapture({
    onEnd: handleCaptureEnd,
    onError: handleCaptureError,
  });

  const toggleMic = React.useCallback(() => {
    if (listening) {
      stop();
    } else {
      setState("listening");
      void start();
    }
  }, [listening, start, stop]);

  const reset = React.useCallback(() => {
    setState("idle");
    setResult(null);
    setErrorMsg("");
    setSubmittedLabel("");
  }, []);

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center justify-between px-3 sm:px-4 border-b">
        <div className="flex items-center gap-2">
          <HummingbirdLogo className="size-6" />
          <span className="font-semibold tracking-tight text-[15px]">Hummingbird</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 rounded-full text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 px-2.5"
          >
            <a
              href="https://buymeacoffee.com/jeffreyscof"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Heart className="size-3.5" />
              <span className="hidden sm:inline">Donate</span>
            </a>
          </Button>
          <SettingsMenu />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto hum-scroll">
        <div className="mx-auto w-full max-w-xl px-4 py-6 min-h-full flex flex-col items-center justify-center">
          {state === "idle" && (
            <IdleState micSupported={supported} onToggleMic={toggleMic} />
          )}

          {state === "listening" && (
            <ListeningState
              transcript={transcript}
              level={level}
              hasMelody={hasMelody}
              heard={heard}
              currentNote={currentNote}
              onStop={toggleMic}
            />
          )}

          {state === "thinking" && (
            <ThinkingState submittedLabel={submittedLabel} />
          )}

          {state === "result" && result && (
            <ResultCard result={result} onRetry={reset} />
          )}

          {state === "error" && (
            <ErrorState message={errorMsg} onRetry={reset} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="h-8 shrink-0 flex items-center justify-center px-4 border-t text-[11px] text-muted-foreground/80">
        V1 · Jeffrey Hamilton
      </footer>

      <TermsGate />
    </div>
  );
}

/* ---------------- Idle ---------------- */

function IdleState({
  micSupported,
  onToggleMic,
}: {
  micSupported: boolean;
  onToggleMic: () => void;
}) {
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <p className="text-sm text-muted-foreground text-center">
        What&apos;s that song in your head?
      </p>

      {micSupported ? (
        <>
          <MicButton listening={false} onToggle={onToggleMic} />
          <p className="text-xs text-muted-foreground -mt-2 text-center">
            Tap to <span className="font-medium text-foreground/80">sing the lyrics</span> or hum the tune
          </p>
          <p className="text-[11px] text-muted-foreground/60 max-w-xs text-center -mt-1">
            Singing even a few words works best — you don&apos;t need to be on key.
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <MicOff className="size-7" />
          </div>
          <p className="text-xs text-muted-foreground max-w-xs">
            Voice input isn&apos;t supported in this browser. Try Chrome, Edge,
            or Safari.
          </p>
        </div>
      )}

      <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70 max-w-xs text-center">
        <Lock className="size-3 shrink-0" />
        Your voice is transcribed on your device. Only the words and melody
        shape are sent to our AI. We don&apos;t store them.
      </p>
    </div>
  );
}

/* ---------------- Listening ---------------- */

function ListeningState({
  transcript,
  level,
  hasMelody,
  heard,
  currentNote,
  onStop,
}: {
  transcript: string;
  level: number;
  hasMelody: boolean;
  heard: boolean;
  currentNote: string;
  onStop: () => void;
}) {
  // Bars react to live input level; CSS animation adds liveliness on top.
  const bars = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <MicButton listening onToggle={onStop} />

      {/* Live waveform — reacts to actual mic input */}
      <div className="flex items-end gap-1 h-6" aria-hidden>
        {bars.map((i) => {
          const base = 0.25 + level * 0.75;
          const variance = 0.4 + 0.6 * Math.sin(i * 1.3);
          const h = Math.max(0.15, Math.min(1, base * variance));
          return (
            <span
              key={i}
              className="w-1 rounded-full bg-red-500 animate-hum-bar"
              style={{
                height: `${h * 100}%`,
                animationDelay: `${i * 0.1}s`,
                opacity: 0.5 + level * 0.5,
              }}
            />
          );
        })}
      </div>

      {/* Live pitch indicator */}
      <div className="flex items-center gap-2 text-xs h-5">
        {currentNote ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
            <Music4 className="size-3" /> {currentNote}
          </span>
        ) : heard ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AudioLines className="size-3" /> I can hear you — hum a steady note
          </span>
        ) : (
          <span className="text-muted-foreground/60">waiting for sound…</span>
        )}
        {hasMelody && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
            ✓ melody tracked
          </span>
        )}
        {transcript && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            ✓ words captured
          </span>
        )}
      </div>

      {/* Live transcript / hint */}
      <div className="w-full max-w-sm min-h-[3.5rem] rounded-lg border bg-muted/40 p-3">
        {transcript ? (
          <p className="text-sm leading-relaxed">{transcript}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Sing a few of the lyrics out loud — even rough words help a lot…
          </p>
        )}
      </div>

      <Button variant="outline" size="sm" className="rounded-full" onClick={onStop}>
        Stop &amp; identify
      </Button>
    </div>
  );
}

/* ---------------- Thinking ---------------- */

function ThinkingState({ submittedLabel }: { submittedLabel: string }) {
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <LoadingDots label="Searching for your song" />
      {submittedLabel && (
        <p className="max-w-sm text-center text-xs text-muted-foreground/80">
          <span className="text-foreground/70">{submittedLabel}</span>
        </p>
      )}
      <p className="text-[11px] text-muted-foreground/60">
        Searching the web + reasoning over lyrics &amp; melody… this can take a
        few seconds.
      </p>
    </div>
  );
}

/* ---------------- Error ---------------- */

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-sm flex flex-col items-center gap-3 animate-hum-fade-in">
      <div className="size-11 rounded-full bg-rose-500/10 flex items-center justify-center">
        <AlertTriangle className="size-5 text-rose-500" />
      </div>
      <h2 className="text-base font-semibold text-center">
        Hmm, I couldn&apos;t figure that one out.
      </h2>
      <p className="text-sm text-muted-foreground text-center">{message}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-1 rounded-full"
        onClick={onRetry}
      >
        <RefreshCw className="size-3.5" />
        Try again
      </Button>
    </div>
  );
}
