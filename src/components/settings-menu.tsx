"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  Settings,
  Sun,
  Moon,
  Shield,
  FileText,
  Github,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

function LegalDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="space-y-3 text-sm leading-relaxed text-foreground/80">
            {children}
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsMenu() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [privacyOpen, setPrivacyOpen] = React.useState(false);
  const [termsOpen, setTermsOpen] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const toggleLabel = isDark ? "Light mode" : "Dark mode";

  const handleThemeToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={handleThemeToggle}>
            {isDark ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
            {toggleLabel}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Legal
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setPrivacyOpen(true)}>
            <Shield className="size-3.5" />
            Privacy Policy
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTermsOpen(true)}>
            <FileText className="size-3.5" />
            Terms of Service
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <a
              href="https://github.com/JeffreyHamilton6399"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <Github className="size-3.5" />
              GitHub
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LegalDialog
        open={privacyOpen}
        onOpenChange={setPrivacyOpen}
        title="Privacy Policy"
      >
        <p>
          <span className="font-medium text-foreground">Audio stays on your device.</span>{" "}
          Your microphone is transcribed in your browser using the Web Speech
          API. We never receive, transmit, or store audio.
        </p>
        <p>
          <span className="font-medium text-foreground">The transcribed words are sent to our AI</span>{" "}
          to identify the song via web search and language-model reasoning. We
          do not store your description.
        </p>
        <p>
          <span className="font-medium text-foreground">No accounts, no tracking, no analytics.</span>{" "}
          We use <code className="text-xs">localStorage</code> only to remember
          your theme and that you&apos;ve seen this notice.
        </p>
        <p className="text-xs text-muted-foreground">
          Song identifications are AI-generated and may be incorrect. Always
          verify via the provided links.
        </p>
      </LegalDialog>

      <LegalDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        title="Terms of Service"
      >
        <p>
          Hummingbird is a free, hobby project provided &ldquo;as is&rdquo;,
          without warranty of any kind.
        </p>
        <p>
          Song identifications are AI-generated and may be wrong. Always verify
          via the provided YouTube, Spotify, and Apple Music links.
        </p>
        <p>
          Please don&apos;t abuse the service or attempt to overload it.
        </p>
        <p>
          Result links open third-party searches; those platforms&apos; terms
          of service apply.
        </p>
      </LegalDialog>
    </>
  );
}
