/**
 * server/transcribeLanguage.js
 * 
 * Endpoint: POST /api/transcribe-language
 * 
 * Accepts an audio file upload, sends it to Groq's Whisper API
 * (model: whisper-large-v3-turbo) using GROQ_API_KEY, extracts the
 * language name, and returns { language }.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Common languages for fast heuristic matching
const KNOWN_LANGUAGES = [
  'Spanish', 'Hindi', 'English', 'French', 'German', 'Italian', 'Portuguese',
  'Japanese', 'Korean', 'Mandarin', 'Chinese', 'Russian', 'Arabic', 'Bengali',
  'Punjabi', 'Telugu', 'Tamil', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam',
  'Dutch', 'Turkish', 'Polish', 'Swedish', 'Tagalog', 'Vietnamese', 'Greek'
];

// Multilingual aliases mapping to English language names
const ALIASES = {
  'español': 'Spanish',
  'espanol': 'Spanish',
  'castellano': 'Spanish',
  'français': 'French',
  'francais': 'French',
  'deutsch': 'German',
  'italiano': 'Italian',
  'português': 'Portuguese',
  'portugues': 'Portuguese',
  'nihongo': 'Japanese',
  'hindi': 'Hindi',
  'bangla': 'Bengali',
};

/**
 * Extract language name from transcribed text using dictionary and heuristic patterns
 */
function extractLanguageFromText(text) {
  if (!text || typeof text !== 'string') return 'English';
  const clean = text.trim();

  // 1. Direct match with known languages
  for (const lang of KNOWN_LANGUAGES) {
    const regex = new RegExp(`\\b${lang}\\b`, 'i');
    if (regex.test(clean)) {
      return lang;
    }
  }

  // 2. Multilingual aliases (e.g. español -> Spanish, français -> French)
  const lower = clean.toLowerCase();
  for (const [alias, standard] of Object.entries(ALIASES)) {
    if (lower.includes(alias)) {
      return standard;
    }
  }

  // 3. Fallback: Take the last recognized alphabetic word and capitalize it
  const words = clean.split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, '')).filter(Boolean);
  if (words.length > 0) {
    const candidate = words[words.length - 1];
    return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
  }

  return 'English';
}

/**
 * Optional refinement: If transcribed text is a sentence, use Groq Llama-3 to extract the exact language
 */
async function extractLanguageWithLLM(text) {
  if (!text) return 'English';
  const quickMatch = extractLanguageFromText(text);
  if (quickMatch && quickMatch !== 'English') {
    return quickMatch;
  }

  if (GROQ_API_KEY && text.length > 3) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: 'The user spoke their requested song language. Extract and return ONLY the capitalized language name in English (e.g. Spanish, Hindi, French, German). If unclear, return English.',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 15,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const extracted = data.choices?.[0]?.message?.content?.trim();
        const cleanExtracted = extracted ? extracted.replace(/[^a-zA-Z]/g, '') : '';
        if (cleanExtracted) {
          return cleanExtracted.charAt(0).toUpperCase() + cleanExtracted.slice(1).toLowerCase();
        }
      }
    } catch (err) {
      console.warn('LLM language extraction fallback:', err.message);
    }
  }

  return quickMatch;
}

/**
 * Sends audio buffer to Groq's Whisper API (whisper-large-v3-turbo)
 */
async function transcribeWithGroqWhisper(buffer, filename = 'audio.m4a', mimeType = 'audio/m4a') {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set in environment variables.');
  }

  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Groq Whisper API Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.text || '';
}

/**
 * Lightweight helper to extract binary file from multipart/form-data buffer
 */
function parseMultipartAudio(rawBuffer, contentType) {
  if (!contentType || !contentType.includes('boundary=')) return null;
  const boundary = contentType.split('boundary=')[1]?.trim();
  if (!boundary) return null;

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let start = rawBuffer.indexOf(boundaryBuffer);
  if (start === -1) return null;

  while (start !== -1) {
    const nextBoundary = rawBuffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (nextBoundary === -1) break;

    const part = rawBuffer.subarray(start + boundaryBuffer.length, nextBoundary);
    const headerEndIndex = part.indexOf('\r\n\r\n');
    if (headerEndIndex !== -1) {
      const headerStr = part.subarray(0, headerEndIndex).toString('utf-8');
      const filenameMatch = headerStr.match(/filename="([^"]+)"/);
      const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

      let content = part.subarray(headerEndIndex + 4);
      if (content.length >= 2 && content.subarray(-2).toString() === '\r\n') {
        content = content.subarray(0, -2);
      }

      if (content.length > 0) {
        return {
          buffer: content,
          filename: filenameMatch ? filenameMatch[1] : 'audio.m4a',
          mimeType: mimeMatch ? mimeMatch[1].trim() : 'audio/m4a',
        };
      }
    }
    start = nextBoundary;
  }
  return null;
}

/**
 * Express / Node.js HTTP handler for POST /api/transcribe-language
 */
async function handleTranscribeLanguage(req, res) {
  try {
    let audioBuffer = null;
    let filename = 'audio.m4a';
    let mimeType = 'audio/m4a';

    const contentType = req.headers['content-type'] || '';

    // 1. Handled via multer / express file upload middleware
    const uploadedFile = req.file || (req.files && req.files[0]);
    if (uploadedFile && uploadedFile.buffer) {
      audioBuffer = uploadedFile.buffer;
      filename = uploadedFile.originalname || filename;
      mimeType = uploadedFile.mimetype || mimeType;
    }
    // 2. Handled via multipart/form-data with raw body buffer
    else if (contentType.includes('multipart/form-data') && req.rawBody) {
      const parsed = parseMultipartAudio(req.rawBody, contentType);
      if (parsed) {
        audioBuffer = parsed.buffer;
        filename = parsed.filename;
        mimeType = parsed.mimeType;
      }
    }
    // 3. Handled via JSON with Base64 audio payload { audioBase64, mimeType }
    else if (req.body && req.body.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
      if (req.body.mimeType) mimeType = req.body.mimeType;
    }
    // 4. Handled via raw binary audio body
    else if (req.rawBody && req.rawBody.length > 0 && contentType.startsWith('audio/')) {
      audioBuffer = req.rawBody;
      mimeType = contentType;
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({
        error: 'No audio file received. Upload a file via multipart/form-data, raw audio, or { audioBase64 } in JSON.',
      });
    }

    // Call Groq Whisper API (whisper-large-v3-turbo)
    const transcribedText = await transcribeWithGroqWhisper(audioBuffer, filename, mimeType);

    // Extract language name
    const detectedLanguage = await extractLanguageWithLLM(transcribedText);

    // Return { language }
    return res.status(200).json({
      language: detectedLanguage,
    });
  } catch (error) {
    console.error('Transcribe Language error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to transcribe audio.',
    });
  }
}

module.exports = {
  handleTranscribeLanguage,
  transcribeWithGroqWhisper,
  extractLanguageFromText,
  extractLanguageWithLLM,
};
