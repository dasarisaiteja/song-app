# MelodyCraft AI - Budget-Optimized React Native Song Maker

A single-page React Native application built with Expo and JavaScript that generates personalized 4-line songs in any spoken language for under **50 INR Paise (~$0.006 USD)** per generation.

---

## 💰 Budget Breakdown (< 50 Paise / ~$0.006 USD Limit)

| Pipeline Step | Provider / Model | Usage | Cost (USD) | Cost (INR Paise) |
|---|---|---|---|---|
| **Voice Input** | Voice Recording (`useAudioRecorder`) + Whisper | ~2s Audio Clip | **$0.00003** | **~0.2 paise** |
| **Step A: Lyrics** | Groq (`llama-3.1-8b-instant`) | ~100 tokens | **$0.00001** | **~0.1 paise** |
| **Step B: Audio** | OpenAI (`tts-1`, voice: `nova`) | ~120 characters | **$0.00180** | **~15.0 paise** |
| **Accompaniment**| Royalty-Free Backing Track (`expo-audio`) | Dual-Track Sync | **$0.00000** | **0.0 paise** |
| **TOTAL** | — | — | **~$0.00184** | **~15.3 paise** |

*Well below the strict 50 Paise ($0.006 USD) ceiling!*

---

## 🚀 Quick Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```env
OPENAI_API_KEY=sk-proj-...
GROQ_API_KEY=gsk_...
DEFAULT_BACKING_TRACK_URL=https://actions.google.com/sounds/v1/ambiences/outdoor_guitar.ogg
```

### 3. Run Backend Server
```bash
node server/index.js
```
Endpoints:
- `POST /api/generate-song` (Step A: Lyrics + Step B: TTS-1 audio)
- `POST /api/transcribe-language` (Voice language detection via Groq Whisper / Gemini)

### 4. Run the Mobile App (Works in Expo Go!)
```bash
npx expo start
```
Scan the QR code in **Expo Go** on your physical device or press `a` for Android / `i` for iOS simulator. Native voice recording and playback work directly in Expo Go via `expo-audio`!
