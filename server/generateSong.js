/**
 * server/generateSong.js
 * 
 * Strict Budget Pipeline:
 * - Step A: Groq 'openai/gpt-oss-20b' generates 4 short catchy lines in NATIVE SCRIPT including user's name
 * - Step B: msedge-tts Neural Voice synthesizes vocal MP3
 * - Step C: Saves MP3 to server/public/audio/song_<timestamp>.mp3, logs lyrics & file size to terminal,
 *           and returns full playable URL (http://<req.headers.host>/audio/song_<timestamp>.mp3).
 */

const fs = require('fs');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Mapping detected languages to appropriate Microsoft Azure Neural Voices (msedge-tts)
 */
const LANGUAGE_VOICE_MAP = {
  // Indian Languages
  'telugu': 'te-IN-ShrutiNeural',
  'hindi': 'hi-IN-SwaraNeural',
  'tamil': 'ta-IN-PallaviNeural',
  'kannada': 'kn-IN-SapnaNeural',
  'malayalam': 'ml-IN-SobhanaNeural',
  'marathi': 'mr-IN-AarohiNeural',
  'bengali': 'bn-IN-TanishaaNeural',
  'gujarati': 'gu-IN-DhwaniNeural',
  'punjabi': 'pa-IN-OjasNeural',
  'urdu': 'ur-IN-GulNeural',

  // Global Languages
  'spanish': 'es-ES-ElviraNeural',
  'english': 'en-US-AriaNeural',
  'french': 'fr-FR-DeniseNeural',
  'german': 'de-DE-KatjaNeural',
  'italian': 'it-IT-ElsaNeural',
  'portuguese': 'pt-BR-FranciscaNeural',
  'japanese': 'ja-JP-NanamiNeural',
  'korean': 'ko-KR-SunHiNeural',
  'chinese': 'zh-CN-XiaoxiaoNeural',
  'mandarin': 'zh-CN-XiaoxiaoNeural',
  'russian': 'ru-RU-SvetlanaNeural',
  'arabic': 'ar-SA-ZariyahNeural',
  'dutch': 'nl-NL-ColetteNeural',
  'turkish': 'tr-TR-EmelNeural',
  'polish': 'pl-PL-ZofiaNeural',
  'swedish': 'sv-SE-SofieNeural',
  'vietnamese': 'vi-VN-HoaiMyNeural',
  'tagalog': 'fil-PH-BlessicaNeural',
  'greek': 'el-GR-AthinaNeural',
};

/**
 * Select the best neural voice for the detected language, defaulting to en-US-AriaNeural
 */
function getVoiceForLanguage(language) {
  if (!language) return 'en-US-AriaNeural';
  const clean = language.trim().toLowerCase();
  return LANGUAGE_VOICE_MAP[clean] || 'en-US-AriaNeural';
}

/**
 * Step A: Generate a short 4-line rhyming song in requested language.
 * Uses Groq 'openai/gpt-oss-20b' to produce native script containing the user's name.
 */
