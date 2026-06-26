"use client";

import * as React from "react";

/* ================================================================
 * SpeechRecognition typings (minimal — matches lib.dom where present)
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
  onstart: (() => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}

/* ================================================================
 * Pitch detection via normalized autocorrelation (ACF)
 *
 * Improvements over naive ACF:
 *  - Properly normalized correlation → clarity is a real [0,1] value
 *  - First-peak-after-descent detection → avoids octave-down errors
 *  - Parabolic interpolation → sub-sample lag precision
 *  - Low, permissive thresholds tuned for real human humming
 * ================================================================ */

const MIN_FREQ = 65; // Hz — low male hum
const MAX_FREQ = 600; // Hz — high female / whistle-ish hum
const CLARITY_THRESHOLD = 0.45; // lowered: real humming typically scores 0.4–0.7
const RMS_THRESHOLD = 0.0025; // lowered silence gate

function detectPitch(
  buf: Float32Array,
  sampleRate: number
): { freq: number; clarity: number; rms: number } {
  const SIZE = buf.length;

  // RMS silence gate
  let sumSq = 0;
  for (let i = 0; i < SIZE; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / SIZE);
  if (rms < RMS_THRESHOLD) return { freq: -1, clarity: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxLag = Math.min(SIZE - 2, Math.floor(sampleRate / MIN_FREQ));

  // Average (not sum) autocorrelation so normalization is stable regardless
  // of buffer size. acf[0] is the average energy.
  const acf = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let corr = 0;
    const limit = SIZE - lag;
    for (let i = 0; i < limit; i++) {
      corr += buf[i] * buf[i + lag];
    }
    acf[lag] = corr / (limit || 1);
  }

  // Skip the lag-0 peak: find the first local minimum after the initial
  // descent, then search for the highest peak after that minimum within range.
  let firstMinLag = 1;
  while (firstMinLag < maxLag - 1 && acf[firstMinLag] > acf[firstMinLag + 1]) {
    firstMinLag++;
  }

  let bestLag = -1;
  let bestVal = 0;
  const searchStart = Math.max(firstMinLag, minLag);
  for (let lag = searchStart; lag <= maxLag; lag++) {
    if (acf[lag] > bestVal) {
      bestVal = acf[lag];
      bestLag = lag;
    }
  }
  if (bestLag < 0 || acf[0] <= 0) return { freq: -1, clarity: 0, rms };

  // Clarity = normalized peak height in [0,1].
  const clarity = bestVal / acf[0];

  // Parabolic interpolation around the peak for sub-sample lag precision.
  let refinedLag = bestLag;
  if (bestLag > 0 && bestLag < maxLag) {
    const a = acf[bestLag - 1];
    const b = acf[bestLag];
    const c = acf[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const shift = 0.5 * (a - c) / denom;
      if (Math.abs(shift) <= 1) refinedLag = bestLag + shift;
    }
  }

  const freq = sampleRate / refinedLag;
  return { freq, clarity, rms };
}

function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface PitchSample {
  t: number; // seconds from recording start
  freq: number;
  clarity: number;
}

interface NoteSegment {
  midi: number;
  startSec: number;
  durationSec: number;
}

function segmentNotes(samples: PitchSample[]): NoteSegment[] {
  if (samples.length === 0) return [];

  const notes: NoteSegment[] = [];
  let group: PitchSample[] = [samples[0]];
  const breakThreshold = 2.5; // semitones

  const flush = () => {
    if (group.length === 0) return;
    const medFreq = median(group.map((g) => g.freq));
    notes.push({
      midi: freqToMidi(medFreq),
      startSec: group[0].t,
      durationSec: group[group.length - 1].t - group[0].t,
    });
    group = [];
  };

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const groupMidi = freqToMidi(
      median(group.map((g) => g.freq))
    );
    const sMidi = freqToMidi(s.freq);
    const gap = s.t - samples[i - 1].t;
    if (Math.abs(sMidi - groupMidi) > breakThreshold || gap > 0.18) {
      flush();
      group = [s];
    } else {
      group.push(s);
    }
  }
  flush();

  // Drop very short blips (but keep if the whole melody is short)
  return notes.filter(
    (n) => n.durationSec >= 0.08 || notes.length <= 3
  );
}

function describeShape(intervals: number[]): string {
  if (intervals.length < 2) return "brief melody";
  let rises = 0;
  let falls = 0;
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i] > intervals[i - 1]) rises++;
    else if (intervals[i] < intervals[i - 1]) falls++;
  }
  const peakIdx = intervals.indexOf(Math.max(...intervals));
  const valleyIdx = intervals.indexOf(Math.min(...intervals));
  if (rises > 0 && falls === 0) return "rises steadily";
  if (falls > 0 && rises === 0) return "falls steadily";
  if (peakIdx > 0 && peakIdx < intervals.length - 1 && falls > 0)
    return `rises to a peak around note ${peakIdx + 1} then falls`;
  if (valleyIdx > 0 && valleyIdx < intervals.length - 1 && rises > 0)
    return `falls to a low around note ${valleyIdx + 1} then rises`;
  if (rises + falls >= 4) return "undulating melody";
  return "varied contour";
}

export interface MelodyContour {
  noteCount: number;
  intervals: number[]; // semitone deltas from the first note
  shape: string;
  description: string; // ready for the LLM
}

