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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HummingbirdLogo } from "@/components/hummingbird-logo";
import { MicButton } from "@/components/mic-button";
import { LoadingDots } from "@/components/loading-dots";
import { ResultCard } from "@/components/result-card";
import { SettingsMenu } from "@/components/settings-menu";
import { TermsGate } from "@/components/terms-gate";
import { useSpeechRecognition } from "@/lib/speech";
import type { SongResult } from "@/lib/types";

type AppState = "idle" | "listening" | "thinking" | "result" | "error";

export default function Home() {
  const [state, setState] = React.useState<AppState>("idle");
  const [result, setResult] = React.useState<SongResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [submittedText, setSubmittedText] = React.useState("");

  const identify = React.useCallback(async (description: string) => {
    const clean = description.trim();
    if (!clean) {
      // Nothing was captured — guide the user instead of silently failing.
      setErrorMsg(
        "I didn't catch any words. Tap the mic and sing the lyrics, or describe the song out loud — humming alone doesn't give me words to search."
      );
      setState("error");
      return;
    }
    setSubmittedText(clean.length > 140 ? clean.slice(0, 140) + "…" : clean);
    setState("thinking");
    setResult(null);
    setErrorMsg("");
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: clean }),
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
  }, []);

  const handleVoiceEnd = React.useCallback(
    (finalTranscript: string) => {
      identify(finalTranscript);
    },
    [identify]
  );

  const handleVoiceError = React.useCallback((error: string) => {
    setState("idle");
    if (error === "not-allowed" || error === "service-not-allowed") {
      toast.error("Microphone access was blocked. Allow mic permission and try again.");
    } else if (error !== "no-speech" && error !== "aborted") {
      toast.error("Voice input hit a snag. Try again.");
    }
  }, []);

  const { supported, listening, transcript, start, stop } = useSpeechRecognition({
    onEnd: handleVoiceEnd,
    onError: handleVoiceError,
  });

  const toggleMic = React.useCallback(() => {
    if (listening) {
      stop();
    } else {
      setState("listening");
      start();
    }
  }, [listening, start, stop]);

  const reset = React.useCallback(() => {
    setState("idle");
    setResult(null);
    setErrorMsg("");
    setSubmittedText("");
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
            <ListeningState transcript={transcript} onStop={toggleMic} />
          )}

          {state === "thinking" && (
            <ThinkingState submittedText={submittedText} />
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
          <p className="text-xs text-muted-foreground -mt-2">
            Tap to hum, sing, or say the lyrics
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
        Your voice is transcribed on your device. Only the words are sent to our
        AI. We don&apos;t store them.
      </p>
    </div>
  );
}

/* ---------------- Listening ---------------- */

function ListeningState({
  transcript,
  onStop,
}: {
  transcript: string;
  onStop: () => void;
}) {
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <MicButton listening onToggle={onStop} />

      {/* Waveform */}
      <div className="flex items-end gap-1 h-6" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-red-500 animate-hum-bar"
            style={{ height: "100%", animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>

      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <AudioLines className="size-3.5 text-red-500" />
        Listening… tap again to send
      </p>

      {/* Live transcript */}
      <div className="w-full max-w-sm min-h-[3.5rem] rounded-lg border bg-muted/40 p-3">
        {transcript ? (
          <p className="text-sm leading-relaxed">{transcript}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Sing the lyrics, or describe the song out loud…
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

function ThinkingState({ submittedText }: { submittedText: string }) {
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <LoadingDots label="Searching for your song" />
      {submittedText && (
        <p className="max-w-sm text-center text-xs text-muted-foreground/80">
          <span className="text-foreground/70">
            &ldquo;{submittedText}&rdquo;
          </span>
        </p>
      )}
      <p className="text-[11px] text-muted-foreground/60">
        Searching the web + reasoning over lyrics… this can take a few seconds.
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
