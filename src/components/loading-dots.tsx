import * as React from "react";
import { cn } from "@/lib/utils";

export function LoadingDots({
  className,
  label = "Searching for your song",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="flex items-end gap-1.5 h-8" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-emerald-500 animate-hum-bar"
            style={{
              height: "100%",
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground flex items-center gap-1">
        <span>{label}</span>
        <span className="inline-flex gap-0.5" aria-hidden>
          <span className="w-1 h-1 rounded-full bg-muted-foreground animate-hum-dot" />
          <span
            className="w-1 h-1 rounded-full bg-muted-foreground animate-hum-dot"
            style={{ animationDelay: "0.2s" }}
          />
          <span
            className="w-1 h-1 rounded-full bg-muted-foreground animate-hum-dot"
            style={{ animationDelay: "0.4s" }}
          />
        </span>
      </p>
    </div>
  );
}
