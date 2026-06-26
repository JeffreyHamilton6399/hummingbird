"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Search,
  RefreshCw,
  Mic,
  Heart,
  AlertTriangle,
  Lock,
  Keyboard,
  AudioLines,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HummingbirdLogo } from "@/components/hummingbird-logo";
import { MicButton } from "@/components/mic-button";
import { LoadingDots } from "@/components/loading-dots";
import { ResultCard } from "@/components/result-card";
import { SettingsMenu } from "@/components/settings-menu";
import { TermsGate, openTermsGate } from "@/components/terms-gate";
import { useSpeechRecognition } from "@/lib/speech";
import type { SongResult } from "@/lib/types";

type AppState = "idle" | "listening" | "thinking" | "result" | "error";

export default function Home() {
  const [state, setState] = React.useState<AppState>("idle");
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<SongResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [submittedText, setSubmittedText] = React.useState("");

  const identify = React.useCallback(async (description: string) => {
    const clean = description.trim();
    if (!clean) {
      setState("idle");
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
            "Try being more specific — mention lyrics, genre, decade, or the singer's gender."
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
      const t = finalTranscript.trim();
      if (!t) {
        setState("idle");
        return;
      }
      identify(t);
    },
    [identify]
  );

  const handleVoiceError = React.useCallback((error: string) => {
    setState("idle");
    if (error === "not-allowed" || error === "service-not-allowed") {
      toast.error("Microphone access was blocked. Type your description instead.");
    } else if (error !== "no-speech" && error !== "aborted") {
      toast.error("Voice input hit a snag. Try typing instead.");
    }
  }, []);

  const { supported, listening, transcript, start, stop } = useSpeechRecognition({
    onEnd: handleVoiceEnd,
    onError: handleVoiceError,
  });

  const startListening = React.useCallback(() => {
    setText("");
    setState("listening");
    start();
  }, [start]);

  const stopListening = React.useCallback(() => {
    stop();
  }, [stop]);

  const submitText = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    identify(t);
  };

  const reset = React.useCallback(() => {
    setState("idle");
    setResult(null);
    setErrorMsg("");
    setText("");
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
          <Button asChild variant="ghost" size="sm" className="h-7 rounded-full text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 px-2.5">
            <a
              href="https://buymeacoffee.com/jeffreyscof"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Heart className="size-3.5" />
              <span className="hidden sm:inline">Donate</span>
            </a>
          </Button>
          <SettingsMenu onOpenPrivacy={openTermsGate} />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto hum-scroll">
        <div className="mx-auto w-full max-w-xl px-4 py-6 min-h-full flex flex-col items-center justify-center">
          {state === "idle" && (
            <IdleState
              micSupported={supported}
              listening={listening}
              text={text}
              setText={setText}
              onSubmitText={submitText}
              onStartListening={startListening}
              onStopListening={stopListening}
            />
          )}

          {state === "listening" && (
            <ListeningState
              transcript={transcript}
              onStop={stopListening}
            />
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
  listening,
  text,
  setText,
  onSubmitText,
  onStartListening,
  onStopListening,
}: {
  micSupported: boolean;
  listening: boolean;
  text: string;
  setText: (v: string) => void;
  onSubmitText: (e: React.FormEvent) => void;
  onStartListening: () => void;
  onStopListening: () => void;
}) {
  return (
    <div className="w-full flex flex-col items-center gap-5 animate-hum-fade-in">
      <p className="text-sm text-muted-foreground text-center">
        What&apos;s that song in your head?
      </p>

      {micSupported ? (
        <>
          <MicButton
            listening={listening}
            onStart={onStartListening}
            onStop={onStopListening}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Hold to hum, sing, or describe
          </p>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <Mic className="size-7" />
          </div>
          <p className="text-xs text-muted-foreground max-w-xs">
            Voice input isn&apos;t supported in this browser. Type your description below.
          </p>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 w-full max-w-sm my-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          or type it instead
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Text input */}
      <form onSubmit={onSubmitText} className="w-full max-w-sm flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the song…"
            aria-label="Describe the song"
            className="h-11 rounded-full bg-muted/50 border-transparent focus-visible:bg-background focus-visible:border-emerald-500/50"
            maxLength={500}
          />
          <Button
            type="submit"
            disabled={!text.trim()}
            className="h-11 rounded-full px-4 bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Identify</span>
          </Button>
        </div>
        <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground/70">
          <Lock className="size-3" />
          Your description is sent to our AI to identify the song. We don&apos;t store it.
        </p>
      </form>
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
      <MicButton listening onStop={onStop} onStart={() => {}} />

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
        Listening… release to send
      </p>

      {/* Live transcript */}
      <div className="w-full max-w-sm min-h-[3.5rem] rounded-lg border bg-muted/40 p-3">
        {transcript ? (
          <p className="text-sm leading-relaxed">{transcript}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Start humming, singing, or describing the song…
          </p>
        )}
      </div>

      <Button variant="outline" size="sm" className="rounded-full" onClick={onStop}>
        Stop
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
          <span className="text-foreground/70">&ldquo;{submittedText}&rdquo;</span>
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
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/70">
        <Keyboard className="size-3" />
        Mention a lyric, the genre, the decade, or the singer&apos;s gender.
      </div>
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
