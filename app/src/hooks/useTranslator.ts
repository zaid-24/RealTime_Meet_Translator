import { useState, useRef, useCallback, useEffect } from 'react';

// Use the global SpeechSDK loaded via CDN in index.html
declare const SpeechSDK: any;

// Silence detection constant
const SILENCE_MS = 700;

export type TranslatorStatus = 'Idle' | 'Listening' | 'Translating' | 'Error';

interface TranscriptItem {
  id: number;
  timestamp: string;
  text: string;
}

interface UseTranslatorReturn {
  status: TranslatorStatus;
  transcript: TranscriptItem[];
  interimText: string;
  lastCommitted: string;
  errorMessage: string | null;
  silenceCommitted: boolean; // UI indicator for silence commit
  latencyMs: number | null; // Rough latency between events
  startTranslator: (sourceLang: string, targetLang: string) => Promise<void>;
  stopTranslator: () => void;
  clearTranscript: () => void;
  resetError: () => void;
}

export function useTranslator(): UseTranslatorReturn {
  const [status, setStatus] = useState<TranslatorStatus>('Idle');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [interimText, setInterimText] = useState('');
  const [lastCommitted, setLastCommitted] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [silenceCommitted, setSilenceCommitted] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const recognizerRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pushStreamRef = useRef<any>(null);
  
  // Silence detection refs
  const lastUpdateTimeRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCommittedTextRef = useRef<string>('');
  const currentInterimRef = useRef<string>(''); // Track current interim for silence commit
  
  // Latency tracking
  const lastEventTimeRef = useRef<number>(0);

  // Silence detection effect
  useEffect(() => {
    if (status !== 'Listening' && status !== 'Translating') {
      // Clear timer when not active
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return;
    }

    // Start silence detection timer
    silenceTimerRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceUpdate = now - lastUpdateTimeRef.current;
      const currentInterim = currentInterimRef.current;

      // Check for silence: no updates for SILENCE_MS and there's interim text
      if (
        timeSinceUpdate >= SILENCE_MS &&
        currentInterim.trim().length > 0 &&
        currentInterim.trim() !== lastCommittedTextRef.current
      ) {
        // Commit the interim text with punctuation
        let textToCommit = currentInterim.trim();
        
        // Add punctuation if not already present
        if (!/[.?!…。？！]$/.test(textToCommit)) {
          textToCommit += '.';
        }

        console.log("Silence detected, committing:", textToCommit);

        const newItem: TranscriptItem = {
          id: Date.now(),
          timestamp: new Date().toLocaleTimeString(),
          text: textToCommit
        };

        setTranscript(prev => [...prev, newItem]);
        setLastCommitted(textToCommit);
        setInterimText('');
        currentInterimRef.current = '';
        lastCommittedTextRef.current = textToCommit;
        
        // Show silence indicator briefly
        setSilenceCommitted(true);
        setTimeout(() => setSilenceCommitted(false), 1500);
        
        // Update lastUpdateTime to prevent repeated commits
        lastUpdateTimeRef.current = now;
      }
    }, 100); // Check every 100ms

    return () => {
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, [status]);

  const startTranslator = useCallback(async (sourceLang: string, targetLang: string) => {
    if (recognizerRef.current) return;

    // Check if SDK is loaded
    if (typeof SpeechSDK === 'undefined') {
      setErrorMessage("Speech SDK not loaded. Check your internet connection.");
      setStatus('Error');
      return;
    }

    setStatus('Listening');
    setErrorMessage(null);
    setInterimText('');
    lastUpdateTimeRef.current = Date.now();
    lastCommittedTextRef.current = '';
    currentInterimRef.current = '';

    try {
      // 1. Fetch Token
      const baseUrl = window.electronAPI?.getApiBaseUrl();
      if (!baseUrl) throw new Error("Electron API not available");

      const res = await fetch(`${baseUrl}/token`);
      if (!res.ok) {
         const errData = await res.json();
         throw new Error(errData.error || `Token fetch failed: ${res.statusText}`);
      }
      const { token, region } = await res.json();

      // 2. Get microphone access
      console.log("Requesting microphone access...");
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        },
        video: false,
      });
      console.log("Microphone access granted");

      // 3. Set up Web Audio API to capture audio
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      // 4. Create push stream with proper format (SDK is patched globally in index.html)
      const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStreamRef.current = SpeechSDK.AudioInputStream.createPushStream(format);
      
      console.log("Push stream created, has id():", typeof pushStreamRef.current.id === 'function');

      // 5. Connect audio processing pipeline
      processorRef.current.onaudioprocess = (e: AudioProcessingEvent) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        if (pushStreamRef.current) {
          pushStreamRef.current.write(pcmData.buffer);
        }
      };

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      // 6. Create audio config from the push stream (patched globally in index.html)
      const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStreamRef.current);
      console.log("AudioConfig created");

      // 7. Configure Speech Translation
      const speechConfig = SpeechSDK.SpeechTranslationConfig.fromAuthorizationToken(token, region);
      speechConfig.addTargetLanguage(targetLang);

      // 8. Create recognizer
      console.log("Creating TranslationRecognizer with source:", sourceLang, "target:", targetLang);
      
      speechConfig.speechRecognitionLanguage = sourceLang;
      
      recognizerRef.current = new SpeechSDK.TranslationRecognizer(
          speechConfig, 
          audioConfig
      );
      console.log("TranslationRecognizer created successfully");

      // 9. Event Handlers
      recognizerRef.current.recognizing = (_s: any, e: any) => {
        if (e.result.reason === SpeechSDK.ResultReason.TranslatingSpeech) {
          const text = e.result.translations.get(targetLang);
          if (text) {
            const now = Date.now();
            
            // Calculate latency (time between consecutive recognizing events)
            if (lastEventTimeRef.current > 0) {
              const delta = now - lastEventTimeRef.current;
              // Only show reasonable latency values (50-2000ms)
              if (delta >= 50 && delta <= 2000) {
                setLatencyMs(delta);
              }
            }
            lastEventTimeRef.current = now;
            
            setStatus('Translating');
            setInterimText(text);
            currentInterimRef.current = text;
            lastUpdateTimeRef.current = now; // Track update time for silence detection
          }
        }
      };

      recognizerRef.current.recognized = (_s: any, e: any) => {
        if (e.result.reason === SpeechSDK.ResultReason.TranslatedSpeech) {
          const text = e.result.translations.get(targetLang);
          if (text && text.trim() !== lastCommittedTextRef.current) {
            const newItem: TranscriptItem = {
              id: Date.now(),
              timestamp: new Date().toLocaleTimeString(),
              text: text
            };
            setTranscript(prev => [...prev, newItem]);
            setLastCommitted(text);
            setInterimText('');
            currentInterimRef.current = '';
            lastCommittedTextRef.current = text;
            lastUpdateTimeRef.current = Date.now(); // Track update time
          }
        }
      };

      recognizerRef.current.canceled = (_s: any, e: any) => {
        console.log(`Canceled: ${e.reason}`);
        if (e.reason === SpeechSDK.CancellationReason.Error) {
          console.error(`Error: ${e.errorCode} - ${e.errorDetails}`);
          setErrorMessage(`Speech Error: ${e.errorDetails}`);
          stopTranslator();
        }
      };

      recognizerRef.current.sessionStopped = (_s: any, _e: any) => {
        console.log("Session stopped");
      };

      // 10. Start recognition
      console.log("Starting continuous recognition...");
      recognizerRef.current.startContinuousRecognitionAsync(
        () => console.log("Recognition started successfully"),
        (err: any) => {
          console.error("Recognition start error:", err);
          setErrorMessage(`Failed to start: ${err}`);
          stopTranslator();
        }
      );

    } catch (err: any) {
      console.error("Start Translator Error:", err);
      setErrorMessage(err.message || "Failed to start translation");
      setStatus('Error');
      cleanupRecognizer();
    }
  }, []);

  const cleanupRecognizer = useCallback(() => {
    // Clear silence timer
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop recognizer
    if (recognizerRef.current) {
      try {
        recognizerRef.current.stopContinuousRecognitionAsync();
        recognizerRef.current.close();
      } catch (e) {
        console.error("Error closing recognizer", e);
      }
      recognizerRef.current = null;
    }

    // Close push stream
    if (pushStreamRef.current) {
      try {
        pushStreamRef.current.close();
      } catch (e) {}
      pushStreamRef.current = null;
    }

    // Disconnect processor
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {}
      processorRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Reset silence detection state
    currentInterimRef.current = '';
  }, []);

  const stopTranslator = useCallback(() => {
    cleanupRecognizer();
    setStatus('Idle');
    setInterimText('');
    setLatencyMs(null);
    lastEventTimeRef.current = 0;
  }, [cleanupRecognizer]);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setInterimText('');
    setLastCommitted('');
    lastCommittedTextRef.current = '';
    currentInterimRef.current = '';
  }, []);

  const resetError = useCallback(() => setErrorMessage(null), []);

  return {
    status,
    transcript,
    interimText,
    lastCommitted,
    errorMessage,
    silenceCommitted,
    latencyMs,
    startTranslator,
    stopTranslator,
    clearTranscript,
    resetError
  };
}
