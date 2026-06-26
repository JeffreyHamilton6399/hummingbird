"use client";

import * as React from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface MicButtonProps {
  listening: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  className?: string;
}

/**
 * Big tactile mic button. Hold-to-record (pointer down/up) with tap support.
 * Emerald when idle, red + pulsing when listening.
 */
export function MicButton({
  listening,
  disabled,
  onStart,
  onStop,
  className,
}: MicButtonProps) {
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled || listening) return;
    onStart();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!listening) return;
    onStop();
  };

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Pulse rings while listening */}
      {listening && (
        <>
          <span
            className="absolute inset-0 rounded-full bg-red-500/30 animate-hum-ring"
            aria-hidden
          />
          <span
            className="absolute inset-0 rounded-full bg-red-500/20 animate-hum-ring"
            style={{ animationDelay: "0.6s" }}
            aria-hidden
          />
        </>
      )}
      <button
        type="button"
        aria-label={listening ? "Stop recording" : "Hold to hum, sing, or describe"}
        aria-pressed={listening}
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          "relative size-20 rounded-full flex items-center justify-center text-white shadow-lg transition-transform select-none touch-none",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/30",
          "active:scale-95",
          listening
            ? "bg-red-500 shadow-red-500/30 animate-hum-pulse"
            : "bg-emerald-500 shadow-emerald-500/30 hover:bg-emerald-600"
        )}
      >
        {listening ? (
          <Square className="size-7 fill-white" />
        ) : (
          <Mic className="size-8" />
        )}
      </button>
    </div>
  );
}
