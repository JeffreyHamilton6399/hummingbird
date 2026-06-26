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
 * ================================================================ */

const MIN_FREQ = 65; // Hz — low male hum
const MAX_FREQ = 600; // Hz — high female / whistle-ish hum
const CLARITY_THRESHOLD = 0.3; // permissive: real humming often 0.3–0.7
const RMS_THRESHOLD = 0.002; // silence gate

function detectPitch(
  buf: Float32Array,
  sampleRate: number
): { freq: number; clarity: number; rms: number } {
  const SIZE = buf.length;

  let sumSq = 0;
  for (let i = 0; i < SIZE; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / SIZE);
  if (rms < RMS_THRESHOLD) return { freq: -1, clarity: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const maxLag = Math.min(SIZE - 2, Math.floor(sampleRate / MIN_FREQ));

  // Average autocorrelation. acf[0] is the average energy.
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

  const clarity = bestVal / acf[0];

  // Parabolic interpolation around the peak for sub-sample lag precision.
  let refinedLag = bestLag;
  if (bestLag > 0 && bestLag < maxLag) {
    const a = acf[bestLag - 1];
    const b = acf[bestLag];
    const c = acf[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const shift = (0.5 * (a - c)) / denom;
      if (Math.abs(shift) <= 1) refinedLag = bestLag + shift;
    }
  }

  const freq = sampleRate / refinedLag;
  return { freq, clarity, rms };
}

/* ================================================================
 * Note helpers
 * ================================================================ */

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToName(midi: number): string {
  const n = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[n]}${octave}`;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ================================================================
 * Melody extraction: binned-median downsampling
 *
 * Collects all accepted pitch samples, bins them into N equal time
 * windows, takes the median frequency per non-empty bin, and turns
 * that into a relative-interval description. Far more robust to noise
 * and gaps than per-sample note segmentation.
 * ================================================================ */

interface PitchSample {
  t: number; // seconds from recording start
  freq: number;
  clarity: number;
}

export interface MelodyContour {
  noteCount: number;
  directions: string[]; // "up" | "down" | "same" — forgiving contour
  coarseSteps: string[]; // "up a lot" | "up a little" | "same" | ...
  range: number; // semitone span (key-invariant)
  shape: string;
  description: string; // ready for the LLM
  noteNames: string[]; // for display
}

function describeShape(directions: string[]): string {
  if (directions.length < 1) return "brief melody";
  const ups = directions.filter((d) => d === "up").length;
  const downs = directions.filter((d) => d === "down").length;
  if (ups > 0 && downs === 0) return "rises steadily";
  if (downs > 0 && ups === 0) return "falls steadily";
  // Find peak/valley positions
  let peakIdx = -1;
  let valleyIdx = -1;
  let peakVal = 0;
  let valleyVal = 0;
  let run = 0;
  for (let i = 0; i < directions.length; i++) {
    if (directions[i] === "up") run++;
    else if (directions[i] === "down") run--;
    if (peakIdx < 0 || run > peakVal) {
      peakVal = run;
      peakIdx = i;
    }
    if (valleyIdx < 0 || run < valleyVal) {
      valleyVal = run;
      valleyIdx = i;
    }
  }
  if (peakIdx > 0 && peakIdx < directions.length - 1 && downs > 0)
    return `rises to a peak around step ${peakIdx + 1} then falls`;
  if (valleyIdx > 0 && valleyIdx < directions.length - 1 && ups > 0)
    return `falls to a low around step ${valleyIdx + 1} then rises`;
  if (ups + downs >= 4) return "undulating melody";
  return "varied contour";
}

function buildMelodyContour(samples: PitchSample[]): MelodyContour | null {
  if (samples.length < 4) return null;

  const tStart = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  const span = Math.max(0.1, tEnd - tStart);

  // Bin samples into time windows; take median frequency per bin.
  const binCount = Math.min(10, Math.max(4, Math.floor(samples.length / 3)));
  const bins: PitchSample[][] = Array.from({ length: binCount }, () => []);
  for (const s of samples) {
    const idx = Math.min(
      binCount - 1,
      Math.floor(((s.t - tStart) / span) * binCount)
    );
    bins[idx].push(s);
  }

  const binFreqs: number[] = [];
  let carry: number | null = null;
  for (const bin of bins) {
    if (bin.length > 0) {
      carry = median(bin.map((b) => b.freq));
      binFreqs.push(carry);
    } else if (carry !== null) {
      binFreqs.push(carry);
    }
  }
  if (binFreqs.length < 2) return null;

  const midis = binFreqs.map((f) => freqToMidi(f));
  const noteNames = midis.map((m) => midiToName(m));

  // FORGIVING contour: direction + coarse magnitude, NOT exact semitones.
  // A bad singer wobbles ±1-2 semitones, so treat small changes as "same".
  const SAME_THRESHOLD = 1.5; // semitones — absorbs natural vocal wobble
  const BIG_STEP = 4; // semitones — "a lot" vs "a little"
  const directions: string[] = [];
  const coarseSteps: string[] = [];
  for (let i = 1; i < midis.length; i++) {
    const delta = midis[i] - midis[i - 1];
    if (Math.abs(delta) <= SAME_THRESHOLD) {
      directions.push("same");
      coarseSteps.push("same");
    } else if (delta > 0) {
      directions.push("up");
      coarseSteps.push(delta >= BIG_STEP ? "up a lot" : "up a little");
    } else {
      directions.push("down");
      coarseSteps.push(-delta >= BIG_STEP ? "down a lot" : "down a little");
    }
  }

  const range = Math.max(...midis) - Math.min(...midis);
  const shape = describeShape(directions);

  const directionStr = directions.join(" → ");
  const coarseStr = coarseSteps.join(", ");
  const noteNamesStr = noteNames.join(", ");

  // Description for the LLM. Emphasizes contour SHAPE (key-invariant,
  // bad-singer-tolerant) over exact pitches.
  const description = `Approximate hummed/sung melody contour (the singer may be off-key or transposed to a different key — do NOT match by absolute pitch or exact semitones).

Most reliable — direction sequence (up/down/same between consecutive notes): ${directionStr}.
Coarse step pattern: ${coarseStr}.
Overall shape: ${shape}. Spans about ${range} semitones total over ${midis.length} steps (~${span.toFixed(1)}s). Approximate notes (likely transposed, ignore absolute): ${noteNamesStr}.

Match this to famous melodies by their CONTOUR SHAPE and step pattern, not by exact intervals. Examples of contour matching: "Twinkle Twinkle" = same, same, up, same, same; "Happy Birthday" = up, up, up-a-lot, same, down; "Somewhere Over the Rainbow" = up-a-lot (octave), down, same.`;

  return {
    noteCount: midis.length,
    directions,
    coarseSteps,
    range,
    shape,
    description,
    noteNames,
  };
}

/* ================================================================
 * Combined capture hook: speech recognition + pitch detection
 *
 * CRITICAL: SpeechRecognition and audio capture are decoupled.
 * SpeechRecognition ending (e.g. no-speech timeout while humming)
 * does NOT stop the recording — only the user tapping "stop" does.
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
  const [currentNote, setCurrentNote] = React.useState<string>("");

  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = React.useRef<PitchSample[]>([]);
  const textBufRef = React.useRef("");
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
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia;
    setSupported(!!SR || hasGUM);
    return () => cleanupAudio();
  }, [cleanupAudio]);

  const finishRef = React.useRef<() => void>(() => {});

  const finish = React.useCallback(() => {
    if (finishedRef.current) return;

    // Minimum recording duration guard: ignore stop calls within 1.2s of
    // start. This prevents double-taps (touch + click) and accidental instant
    // stops from producing an empty "didn't catch any sound" error.
    const elapsed = performance.now() - startTimeRef.current;
    if (elapsed < 1200) {
      // Reschedule the stop for when the minimum duration elapses.
      window.setTimeout(() => finishRef.current(), 1200 - elapsed);
      return;
    }

    finishedRef.current = true;

    cleanupAudio();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const melody = buildMelodyContour(samplesRef.current);
    const finalTranscript = textBufRef.current.trim();
    // "heard" is true if we detected audio OR speech recognition got words.
    const finalHeard = heardRef.current || finalTranscript.length > 0;

    setListening(false);
    setCurrentNote("");
    onEndRef.current?.({
      transcript: finalTranscript,
      melody,
      heard: finalHeard,
    });
  }, [cleanupAudio]);

  React.useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = React.useCallback(async () => {
    // Reset state
    textBufRef.current = "";
    samplesRef.current = [];
    heardRef.current = false;
    lastFreqRef.current = -1;
    finishedRef.current = false;
    setTranscript("");
    setLevel(0);
    setHasMelody(false);
    setHeard(false);
    setCurrentNote("");
    startTimeRef.current = performance.now();
    setListening(true);

    // --- Speech recognition (best-effort, for spoken words only) ---
    // Decoupled from audio capture: SR ending does NOT stop the recording.
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
          textBufRef.current = text;
          setTranscript(text);
          // If SR is getting words, we definitely "heard" the user — even if
          // the raw audio stream (getUserMedia) failed. This ensures the
          // lyrics-only path works without a working mic stream.
          if (text.trim() && !heardRef.current) {
            heardRef.current = true;
            setHeard(true);
          }
        };
        rec.onerror = (event: SpeechRecognitionErrorEvent) => {
          // no-speech / aborted are expected while humming — not real errors.
          if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
          ) {
            onErrorRef.current?.(event.error);
          }
        };
        rec.onend = () => {
          // SR ended (likely no-speech while humming). Do NOT stop the
          // recording — the user controls that via the mic button.
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
      setListening(false);
      onErrorRef.current?.("unsupported");
      return;
    }

    if (hasGUM) {
      // CRITICAL: Create + resume the AudioContext BEFORE any await, within
      // the user-gesture context. Chrome refuses to start audio after an
      // await, leaving the context suspended and getFloatTimeDomainData
      // returning all zeros (which is why "heard" never flipped).
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx: AudioContext | null = null;
      if (AC) {
        try {
          ctx = new AC();
          if (ctx.state === "suspended") {
            // resume() within the gesture handler — no await before this.
            void ctx.resume();
          }
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

        if (!ctx) return;
        // Best-effort resume again now that we definitely have a stream.
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            // ignore — context may still be usable
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
          if (finishedRef.current) return; // stop processing after finish()
          analyserRef.current.getFloatTimeDomainData(buf);

          const { freq, clarity, rms } = detectPitch(buf, ctx!.sampleRate);

          // Live input level for the waveform
          setLevel(Math.min(1, rms * 6));

          // Track whether we heard any non-silent input at all
          if (rms > RMS_THRESHOLD && !heardRef.current) {
            heardRef.current = true;
            setHeard(true);
          }

          if (freq > 0 && clarity > CLARITY_THRESHOLD) {
            // Persistence filter: accept if first detection, or within ~3.5
            // semitones of the last accepted sample. Loose enough to follow
            // a real melody, tight enough to reject transient noise.
            const last = lastFreqRef.current;
            const accept =
              last < 0 || Math.abs(12 * Math.log2(freq / last)) <= 3.5;
            if (accept) {
              const t = (performance.now() - startTimeRef.current) / 1000;
              samplesRef.current.push({ t, freq, clarity });
              lastFreqRef.current = freq;
              // Live note display
              setCurrentNote(midiToName(freqToMidi(freq)));
              if (samplesRef.current.length >= 4) setHasMelody(true);
            }
          }
        }, 30);
      } catch (err) {
        // getUserMedia failed (permission denied, no mic, etc.).
        // ALWAYS report this — don't swallow it even if SR is running.
        if (ctx) {
          try {
            void ctx.close();
          } catch {
            // ignore
          }
        }
        // If SR is still running, let it try to capture words; but flag that
        // audio capture failed so the error message is accurate.
        if (!SR) {
          setListening(false);
          onErrorRef.current?.("mic-denied");
        } else {
          // SR exists — it might still capture words, so don't stop listening.
          // But log so we know audio capture failed.
          console.warn("[hummingbird] getUserMedia failed, SR-only:", err);
        }
      }
    }
  }, []);

  const stop = React.useCallback(() => {
    finish();
  }, [finish]);

  const reset = React.useCallback(() => {
    textBufRef.current = "";
    samplesRef.current = [];
    heardRef.current = false;
    lastFreqRef.current = -1;
    setTranscript("");
    setLevel(0);
    setHasMelody(false);
    setHeard(false);
    setCurrentNote("");
  }, []);

  return {
    supported,
    listening,
    transcript,
    level,
    hasMelody,
    heard,
    currentNote,
    start,
    stop,
    reset,
  };
}
