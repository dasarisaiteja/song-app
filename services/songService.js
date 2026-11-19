/**
 * services/songService.js
 * 
 * Client service to communicate with the Song Generation & Voice Transcription Backend.
 * Adheres strictly to the 50 Paise / ~$0.006 USD budget limit.
 */
import * as FileSystem from 'expo-file-system/legacy';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Write a Base64 string or data:audio/mp3;base64 URI to a local file in FileSystem.cacheDirectory.
 * Returns the local file:// URI suitable for expo-audio's native player.
 * @param {string} audioData - Base64 audio string, data:audio URI, or existing file:// URI
 * @returns {Promise<string>} - file:// URI
 */
export async function writeBase64AudioToLocalFile(audioData) {
  if (!audioData || typeof audioData !== 'string') {
    throw new Error('No audio data provided to save locally.');
  }

  // If already a local file or remote http URL, return it directly
  if (audioData.startsWith('file://') || audioData.startsWith('http://') || audioData.startsWith('https://')) {
    return audioData;
  }

  // Strip data URI scheme prefix if present (e.g., "data:audio/mp3;base64,")
  let base64Content = audioData;
  if (audioData.includes('base64,')) {
    base64Content = audioData.split('base64,')[1];
  }

  // Create unique file path in cacheDirectory using timestamp
  const fileName = `song_${Date.now()}.mp3`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, base64Content, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return fileUri;
}

/**
 * Send recorded audio to /api/transcribe-language to detect the spoken language.
 * @param {string} audioUri - Local file URI of the recorded audio from expo-audio
 * @returns {Promise<string>} - Detected language (e.g., 'Spanish', 'Hindi', etc.)
 */
export async function transcribeLanguageApi(audioUri) {
  if (!audioUri) {
    throw new Error('No audio file URI provided for transcription.');
  }

  // 1. Read recorded audio file as Base64 string
  const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
    encoding: 'base64',
  });

  // 2. Send to backend endpoint
  const response = await fetch(`${BACKEND_URL}/api/transcribe-language`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioBase64: base64Audio,
      mimeType: 'audio/m4a',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Transcription failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data || !data.language) {
    throw new Error('Backend responded but did not return a valid detected language.');
  }

  return data.language;
}

/**
 * Request the backend to generate a 4-line personalized song and return the MP3 audio.
 * Returns { audioUrl, audioUri, backingTrackUrl, costSummary }.
 * @param {string} name - User's name
 * @param {string} language - Target language (e.g., 'Telugu', 'Hindi', 'Spanish', 'English')
 * @returns {Promise<{ audioUrl: string, audioUri: string, backingTrackUrl?: string, costSummary: object }>}
 */
export async function generateSongApi(name, language) {
  const response = await fetch(`${BACKEND_URL}/api/generate-song`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: name.trim(),
      language: language.trim(),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with HTTP ${response.status}`);
  }

  const data = await response.json();
  const rawAudio = data.audioUrl || data.audioUri || data.audioDataUri;
  if (!rawAudio) {
    throw new Error('Song generation succeeded but no audio URL or track was returned.');
  }

  // If the backend returns a full URL like http://... or https://..., use it directly.
  // If it returned a base64 or data: URI, write to local cache file.
  let resolvedUrl = rawAudio;
  if (
    rawAudio.startsWith('data:audio') ||
    (!rawAudio.startsWith('http://') && !rawAudio.startsWith('https://') && !rawAudio.startsWith('file://'))
  ) {
    resolvedUrl = await writeBase64AudioToLocalFile(rawAudio);
  }

  return {
    audioUrl: resolvedUrl,
    audioUri: resolvedUrl,
    backingTrackUrl: data.backingTrackUrl,
    costSummary: data.costSummary,
  };
}
