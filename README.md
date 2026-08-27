# Hummingbird

Hum, sing, or describe a song you half-remember and Hummingbird tries to name it.
No sign-up, no accounts, no tracking.

## How it works

The browser records a short clip and, where the Web Speech API is available,
transcribes it locally as well. Both are posted to `/api/identify`, which tries
two things in order:

1. **Audio fingerprinting (AudD).** The recording is matched against a
   commercial song database. When this hits, the answer is exact — title,
   artist, album, and streaming links come straight from the match.
2. **Lyric guessing (Hugging Face).** If the fingerprint misses, or no AudD
   token is configured, the transcript is handed to Llama 3.1 8B, which returns
   a ranked list of candidates. These are guesses and the UI labels them as
   such.

The response is a `SongResult`: title, artist, year, a confidence level, why it
matched, a lyrics snippet, and up to five alternatives.

## What leaves your device

Your recording is uploaded and forwarded to AudD for matching — fingerprinting
cannot happen in the browser. If AudD misses, the transcribed text is sent to
Hugging Face. Neither the audio nor the text is stored by this app; there is no
database. `localStorage` holds only your theme preference and whether you have
dismissed the intro dialog.

## Running locally

```bash
bun install
cp .env.example .env
bun run dev
```

Both keys have free tiers and neither needs a credit card:

| Variable | Used for | Get one at |
| --- | --- | --- |
| `AUDD_API_TOKEN` | audio fingerprint matching | https://dashboard.audd.io/ |
| `HUGGINGFACE_API_KEY` | lyric-based fallback guesses | https://huggingface.co/settings/tokens |

Without `AUDD_API_TOKEN` the app still runs, but it can only make lyric-based
guesses.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 with shadcn/ui,
and `next-themes` for dark mode. No database.

## Deploying

Import the repo into Vercel and set both environment variables in the project
settings. The build command is the default `next build`.

## Browser support

Voice capture uses `MediaRecorder`, which is available everywhere current. The
local transcript uses the Web Speech API, which is Chrome, Edge, and Safari
only; without it, fingerprinting still works and the text box remains as a
fallback.

## License

MIT — see [LICENSE](LICENSE).