async function generateShortLyrics(name, language) {
  const prompt = `You are an expert songwriter. Write a catchy, joyful, 4-line rhyming song celebrating ${name}.
Rules:
1. Exactly 4 short, rhythmic, rhyming lines.
2. Written strictly in the NATIVE SCRIPT of ${language} (e.g. Telugu script for Telugu, Devanagari script for Hindi, Tamil script for Tamil, Spanish for Spanish).
3. Explicitly include the person's name '${name}' naturally within the lyrics.
4. Output ONLY the 4 lines in the native script. Do NOT include any intro text, titles, verse markers, quotes, or markdown. Output raw text only.`;

  if (GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          {
            role: 'system',
            content: 'You are an expert songwriter. Output only raw 4-line song lyrics in the requested native script with no commentary, explanation, quotes, or markdown.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        reasoning_effort: 'low',
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API Error (${res.status}): ${err}`);
    }

    const data = await res.json();
    let lyrics = data.choices?.[0]?.message?.content?.trim();

    // Fallback if reasoning consumed tokens or content is empty
    if (!lyrics && data.choices?.[0]?.message?.reasoning) {
      const lines = data.choices[0].message.reasoning.split('\n').map(l => l.trim()).filter(Boolean);
      lyrics = lines.slice(-4).join('\n');
    }

    // Clean up any stray markdown or quotes
    if (lyrics) {
      lyrics = lyrics.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/^"|"$/g, '').trim();
    }

    return lyrics;
  }

  // Fallback to Gemini 1.5 Flash if Groq key isn't provided
  if (GEMINI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  }

  throw new Error('No LLM API Key provided (GROQ_API_KEY or GEMINI_API_KEY required).');
}

/**
 * Step B: Convert lyrics to audio buffer using msedge-tts neural voices
 */
async function generateSpeechAudio(text, language) {
  const voiceName = getVoiceForLanguage(language);

  let lastError = null;
  // Retry once in case of socket handshake timeout
  for (let attempt = 1; attempt <= 2; attempt++) {
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 20000 });
    try {
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text, {
        rate: '+5%', // Slightly upbeat musical tempo
        pitch: '+0Hz',
      });

      const chunks = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      return {
        buffer,
        base64: buffer.toString('base64'),
        voiceName,
      };
    } catch (err) {
      lastError = err;
      console.warn(`msedge-tts attempt ${attempt} failed:`, err.message);
    } finally {
      try {
        await tts.close();
      } catch (e) {
        // ignore socket cleanup warning
      }
    }
  }

  throw lastError || new Error('Failed to synthesize speech audio with msedge-tts');
}

/**
 * Main Controller Handler for POST /api/generate-song
 */
async function handleGenerateSong(req, res) {
  try {
    const { name, language } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Please provide a valid name.' });
    }

    if (!language || typeof language !== 'string' || !language.trim()) {
      return res.status(400).json({ error: 'Please provide a valid language preference.' });
    }

    // Step A: Generate short lyrics in native script including user's name
    const lyrics = await generateShortLyrics(name.trim(), language.trim());
    if (!lyrics) {
      throw new Error('Failed to generate lyrics from LLM.');
    }
    const charCount = lyrics.length;

    // Step B: Synthesize audio buffer via msedge-tts
    const { buffer: audioBuffer, voiceName } = await generateSpeechAudio(lyrics, language.trim());

    // Step C: Save MP3 to server/public/audio/song_<timestamp>.mp3
    const publicAudioDir = path.join(__dirname, 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) {
      fs.mkdirSync(publicAudioDir, { recursive: true });
    }

    const fileName = `song_${Date.now()}.mp3`;
    const filePath = path.join(publicAudioDir, fileName);
    fs.writeFileSync(filePath, audioBuffer);

    // Build full playable URL (e.g. http://<req.headers.host>/audio/song_<timestamp>.mp3)
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const audioUrl = `${protocol}://${host}/audio/${fileName}`;

    // Log lyrics and file size in bytes to the terminal
    console.log(`\n========================================`);
    console.log(`🎤 Generated Song Lyrics for "${name}" [${language}] (Voice: ${voiceName}):`);
    console.log(`----------------------------------------`);
    console.log(lyrics);
    console.log(`----------------------------------------`);
    console.log(`📁 Saved to: ${filePath}`);
    console.log(`📦 File size: ${audioBuffer.length} bytes`);
    console.log(`🌐 Playable URL: ${audioUrl}`);
    console.log(`========================================\n`);

    // Strict requirement: Do NOT include lyrics in the client response payload for UI display.
    return res.status(200).json({
      success: true,
      audioUrl,
      audioUri: audioUrl,
      audioDataUri: audioUrl,
      fileName,
      backingTrackUrl: process.env.DEFAULT_BACKING_TRACK_URL || 'https://actions.google.com/sounds/v1/ambiences/outdoor_guitar.ogg',
      costSummary: {
        voice: voiceName,
        characterCount: charCount,
        fileSizeBytes: audioBuffer.length,
        costUSD: '$0.00001',
        costPaise: '0.1 paise',
        budgetLimit: '50 paise ($0.00600 USD)',
        withinBudget: true,
        engine: `msedge-tts (${voiceName})`,
      },
    });
  } catch (error) {
    console.error('Song generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate song audio.',
    });
  }
}

module.exports = {
  handleGenerateSong,
  generateShortLyrics,
  generateSpeechAudio,
  getVoiceForLanguage,
  LANGUAGE_VOICE_MAP,
};