function buildMelodyContour(notes: NoteSegment[]): MelodyContour | null {
  const trimmed = notes.slice(0, 24);
  if (trimmed.length < 2) return null; // need at least one interval
  const midis = trimmed.map((n) => n.midi);
  const base = midis[0];
  const intervals = midis.map((m) => m - base);
  const shape = describeShape(intervals);
  const intervalsStr = intervals
    .map((i) => (i >= 0 ? "+" : "") + i)
    .join(", ");
  const description = `Hummed melody with ${trimmed.length} notes. Relative pitch intervals in semitones from the first note: ${intervalsStr}. Contour shape: ${shape}.`;
  return { noteCount: trimmed.length, intervals, shape, description };
}

/* ================================================================
 * Combined capture hook: speech recognition + pitch detection
 * ================================================================ */

interface UseHummingCaptureOptions {
  onEnd?: (result: {
    transcript: string;
    melody: MelodyContour | null;
    heard: boolean;
  }) => void;
  onError?: (error: string) => void;
}

export function useHummingCapture(options: UseHummingCaptureOptions = {}) {
  const { onEnd, onError } = options;

  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [level, setLevel] = React.useState(0); // 0-1 live input amplitude
  const [hasMelody, setHasMelody] = React.useState(false);
  const [heard, setHeard] = React.useState(false);

  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = React.useRef<PitchSample[]>([]);
  const transcriptRef = React.useRef("");
  const heardRef = React.useRef(false);
  const lastFreqRef = React.useRef(-1);
  const startTimeRef = React.useRef(0);
  const finishedRef = React.useRef(false);
  const onEndRef = React.useRef(onEnd);
  const onErrorRef = React.useRef(onError);

  React.useEffect(() => {
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  });

  const cleanupAudio = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
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
    const SR =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;
    const hasGUM =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    setSupported(!!SR || hasGUM);
    return () => cleanupAudio();
  }, [cleanupAudio]);

  const finish = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    cleanupAudio();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }

    const notes = segmentNotes(samplesRef.current);
    const melody = buildMelodyContour(notes);
    const finalTranscript = transcriptRef.current.trim();
    const finalHeard = heardRef.current;

    setListening(false);
    onEndRef.current?.({
      transcript: finalTranscript,
      melody,
      heard: finalHeard,
    });
  }, [cleanupAudio]);

  const start = React.useCallback(async () => {
    // Reset state
    transcriptRef.current = "";
    samplesRef.current = [];
    heardRef.current = false;
    lastFreqRef.current = -1;
    finishedRef.current = false;
    setTranscript("");
    setLevel(0);
    setHasMelody(false);
    setHeard(false);
    startTimeRef.current = performance.now();
    setListening(true);

    // --- Speech recognition (best-effort, for spoken words) ---
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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
          // If SR ended on its own but audio is still recording → finish up.
          if (pollRef.current && !finishedRef.current) {
            finish();
          }
        };
        recognitionRef.current = rec;
        rec.start();
      } catch {
        // Speech recognition failed to start; pitch detection can still work.
      }
    }

    // --- Pitch detection via getUserMedia + Web Audio API ---
    const hasGUM = !!navigator.mediaDevices?.getUserMedia;
    if (!hasGUM && !SR) {
      // Neither input method works.
      setListening(false);
      onErrorRef.current?.("unsupported");
      return;
    }

    if (hasGUM) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
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
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buf = new Float32Array(analyser.fftSize);
        pollRef.current = setInterval(() => {
          if (!analyserRef.current || !audioCtxRef.current) return;
          analyserRef.current.getFloatTimeDomainData(buf);

          // Pitch detection (returns rms too)
          const { freq, clarity, rms } = detectPitch(buf, ctx.sampleRate);

          // Live input level for the waveform
          setLevel(Math.min(1, rms * 6));

          // Track whether we heard any non-silent input at all
          if (rms > RMS_THRESHOLD && !heardRef.current) {
            heardRef.current = true;
            setHeard(true);
          }

          if (freq > 0 && clarity > CLARITY_THRESHOLD) {
            // Persistence: only accept if it's the first detection, or within
            // ~2 semitones of the last accepted sample. This filters transient
            // noise that happens to cross the lowered threshold.
            const last = lastFreqRef.current;
            const accept =
              last < 0 ||
              Math.abs(12 * Math.log2(freq / last)) <= 2.2;
            if (accept) {
              const t = (performance.now() - startTimeRef.current) / 1000;
              samplesRef.current.push({ t, freq, clarity });
              lastFreqRef.current = freq;
              if (samplesRef.current.length >= 2) setHasMelody(true);
            }
          }
        }, 30);
      } catch {
        // Mic permission denied or hardware error.
        if (!SR) {
          // No fallback at all.
          setListening(false);
          onErrorRef.current?.("mic-denied");
        }
        // If SR is running, it will still capture words.
      }
    }
  }, [finish]);

  const stop = React.useCallback(() => {
    finish();
  }, [finish]);

  const reset = React.useCallback(() => {
    transcriptRef.current = "";
    samplesRef.current = [];
    heardRef.current = false;
    lastFreqRef.current = -1;
    setTranscript("");
    setLevel(0);
    setHasMelody(false);
    setHeard(false);
  }, []);

  return {
    supported,
    listening,
    transcript,
    level,
    hasMelody,
    heard,
    start,
    stop,
    reset,
  };
}
