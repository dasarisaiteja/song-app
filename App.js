import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { generateSongApi, transcribeLanguageApi } from './services/songService';

export default function App() {
  // ---------------------------------------------------------
  // State Management
  // ---------------------------------------------------------
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');

  // Audio Recorder (Native in Expo Go via expo-audio)
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Audio Playback (expo-audio hooks)
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const bgPlayer = useAudioPlayer(null);

  const [hasGeneratedAudio, setHasGeneratedAudio] = useState(false);
  const [costInfo, setCostInfo] = useState(null);

  const isMounted = useRef(true);

  // ---------------------------------------------------------
  // Expo Audio Mode Initialization
  // ---------------------------------------------------------
  useEffect(() => {
    isMounted.current = true;

    async function setupAudioMode() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          allowsRecording: false,
        });
      } catch (err) {
        console.warn('Audio Mode setup error:', err);
      }
    }
    setupAudioMode();

    return () => {
      isMounted.current = false;
      try {
        player.pause();
        bgPlayer.pause();
      } catch (e) {}
    };
  }, []);

  // Auto reset when song finishes
  useEffect(() => {
    if (playerStatus.didJustFinish) {
      player.seekTo(0);
      try {
        bgPlayer.pause();
        bgPlayer.seekTo(0);
      } catch (e) {}
    }
  }, [playerStatus.didJustFinish]);

  // ---------------------------------------------------------
  // Voice Recording Control (Two-Tap: Tap to Record, Tap to Send)
  // ---------------------------------------------------------
  async function handleToggleVoiceInput() {
    if (isTranscribing) return;

    if (isRecordingVoice) {
      // -------------------------------------------------------
      // SECOND TAP: Stop recording and send audio to /api/transcribe-language
      // -------------------------------------------------------
      setIsRecordingVoice(false);
      setIsTranscribing(true);

      try {
        await audioRecorder.stop();

        // Restore playback audio mode
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });

        const recordedUri = audioRecorder.uri;
        if (!recordedUri) {
          throw new Error('No recorded audio file was generated.');
        }

        // Send to backend /api/transcribe-language endpoint
        const detected = await transcribeLanguageApi(recordedUri);
        if (isMounted.current) {
          setLanguage(detected);
        }
      } catch (error) {
        console.warn('Voice transcription error:', error);
        Alert.alert(
          'Transcription Failed',
          error.message || 'Could not transcribe language from your recording.'
        );
      } finally {
        if (isMounted.current) {
          setIsTranscribing(false);
        }
      }
    } else {
      // -------------------------------------------------------
      // FIRST TAP: Request permission and start recording
      // -------------------------------------------------------
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Microphone Permission',
            'Permission to record audio is required to detect your spoken language.'
          );
          return;
        }

        // Enable recording in audio mode
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });

        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        setIsRecordingVoice(true);
      } catch (error) {
        console.warn('Failed to start recording:', error);
        setIsRecordingVoice(false);
        Alert.alert('Recording Error', 'Could not start audio recording on this device.');
      }
    }
  }

  // ---------------------------------------------------------
  // Song Generation Pipeline (Budget < 50 Paise / ~$0.006 USD)
  // ---------------------------------------------------------
  async function handleGenerateSong() {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter your name.');
      return;
    }
    if (!language.trim()) {
      Alert.alert('Missing Language', 'Please speak or select your preferred language.');
      return;
    }

    try {
      // Pause any ongoing playback
      try {
        player.pause();
        bgPlayer.pause();
      } catch (e) {}

      setIsGenerating(true);
      setHasGeneratedAudio(false);

      // Ensure playback audio mode is active (critical for Android speakers)
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        allowsRecording: false,
      });

      // Step A: Generating budget lyrics in native script (< $0.0001)
      setGenerationStep('Writing lyrics in ' + language + '...');

      // Step B: Audio synthesis via msedge-tts ($0.00)
      setGenerationStep('Synthesizing vocal melody...');
      const response = await generateSongApi(name, language);

      const audioUrl = response.audioUrl || response.audioUri;
      if (!audioUrl) {
        throw new Error('No audio URL returned from the server.');
      }

      setGenerationStep('Loading and playing...');

      // Load into expo-audio using player.replace({ uri: audioUrl }) and immediately call player.play()
      player.replace({ uri: audioUrl });
      player.play();

      // Synchronize background instrumental track if provided
      if (response.backingTrackUrl) {
        try {
          bgPlayer.replace({ uri: response.backingTrackUrl });
          bgPlayer.loop = true;
          bgPlayer.volume = 0.28;
          bgPlayer.seekTo(0);
          bgPlayer.play();
        } catch (e) {
          console.warn('Backing track load skipped:', e);
        }
      }

      setCostInfo(response.costSummary);
      setHasGeneratedAudio(true);
    } catch (err) {
      console.error('Generation error:', err);
      Alert.alert('Generation Failed', err.message || 'Unable to generate song at this time.');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  }

  // ---------------------------------------------------------
  // Audio Controls (Play, Pause, Stop)
  // ---------------------------------------------------------
  function handlePlay() {
    try {
      player.play();
      if (bgPlayer) {
        bgPlayer.play();
      }
    } catch (err) {
      console.warn('Play error:', err);
    }
  }

  function handlePause() {
    try {
      player.pause();
      if (bgPlayer) {
        bgPlayer.pause();
      }
    } catch (err) {
      console.warn('Pause error:', err);
    }
  }

  function handleStop() {
    try {
      player.pause();
      player.seekTo(0);
      if (bgPlayer) {
        bgPlayer.pause();
        bgPlayer.seekTo(0);
      }
    } catch (err) {
      console.warn('Stop error:', err);
    }
  }

  // Helper to format position/duration to MM:SS (supports seconds & ms)
  function formatTime(val) {
    if (!val || isNaN(val)) return '0:00';
    const totalSeconds = val > 1000 ? Math.floor(val / 1000) : Math.floor(val);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  // ---------------------------------------------------------
  // Render UI
  // ---------------------------------------------------------
  const progressRatio = playerStatus.duration > 0 ? playerStatus.currentTime / playerStatus.duration : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>MelodyCraft AI</Text>
          <Text style={styles.appSubtitle}>Custom 4-Line Songs in Any Language</Text>
          <View style={styles.budgetBadge}>
            <Text style={styles.budgetBadgeText}>
              Target Cost: &lt; 50 Paise (~$0.006 USD)
            </Text>
          </View>
        </View>

        {/* Input Card */}
        <View style={styles.card}>
          {/* 1. Name Input */}
          <Text style={styles.label}>1. YOUR NAME</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. Sofia, Rahul, Elena"
            placeholderTextColor="#64748B"
            value={name}
            onChangeText={setName}
            maxLength={40}
            autoCorrect={false}
          />

          {/* 2. Language Voice Input (Two-Tap expo-audio) */}
          <View style={styles.labelRow}>
            <Text style={styles.label}>2. PREFERRED LANGUAGE (VOICE)</Text>
            {language ? (
              <View style={styles.activeLanguageBadge}>
                <Text style={styles.activeLanguageText}>{language}</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            style={[
              styles.micButton,
              isRecordingVoice && styles.micButtonActive,
              isTranscribing && styles.micButtonTranscribing,
            ]}
            onPress={handleToggleVoiceInput}
            activeOpacity={0.8}
            disabled={isTranscribing}
          >
            <View
              style={[
                styles.micIconWrapper,
                isRecordingVoice && styles.micIconActive,
                isTranscribing && styles.micIconTranscribing,
              ]}
            >
              {isTranscribing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.micEmoji}>{isRecordingVoice ? '⏹' : '🎙'}</Text>
              )}
            </View>
            <View style={styles.micTextContainer}>
              <Text style={styles.micMainText}>
                {isRecordingVoice
                  ? 'Recording... Tap again to finish'
                  : isTranscribing
                  ? 'Detecting spoken language...'
                  : 'Tap & Speak Language'}
              </Text>
              <Text style={styles.micSubText}>
                {isTranscribing
                  ? 'Analyzing voice via Groq Whisper API...'
                  : isRecordingVoice
                  ? 'Say your language (e.g. "Telugu", "Hindi") then tap'
                  : language
                  ? `Detected: ${language} (Tap to record again)`
                  : 'Tap once to record, tap again when done'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* 3. Generate Button */}
          <TouchableOpacity
            style={[
              styles.generateButton,
              (!name.trim() || !language.trim() || isGenerating) && styles.generateButtonDisabled,
            ]}
            onPress={handleGenerateSong}
            disabled={!name.trim() || !language.trim() || isGenerating}
            activeOpacity={0.85}
          >
            {isGenerating ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.generateButtonText}>
                  {generationStep || 'Generating Song...'}
                </Text>
              </View>
            ) : (
              <Text style={styles.generateButtonText}>✨ Generate Song</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 4. Audio Player (Strict requirement: NO lyrics displayed anywhere!) */}
        {hasGeneratedAudio && (
          <View style={styles.playerCard}>
            <View style={styles.playerHeader}>
              <View>
                <Text style={styles.songTitle}>Song for {name}</Text>
                <Text style={styles.songDetails}>
                  Language: {language} • {costInfo?.voice || 'Neural Voice'}
                </Text>
              </View>
              <View style={styles.audioFormatBadge}>
                <Text style={styles.audioFormatText}>MP3</Text>
              </View>
            </View>

            {/* Visualizer / Progress Track */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBackground}>
                <View style={[styles.progressBarFill, { width: `${progressRatio * 100}%` }]} />
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(playerStatus.currentTime)}</Text>
                <Text style={styles.timeText}>{formatTime(playerStatus.duration)}</Text>
              </View>
            </View>

            {/* Playback Controls (Play, Pause, Stop) */}
            <View style={styles.controlsRow}>
              {/* Play Button */}
              <TouchableOpacity
                style={[
                  styles.controlBtn,
                  playerStatus.playing ? styles.controlBtnInactive : styles.playBtn,
                ]}
                onPress={handlePlay}
                disabled={playerStatus.playing}
              >
                <Text style={styles.controlIconText}>▶ Play</Text>
              </TouchableOpacity>

              {/* Pause Button */}
              <TouchableOpacity
                style={[
                  styles.controlBtn,
                  !playerStatus.playing ? styles.controlBtnInactive : styles.pauseBtn,
                ]}
                onPress={handlePause}
                disabled={!playerStatus.playing}
              >
                <Text style={styles.controlIconText}>⏸ Pause</Text>
              </TouchableOpacity>

              {/* Stop Button */}
              <TouchableOpacity style={[styles.controlBtn, styles.stopBtn]} onPress={handleStop}>
                <Text style={styles.controlIconText}>⏹ Stop</Text>
              </TouchableOpacity>
            </View>

            {/* Cost Audit Badge */}
            {costInfo && (
              <View style={styles.costInfoBox}>
                <Text style={styles.costInfoTitle}>💡 Budget Optimization Audit</Text>
                <Text style={styles.costInfoDetail}>
                  Actual Cost: {costInfo.costPaise || '~0.1 paise'} ({costInfo.costUSD || '$0.00001'} USD)
                </Text>
                <Text style={styles.costInfoSub}>
                  Groq openai/gpt-oss-20b + msedge-tts {costInfo.voice || 'Neural Voice'}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------
// Modern Clean Styling (StyleSheet)
// ---------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 30 : 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  budgetBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 10,
  },
  budgetBadgeText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    elevation: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#F8FAFC',
  },
  activeLanguageBadge: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  activeLanguageText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  micButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    padding: 14,
  },
  micButtonActive: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  micButtonTranscribing: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  micIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  micIconActive: {
    backgroundColor: '#EF4444',
  },
  micIconTranscribing: {
    backgroundColor: '#0284C7',
  },
  micEmoji: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  micTextContainer: {
    flex: 1,
  },
  micMainText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  micSubText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  generateButton: {
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    elevation: 4,
  },
  generateButtonDisabled: {
    backgroundColor: '#475569',
    elevation: 0,
  },
  generateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#4338CA',
    elevation: 6,
  },
  playerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  songTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  songDetails: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  audioFormatBadge: {
    backgroundColor: '#312E81',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  audioFormatText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '700',
  },
  progressContainer: {
    marginVertical: 14,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    fontSize: 12,
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnInactive: {
    backgroundColor: '#334155',
    opacity: 0.5,
  },
  playBtn: {
    backgroundColor: '#10B981',
  },
  pauseBtn: {
    backgroundColor: '#F59E0B',
  },
  stopBtn: {
    backgroundColor: '#EF4444',
  },
  controlIconText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  costInfoBox: {
    marginTop: 16,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  costInfoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38BDF8',
    marginBottom: 2,
  },
  costInfoDetail: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F1F5F9',
  },
  costInfoSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
});
