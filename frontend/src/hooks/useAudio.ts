import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

interface UseAudioOptions {
  socket: Socket | null;
  localStream: MediaStream | null;
  role: 'teacher' | 'student';
  isMuted: boolean;
}

export function useAudio({ socket, localStream, role, isMuted }: UseAudioOptions) {
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  // Stable ref that mirrors isSpeaking state — used inside the rAF loop so that
  // reading/writing the speaking flag does NOT re-trigger the useEffect (which
  // would destroy the AudioContext and reset all rolling detection windows).
  const isSpeakingRef = useRef<boolean>(false);

  // Web Speech API - Speech Recognition
  useEffect(() => {
    if (!localStream || isMuted) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition API is not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const resultIndex = event.resultIndex;
        const transcriptText = event.results[resultIndex][0].transcript.trim();
        
        if (transcriptText && socket) {
          console.log("Speech detected:", transcriptText);
          socket.emit('student-speech-text', { text: transcriptText });
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.error("Speech recognition error:", event.error);
        }
      };

      recognition.onend = () => {
        if (localStream && !isMuted) {
          try { recognition.start(); } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
      recognition.start();

    } catch (e) {
      console.error("Failed to initialize speech recognition:", e);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, [localStream, isMuted, socket]);

  // Helper to calculate Standard Deviation
  const calculateStdDev = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  };

  // Web Audio Analyser (Speaking Indicator, VAD & Spectral Noise Classifier)
  useEffect(() => {
    if (!localStream || isMuted) {
      setIsSpeaking(false);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    let analyzedStream: MediaStream | null = null;
    let dummyAudio: HTMLAudioElement | null = null;
    let resumeContext: () => void = () => {};
    try {
      console.log("✓ Audio stream received");
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      
      // AudioContext auto-resume handler to resolve browser autoplay policy suspension
      resumeContext = () => {
        if (audioContext && audioContext.state === 'suspended') {
          console.log("[Audio Analyser] AudioContext is suspended. Attempting to resume...");
          audioContext.resume().then(() => {
            console.log("[Audio Analyser] AudioContext resumed successfully. State:", audioContext.state);
          }).catch(err => {
            console.warn("[Audio Analyser] Failed to resume AudioContext:", err);
          });
        }
      };

      // Try resuming immediately
      resumeContext();

      // Register interaction listeners to resume as soon as the user interacts with the page
      document.addEventListener('click', resumeContext);
      document.addEventListener('touchstart', resumeContext);

      // Clone the stream to ensure AI analysis operates on a completely independent copy of the microphone stream,
      // preventing any Web Audio nodes or analysers from modifying or degrading the original WebRTC media stream.
      analyzedStream = localStream.clone();
      console.log("AI analysis stream created");

      // Bind the cloned stream to a dummy muted audio element to force Chromium to keep the cloned tracks active
      dummyAudio = document.createElement('audio');
      dummyAudio.muted = true;
      dummyAudio.style.display = 'none';
      dummyAudio.srcObject = analyzedStream;
      dummyAudio.play().then(() => {
        console.log("[Audio Analyser] Dummy playback started successfully");
      }).catch(err => {
        console.log("[Audio Analyser] Dummy playback blocked/failed (autoplay policy):", err);
      });

      // Connect the analyser to localStream directly to ensure that real audio samples flow
      // under all conditions (including headless/automated testing environments) without autoplay blockages.
      const source = audioContext.createMediaStreamSource(localStream);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 512;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      let speakingFramesCount = 0;
      let silentFramesCount = 0;
      let activeStartTime = 0;

      // History buffer of vocal range energy for VAD (last ~1 second / 30 frames)
      const midEnergyHistory: number[] = [];
      
      let lastEmissionTime = 0;
      let frameCount = 0;

      // Sliding window buffer of frame classifications for continuity analysis (last 3 seconds max)
      const rollingNoiseFrames: Array<{
        timestamp: number;
        isDisruptive: boolean;
        noiseType: string;
        severity: string;
        confidence: number;
      }> = [];

      const checkAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume
        let totalEnergy = 0;
        for (let i = 0; i < bufferLength; i++) {
          totalEnergy += dataArray[i];
        }
        const averageVolume = totalEnergy / bufferLength;

        frameCount++;
        if (frameCount % 60 === 0) {
          console.log(`Audio received by AI (Volume: ${averageVolume.toFixed(2)})`);
          console.log("VAD running");
        }

        // Calculate energy in frequency bands
        let lowEnergy = 0;  // 0 - 375 Hz
        let midEnergy = 0;  // 375 - 2250 Hz (Main human voice frequency range)
        let highEnergy = 0; // 2250 - 11250 Hz (High pitched noise, key clicks, treble)
        
        for (let i = 0; i < 4; i++) lowEnergy += dataArray[i];
        for (let i = 4; i < 24; i++) midEnergy += dataArray[i];
        for (let i = 24; i < 120; i++) highEnergy += dataArray[i];
        
        lowEnergy /= 4;
        midEnergy /= 20;
        highEnergy /= 96;

        // Push to rolling history for VAD
        midEnergyHistory.push(midEnergy);
        if (midEnergyHistory.length > 30) {
          midEnergyHistory.shift();
        }

        const midEnergyStdDev = calculateStdDev(midEnergyHistory);
        const isActive = averageVolume > 10; // Simple activity gate
        let continuousActiveDuration = 0;

        if (isActive) {
          if (activeStartTime === 0) {
            activeStartTime = Date.now();
          }
          continuousActiveDuration = Date.now() - activeStartTime;
        } else {
          activeStartTime = 0;
          continuousActiveDuration = 0;
        }

        let currentClassification = 'silence';

        if (isActive) {
          // If sound is continuous for more than 1.5 seconds without any pause,
          // it is classified as noise/music/TV/environmental, NEVER human speech.
          // Lowered from 3000ms so loud continuous audio is reclassified quickly.
          const isForcedNoise = continuousActiveDuration > 1500;
          const isVADSpeech = !isForcedNoise && midEnergy > 15 && midEnergyStdDev > 4.5 && lowEnergy < 40 && highEnergy < 25;

          if (isVADSpeech) {
            currentClassification = 'speech';
            
            // Speak status handling
            speakingFramesCount++;
            silentFramesCount = 0;
            if (speakingFramesCount > 5 && !isSpeakingRef.current) {
              isSpeakingRef.current = true;
              setIsSpeaking(true);
              if (socket) socket.emit('student-speak-status', { isSpeaking: true });
            }
          } else {
            // Stationary energy or high/low pitched non-speech noises
            // Speech status handling
            silentFramesCount++;
            speakingFramesCount = 0;
            if (silentFramesCount > 30 && isSpeakingRef.current) {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              if (socket) socket.emit('student-speak-status', { isSpeaking: false });
            }

            // Spectral Noise Classification
            if (averageVolume > 60 && midEnergy > 45) {
              currentClassification = 'shouting';
            } else if (averageVolume > 50 && highEnergy > 20) {
              currentClassification = 'construction';
            } else if (highEnergy > 20 && lowEnergy < 15 && midEnergyStdDev > 5.5) {
              currentClassification = 'mouse';
            } else if (highEnergy > 20 && midEnergyStdDev > 5.0) {
              currentClassification = 'keyboard';
            } else if (highEnergy > 22 && midEnergyStdDev > 4.0) {
              currentClassification = 'dog'; // High treble peaks (barking)
            } else if ((lowEnergy > 18 && highEnergy > 12) || (averageVolume > 20 && lowEnergy > 15 && highEnergy > 10 && midEnergyStdDev > 2.5)) {
              currentClassification = 'music';
            } else if (lowEnergy > 28 && highEnergy < 12 && midEnergyStdDev <= 3.5) {
              currentClassification = 'fan';
            } else if (lowEnergy > 15 && lowEnergy <= 28 && highEnergy < 10 && midEnergyStdDev <= 3.0) {
              currentClassification = 'ac';
            } else if (lowEnergy > 20 && midEnergy > 12 && highEnergy < 15 && midEnergyStdDev <= 3.5) {
              currentClassification = 'vehicle';
            } else if (midEnergy > 20 && midEnergyStdDev <= 4.0) {
              currentClassification = 'conversation'; // Steady background chatter / babble
            } else if (midEnergy > 15 && midEnergyStdDev > 3.5) {
              currentClassification = 'tv';
            } else {
              currentClassification = 'unknown';
            }
          }
        } else {
          // Silent frame
          silentFramesCount++;
          speakingFramesCount = 0;
          if (silentFramesCount > 30 && isSpeakingRef.current) {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            if (socket) socket.emit('student-speak-status', { isSpeaking: false });
          }
        }

        // Calculate Confidence Score
        let confidence = 0;
        if (currentClassification === 'silence') {
          confidence = Math.round(Math.max(0, Math.min(100, (10 - averageVolume) * 10)));
        } else if (currentClassification === 'speech') {
          confidence = Math.round(Math.max(50, Math.min(99, 80 + (midEnergyStdDev - 4.5) * 4)));
        } else if (currentClassification === 'shouting') {
          confidence = Math.round(Math.max(50, Math.min(99, 85 + (averageVolume - 55) * 1.5)));
        } else if (currentClassification === 'construction') {
          confidence = Math.round(Math.max(50, Math.min(99, 80 + (averageVolume - 50) * 1.5)));
        } else if (currentClassification === 'mouse') {
          confidence = Math.round(Math.max(50, Math.min(99, 75 + (highEnergy - 20) * 1.5)));
        } else if (currentClassification === 'keyboard') {
          confidence = Math.round(Math.max(50, Math.min(99, 75 + (highEnergy - 20) * 1.2)));
        } else if (currentClassification === 'dog') {
          confidence = Math.round(Math.max(50, Math.min(99, 75 + (highEnergy - 22) * 1.5)));
        } else if (currentClassification === 'music') {
          const volumeBonus = Math.min(10, Math.max(0, (averageVolume - 20) * 0.5));
          confidence = Math.round(Math.max(50, Math.min(99, 88 + volumeBonus + (lowEnergy - 18) * 0.5 + (highEnergy - 12) * 0.5)));
        } else if (currentClassification === 'fan') {
          confidence = Math.round(Math.max(50, Math.min(99, 90 - (midEnergyStdDev * 6))));
        } else if (currentClassification === 'ac') {
          confidence = Math.round(Math.max(50, Math.min(99, 88 - (midEnergyStdDev * 8))));
        } else if (currentClassification === 'vehicle') {
          confidence = Math.round(Math.max(50, Math.min(99, 85 - (midEnergyStdDev * 6))));
        } else if (currentClassification === 'conversation') {
          confidence = Math.round(Math.max(50, Math.min(99, 82 - (midEnergyStdDev * 5))));
        } else if (currentClassification === 'tv') {
          confidence = Math.round(Math.max(50, Math.min(99, 75 + (midEnergyStdDev - 3.5) * 3)));
        } else {
          confidence = Math.round(Math.max(10, Math.min(45, averageVolume * 1.2)));
        }

        // Confidence threshold override rules
        if (currentClassification === 'music' && confidence < 85) {
          currentClassification = 'unknown';
          confidence = Math.round(Math.min(45, confidence * 0.5));
        } else if (currentClassification !== 'unknown' && currentClassification !== 'silence' && currentClassification !== 'speech' && confidence < 60) {
          currentClassification = 'unknown';
          confidence = Math.round(Math.min(45, confidence * 0.5));
        }

        // Map classification keys to human readable labels
        const classificationLabels: Record<string, string> = {
          'speech': 'Human Speech',
          'shouting': 'Shouting',
          'music': 'Music',
          'tv': 'TV Audio',
          'fan': 'Fan Noise',
          'ac': 'Air Conditioner',
          'keyboard': 'Keyboard Typing',
          'mouse': 'Mouse Clicks',
          'dog': 'Dog Barking',
          'vehicle': 'Vehicle Noise',
          'conversation': 'Background Conversation',
          'construction': 'Construction Noise',
          'unknown': 'Unknown',
          'silence': 'Silence'
        };

        const displayLabel = classificationLabels[currentClassification] || 'Unknown';

        // Determine severity level based on volume and type
        let severityLevel = 0; // 0: None, 1: Very Low, 2: Low, 3: Medium, 4: High, 5: Critical
        let severityLabel = 'No Noise';

        if (currentClassification !== 'silence' && currentClassification !== 'speech') {
          if (averageVolume < 20 || (['fan', 'ac', 'keyboard', 'mouse'].includes(currentClassification) && averageVolume < 28)) {
            severityLevel = 1;
            severityLabel = 'Very Low';
          } else if (averageVolume >= 20 && averageVolume < 35) {
            severityLevel = 2;
            severityLabel = 'Low';
          } else if (averageVolume >= 35 && averageVolume < 55) {
            severityLevel = 3;
            severityLabel = 'Medium';
          } else if (averageVolume >= 55 && averageVolume < 70) {
            severityLevel = 4;
            severityLabel = 'High';
          } else if (averageVolume >= 70) {
            severityLevel = 5;
            severityLabel = 'Critical';
          }
        }

        // Continuous Disruptive Noise Detection State Machine
        const disruptiveTypes = ['music', 'tv', 'conversation', 'dog', 'construction', 'shouting', 'vehicle'];
        const isDisruptiveType = disruptiveTypes.includes(currentClassification);
        const isHighOrCritical = severityLevel >= 4;
        const isConfidenceValid = currentClassification === 'music' ? confidence >= 85 : confidence >= 60;
        const isFrameDisruptive = isDisruptiveType && isHighOrCritical && isConfidenceValid;

        // Push current frame data to rolling list
        rollingNoiseFrames.push({
          timestamp: Date.now(),
          isDisruptive: isFrameDisruptive,
          noiseType: displayLabel,
          severity: severityLabel,
          confidence: confidence
        });

        // Clean up frames older than 3 seconds
        const now = Date.now();
        while (rollingNoiseFrames.length > 0 && now - rollingNoiseFrames[0].timestamp > 3000) {
          rollingNoiseFrames.shift();
        }

        // ─── Continuous Disruptive Noise Detection — 3-tier fast-path ───────────
        //
        // Tier 1 (CRITICAL — ~800ms):  averageVolume ≥ 70, ≥85% density over 800ms
        //   → emits MUTE immediately. Targets very loud music/TV/shouting.
        //
        // Tier 2 (HIGH — ~1000ms):     averageVolume ≥ 55, ≥80% density over 1000ms
        //   → emits MUTE after ~1 second. Standard classroom disruption.
        //
        // Tier 3 (MEDIUM — 3000ms):    lower volume, ≥80% density over 3 seconds
        //   → emits WARN only, no auto-mute. Prevents false positives for brief sounds.
        //
        // Emission cooldown: 800ms for MUTE, 3000ms for WARN.
        // ─────────────────────────────────────────────────────────────────────────

        let continuousDisruptiveDetected = false;
        let isContinuousDisruptive = false;
        let detectionNoiseType = '';
        let detectionSeverity = '';
        let detectionConfidence = 0;

        const earliestTime = rollingNoiseFrames.length > 0 ? rollingNoiseFrames[0].timestamp : now;
        const trackedDuration = now - earliestTime;

        if (trackedDuration >= 800) {
          // ── Tier 1: Critical severity fast-path (800ms window, 85% density) ──
          const isCriticalVolume = averageVolume >= 70;
          const framesIn800 = rollingNoiseFrames.filter(f => now - f.timestamp <= 800);
          const disruptiveIn800 = framesIn800.filter(f => f.isDisruptive);
          const ratio800 = framesIn800.length > 0 ? (disruptiveIn800.length / framesIn800.length) : 0;

          if (isCriticalVolume && ratio800 >= 0.85 && disruptiveIn800.length >= 3) {
            // Rapid fire: Critical volume + extremely dense disruptive frames
            continuousDisruptiveDetected = true;
            isContinuousDisruptive = true;
            const lastFrame = disruptiveIn800[disruptiveIn800.length - 1];
            detectionNoiseType = lastFrame.noiseType;
            detectionSeverity = lastFrame.severity;
            detectionConfidence = lastFrame.confidence;
            console.log(`[AI] Tier-1 Critical fast-path triggered. Volume: ${averageVolume.toFixed(1)}, Density: ${(ratio800 * 100).toFixed(0)}%`);
          }
        }

        if (!continuousDisruptiveDetected && trackedDuration >= 1000) {
          // ── Tier 2: High severity standard path (1000ms window, 80% density) ──
          const framesIn1000 = rollingNoiseFrames.filter(f => now - f.timestamp <= 1000);
          const disruptiveIn1000 = framesIn1000.filter(f => f.isDisruptive);
          const ratio1000 = framesIn1000.length > 0 ? (disruptiveIn1000.length / framesIn1000.length) : 0;

          if (ratio1000 >= 0.80 && disruptiveIn1000.length >= 4) {
            continuousDisruptiveDetected = true;
            isContinuousDisruptive = true;
            const lastFrame = framesIn1000[framesIn1000.length - 1];
            detectionNoiseType = lastFrame.noiseType;
            detectionSeverity = lastFrame.severity;
            detectionConfidence = lastFrame.confidence;
            console.log(`[AI] Tier-2 High standard-path triggered. Volume: ${averageVolume.toFixed(1)}, Density: ${(ratio1000 * 100).toFixed(0)}%`);
          }
        }

        if (!continuousDisruptiveDetected && trackedDuration >= 3000) {
          // ── Tier 3: Medium severity warn-only path (3000ms window, 80% density) ──
          const framesIn3000 = rollingNoiseFrames;
          const disruptiveOrMediumIn3000 = framesIn3000.filter(f =>
            f.isDisruptive ||
            (disruptiveTypes.includes(f.noiseType) && f.severity === 'Medium' && f.confidence >= 60)
          );
          const ratio3000 = framesIn3000.length > 0 ? (disruptiveOrMediumIn3000.length / framesIn3000.length) : 0;

          if (ratio3000 >= 0.80) {
            continuousDisruptiveDetected = true;
            isContinuousDisruptive = false; // WARN only — do not auto-mute for medium noise
            const lastFrame = framesIn3000[framesIn3000.length - 1];
            detectionNoiseType = lastFrame.noiseType;
            detectionSeverity = lastFrame.severity;
            detectionConfidence = lastFrame.confidence;
            console.log(`[AI] Tier-3 Medium warn-path triggered. Density: ${(ratio3000 * 100).toFixed(0)}%`);
          }
        }

        if (continuousDisruptiveDetected) {
          // MUTE cooldown: 800ms (allows re-confirmation if still noisy after backend ACK)
          // WARN cooldown: 3000ms (avoid repeated alert spam for medium noise)
          const emissionThreshold = isContinuousDisruptive ? 800 : 3000;
          if (now - lastEmissionTime >= emissionThreshold && socket && role === 'student') {
            console.log("Noise detected");
            console.log("Noise type:", detectionNoiseType);
            console.log("Confidence score:", detectionConfidence);
            console.log("Severity:", detectionSeverity);
            console.log("Auto-Mute decision:", isContinuousDisruptive ? "MUTE" : "WARN");

            socket.emit('student-noise-detected', {
              noiseType: detectionNoiseType,
              severity: detectionSeverity,
              confidence: detectionConfidence,
              isContinuousDisruptive: isContinuousDisruptive
            });
            lastEmissionTime = now;
          }
        }

        animationFrameRef.current = requestAnimationFrame(checkAudio);
      };

      console.log("AI analysis started");
      checkAudio();

    } catch (e) {
      console.error("Web Audio API Analyser setup failed:", e);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      // Stop the cloned tracks to release hardware resources cleanly
      if (analyzedStream) {
        analyzedStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
      // Clean up dummyAudio reference
      if (dummyAudio) {
        try {
          dummyAudio.srcObject = null;
        } catch (e) {}
      }
      // Clean up document-level event listeners
      document.removeEventListener('click', resumeContext);
      document.removeEventListener('touchstart', resumeContext);
    };
  // NOTE: isSpeaking is intentionally excluded from the dependency array.
  // Including it would destroy and recreate the AudioContext every time the
  // speaking indicator changes, resetting all rolling detection windows and
  // suspending the AudioContext — which would prevent any noise detection.
  // The isSpeakingRef keeps the flag accessible inside the rAF loop without
  // triggering effect teardown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, isMuted, socket, role]);

  return {
    isSpeaking
  };
}
