"use client";

import * as React from "react";

/* ================================================================
 * SpeechRecognition typings (for live transcript of sung words)
 * ================================================================ */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/* ================================================================
 * Combined capture hook: audio recording (MediaRecorder) + speech
 * recognition (live transcript of sung words).
 *
 * Records actual audio for AudD fingerprinting, while also transcribing
 * sung lyrics as a fallback signal.
 * ================================================================ */

interface UseHummingCaptureOptions {
  onEnd?: (result: {
    audioBlob: Blob | null;
    transcript: string;
    heard: boolean;
  }) => void;
  onError?: (error: string) => void;
}

export function useHummingCapture(options: UseHummingCaptureOptions = {}) {
  const { onEnd, onError } = options;

  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [level, setLevel] = React.useState(0);
  const [heard, setHeard] = React.useState(false);

  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const transcriptRef = React.useRef("");
  const heardRef = React.useRef(false);
  const startTimeRef = React.useRef(0);
  const finishedRef = React.useRef(false);
  const onEndRef = React.useRef(onEnd);
  const onErrorRef = React.useRef(onError);

  React.useEffect(() => {
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  });

  const cleanup = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    const hasGUM =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined";
    setSupported(hasGUM);
    return () => cleanup();
  }, [cleanup]);

  const finishRef = React.useRef<() => void>(() => {});

  const finish = React.useCallback(() => {
    if (finishedRef.current) return;

    // Minimum 1.5s recording so AudD has enough audio to fingerprint.
    const elapsed = performance.now() - startTimeRef.current;
    if (elapsed < 1500) {
      window.setTimeout(() => finishRef.current(), 1500 - elapsed);
      return;
    }

    finishedRef.current = true;

    // Stop the MediaRecorder and assemble the audio blob.
    const recorder = mediaRecorderRef.current;
    const chunks = chunksRef.current;
    const finalTranscript = transcriptRef.current.trim();
    const finalHeard = heardRef.current || finalTranscript.length > 0;

    const done = (audioBlob: Blob | null) => {
      cleanup();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      setListening(false);
      onEndRef.current?.({
        audioBlob,
        transcript: finalTranscript,
        heard: finalHeard,
      });
    };

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        done(blob.size > 100 ? blob : null);
      };
      try {
        recorder.stop();
      } catch {
        done(null);
      }
    } else {
      done(null);
    }
  }, [cleanup]);

  React.useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = React.useCallback(async () => {
    // Reset state
    transcriptRef.current = "";
    chunksRef.current = [];
    heardRef.current = false;
    finishedRef.current = false;
    setTranscript("");
    setLevel(0);
    setHeard(false);
    startTimeRef.current = performance.now();
    setListening(true);

    // --- Speech recognition (best-effort, for live transcript of sung words) ---
    const SR =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;
    if (SR) {
      try {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.maxAlternatives = 1;
        rec.onresult = (event: SpeechRecognitionEvent) => {
          let text = "";
          for (let i = 0; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          transcriptRef.current = text;
          setTranscript(text);
          if (text.trim() && !heardRef.current) {
            heardRef.current = true;
            setHeard(true);
          }
        };
        rec.onerror = (event: SpeechRecognitionErrorEvent) => {
          if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
          ) {
            onErrorRef.current?.(event.error);
          }
        };
        rec.onend = () => {
          // SR ended — do NOT stop the recording (user controls that).
        };
        recognitionRef.current = rec;
        rec.start();
      } catch {
        // SR failed to start; audio recording can still work.
      }
    }

    // --- Audio recording via getUserMedia + MediaRecorder ---
    // CRITICAL: create AudioContext BEFORE any await (user-gesture context).
    const AC =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    let ctx: AudioContext | null = null;
    if (AC) {
      try {
        ctx = new AC();
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        ctx = null;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // MediaRecorder for actual audio capture (sent to AudD)
      let recorder: MediaRecorder | null = null;
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch {
        // MediaRecorder unavailable — fall back to transcript-only.
      }

      // Analyser for live input level (waveform visualization)
      if (ctx) {
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            // ignore
          }
        }
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buf = new Float32Array(analyser.fftSize);
        pollRef.current = setInterval(() => {
          if (finishedRef.current) return;
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          setLevel(Math.min(1, rms * 6));
          if (rms > 0.002 && !heardRef.current) {
            heardRef.current = true;
            setHeard(true);
          }
        }, 50);
      }
    } catch (err) {
      if (ctx) {
        try {
          void ctx.close();
        } catch {
          // ignore
        }
      }
      setListening(false);
      onErrorRef.current?.("mic-denied");
    }
  }, []);

  const stop = React.useCallback(() => {
    finish();
  }, [finish]);

  const reset = React.useCallback(() => {
    transcriptRef.current = "";
    chunksRef.current = [];
    heardRef.current = false;
    setTranscript("");
    setLevel(0);
    setHeard(false);
  }, []);

  return { supported, listening, transcript, level, heard, start, stop, reset };
}
