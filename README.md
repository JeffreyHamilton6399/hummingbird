# Hummingbird

**What's that song?** Hum, sing, or describe a song you half-remember and Hummingbird tries to identify it. Like Shazam for your memory.

No sign-up. No accounts. No tracking. Just the song.

## How it works

```
Browser (mic / text input)
        │  only TEXT is sent (audio stays local)
        ▼
POST /api/identify  ──►  z-ai-web-dev-sdk
        │                     │
        │                     ├─ web_search  (ground the answer in real results)
        │                     └─ chat.completions  (reason + identify)
        ▼
JSON { title, artist, year, confidence, why, lyrics_snippet, alternatives[] }
```

1. **Voice (optional):** the mic is transcribed **in your browser** with the Web Speech API (`SpeechRecognition`). The audio never leaves the device — only the transcribed text is sent to the server.
2. **Text:** you can always type the description instead.
3. **Server:** the `/api/identify` route runs a web search for the description, then asks an LLM to identify the song and returns a structured JSON result.
4. **Result:** title + artist, a confidence level, why it matches (quoting your words), a lyrics snippet, and search links for YouTube / Spotify / Apple Music. If unsure, it returns 3–5 ranked guesses.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui** (New York style)
- **z-ai-web-dev-sdk** (backend only) for web search + LLM chat completions
- **Web Speech API** (`SpeechRecognition`) for in-browser voice-to-text
- **next-themes** for dark mode
- **bun** as package manager

## Design notes

- Single screen, mobile-first (works at 390px), no page scroll — header (h-12) / main (flex-1, internally scrollable) / footer (h-8).
- Flat design: no gradients, no decorative blobs, no spinners (animated dots / pulse only).
- Emerald = mic & strong match, amber = possible match, rose = donate / error accents.
- Custom flat SVG hummingbird logo + favicon.

## Privacy

- **Audio stays local.** The mic is transcribed in the browser; the server never receives or stores audio.
- **Your text description is sent to the AI** (web search + LLM) to identify the song. It is not stored.
- **No accounts, no tracking, no analytics.** `localStorage` is used only for the theme and to remember you accepted the "how it works" dialog.

## Local development

```bash
bun install
bun run dev      # http://localhost:3000
bun run lint
```

Set `ZAI_API_KEY` in your environment (or `.env`).

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel.
3. Add the `ZAI_API_KEY` environment variable in the Vercel project settings.
4. Deploy. (Build command: `next build`.)

> Voice input (Web Speech API) works in Chrome, Edge, and Safari. If it's unavailable, the text input is the primary interface.

## Author

Jeffrey Hamilton · [GitHub](https://github.com/JeffreyHamilton6399) · [Donate](https://buymeacoffee.com/jeffreyscof)
