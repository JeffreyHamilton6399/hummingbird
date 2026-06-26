"use client";

import * as React from "react";
import { Mic, Search, ShieldCheck, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "hummingbird:accepted-v1";

export function TermsGate() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const accepted = localStorage.getItem(STORAGE_KEY);
      if (!accepted) setOpen(true);
    } catch {
      // localStorage unavailable; don't block the user
    }
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-emerald-500">
              <Mic className="size-4" />
            </span>
            How Hummingbird works
          </DialogTitle>
          <DialogDescription className="text-left">
            Hum, sing, or describe a song you half-remember. Hummingbird transcribes your
            voice in your browser, then asks an AI to name the tune.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <EyeOff className="size-4 shrink-0 text-emerald-500 mt-0.5" />
            <span>
              <span className="font-medium">Audio stays local.</span> Your mic is transcribed
              in your browser. We never receive or store audio.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Search className="size-4 shrink-0 text-emerald-500 mt-0.5" />
            <span>
              <span className="font-medium">Your text description is sent to our AI</span> to
              identify the song via web search + reasoning. We don&apos;t store it.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="size-4 shrink-0 text-emerald-500 mt-0.5" />
            <span>
              <span className="font-medium">No accounts, no tracking.</span> Just the song.
            </span>
          </li>
        </ul>

        <DialogFooter>
          <Button onClick={accept} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
            Got it — let&apos;s find that song
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function openTermsGate() {
  try {
    localStorage.removeItem("hummingbird:accepted-v1");
  } catch {
    // ignore
  }
  // Reload to re-trigger the gate effect.
  if (typeof window !== "undefined") window.location.reload();
}
