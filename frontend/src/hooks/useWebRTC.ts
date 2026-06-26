import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

interface UseWebRTCOptions {
  socket: Socket | null;
  meetingId: string;
  userId: string;
  displayName: string;
  onScreenShareEnded?: () => void;
}

export function useWebRTC({ socket, meetingId, userId, displayName, onScreenShareEnded }: UseWebRTCOptions) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, { stream: MediaStream; displayName: string }>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map()); // targetUserId -> RTCPeerConnection
  const iceQueuesRef = useRef<Map<string, any[]>>(new Map()); // targetUserId -> queued ICE candidates

  const iceServers = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // Start local video/audio stream
  const startLocalStream = async (video: boolean, audio: boolean) => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      console.log(`[Audio Debug] getUserMedia requested. Video target: ${video}, Audio target: ${audio}`);
      let stream: MediaStream;
      // Explicit audio constraints: disable browser's noise suppression and AGC which can
      // clip or distort continuous speech, and set a wide sample rate for clearer audio.
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,   // keep echo cancellation — essential for full-duplex
        noiseSuppression: false,  // disable: browser NS aggressively clips background and speech
        autoGainControl: false,   // disable: AGC causes volume pumping / distortion on loud inputs
        sampleRate: 48000,
        channelCount: 1,
      };
      try {
        // Always try to acquire both camera and mic if possible to support dynamic toggling
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: audioConstraints
        });
        console.log("Microphone initialized");
        console.log("[Audio Debug] Microphone permission granted successfully.");
      } catch (err) {
        console.warn("[Audio Debug] Dual stream acquisition failed (no camera or permission denied). Trying audio-only fallback...", err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: audioConstraints
          });
          console.log("Microphone initialized");
          console.log("[Audio Debug] Microphone permission granted successfully (audio-only fallback).");
        } catch (innerErr) {
          console.error("[Audio Debug] Microphone permission denied or failed:", innerErr);
          throw innerErr;
        }
      }

      console.log("[Audio Debug] getUserMedia successfully resolved. Stream ID:", stream.id);
      stream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          console.log("Audio track created");
          console.log(`[Audio Debug] Local audio track created: ID=${track.id}, Enabled=${track.enabled}, ReadyState=${track.readyState}`);
        } else {
          console.log(`[Audio Debug] Local video track created: ID=${track.id}, Enabled=${track.enabled}, ReadyState=${track.readyState}`);
        }
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      console.log("WebRTC stream created");

      // If peer connections exist, replace their tracks
      pcsRef.current.forEach((pc) => {
        stream.getTracks().forEach(track => {
          const senders = pc.getSenders();
          const sender = senders.find(s => s.track?.kind === track.kind);
          if (sender) {
            console.log("Track replaced");
            console.log(`[Audio Debug] Replacing track for kind ${track.kind} on existing connection`);
            sender.replaceTrack(track);
          } else {
            if (track.kind === 'audio') {
              console.log("Audio track added");
            }
            console.log("Track added to PeerConnection");
            console.log(`[Audio Debug] Adding new track for kind ${track.kind} on existing connection`);
            pc.addTrack(track, stream);
          }
        });
      });

      return stream;
    } catch (error) {
      console.error("[Audio Debug] Error accessing media devices:", error);
      return null;
    }
  };

  // Stop local video/audio stream
  const stopLocalStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  };

  // Toggle local mute
  const toggleMute = (mute: boolean) => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        console.log("Audio track found");
        track.enabled = !mute;
        if (mute) {
          console.log("Track disabled");
          console.log("✓ MediaStreamTrack disabled");
          console.log("MediaStreamTrack disabled");
          console.log("Audio track disabled");
        }
      });
    }
    // Explicitly disable/enable all audio tracks on all peer connection senders
    if (pcsRef.current) {
      pcsRef.current.forEach((pc, peerId) => {
        pc.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !mute;
            console.log(`[Audio Debug] Explicitly set enabled = ${!mute} on audio sender track for peer ${peerId}`);
          }
        });
      });
    }
  };

  // Toggle local camera
  const toggleCamera = (cameraOff: boolean) => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !cameraOff;
      });
    }
  };

  // Toggle Screen Share
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      setScreenStream(stream);

      // Replace video tracks on all peer connections
      const videoTrack = stream.getVideoTracks()[0];
      
      pcsRef.current.forEach((pc) => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender) {
          console.log("Track replaced");
          videoSender.replaceTrack(videoTrack);
        }
      });

      // Handle stream end (user clicked "Stop sharing" browser button)
      videoTrack.onended = () => {
        stopScreenShare();
        if (onScreenShareEnded) onScreenShareEnded();
      };

      return stream;
    } catch (error) {
      console.error("Error sharing screen:", error);
      return null;
    }
  };

  const stopScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }

    // Revert back to local video track
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      pcsRef.current.forEach((pc) => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender && videoTrack) {
          console.log("Track replaced");
          videoSender.replaceTrack(videoTrack);
        }
      });
    }
  };

  // Process queued ICE candidates for a peer connection
  const processIceQueue = async (targetUserId: string, pc: RTCPeerConnection) => {
    const queue = iceQueuesRef.current.get(targetUserId);
    if (queue && queue.length > 0) {
      console.log(`[Audio Debug] Processing ${queue.length} queued ICE candidates for ${targetUserId}`);
      for (const candidate of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log(`[Audio Debug] Successfully added queued ICE candidate for ${targetUserId}`);
        } catch (err) {
          console.error(`[Audio Debug] Error adding queued ICE candidate for ${targetUserId}:`, err);
        }
      }
      iceQueuesRef.current.set(targetUserId, []);
    }
  };

  // Initialize a new peer connection
  const createPeerConnection = (targetUserId: string, targetName: string, isOfferer: boolean) => {
    console.log(`[Audio Debug] Initializing peer connection for ${targetName} (${targetUserId}). Offerer: ${isOfferer}`);
    if (pcsRef.current.has(targetUserId)) {
      console.log(`[Audio Debug] Existing peer connection found for ${targetUserId}. Closing it first.`);
      pcsRef.current.get(targetUserId)?.close();
    }

    const pc = new RTCPeerConnection(iceServers);
    pcsRef.current.set(targetUserId, pc);

    // Monitor connection states
    pc.onconnectionstatechange = () => {
      console.log(`[Audio Debug] Connection state with ${targetName} (${targetUserId}) changed to: ${pc.connectionState}`);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Audio Debug] ICE connection state with ${targetName} (${targetUserId}) changed to: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected') {
        console.log("ICE connected");
      }
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.log("ICE disconnected");
        console.log("Audio interrupted");
        console.warn(`[Audio Debug] ICE connection lost/failed. Attempting ICE restart for ${targetName}...`);
        try {
          if (isOfferer) {
            pc.createOffer({ iceRestart: true }).then(async (offer) => {
              console.log("ICE reconnect");
              console.log(`[Audio Debug] Created ICE restart offer for ${targetName}`);
              console.log("Offer sent");
              await pc.setLocalDescription(offer);
              socket?.emit('webrtc-offer', { to: targetUserId, offer });
            }).catch(e => console.error("[Audio Debug] Error creating ICE restart offer:", e));
          }
        } catch (e) {
          console.error("[Audio Debug] ICE restart trigger failed:", e);
        }
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log("Audio recovered");
      }
    };

    // Add local tracks to peer connection
    const activeStream = screenStreamRef.current || localStreamRef.current;
    if (activeStream) {
      console.log(`[Audio Debug] Adding local tracks of stream ${activeStream.id} to ${targetName}'s peer connection`);
      activeStream.getTracks().forEach(track => {
        pc.addTrack(track, activeStream);
        if (track.kind === 'audio') {
          console.log("Audio track added");
          console.log("Track added to PeerConnection");
          console.log(`[Audio Debug] Audio track added to PeerConnection for ${targetName}: ID=${track.id}, Enabled=${track.enabled}`);
        } else {
          console.log(`[Audio Debug] Video track added to PeerConnection for ${targetName}: ID=${track.id}, Enabled=${track.enabled}`);
        }
      });
    } else {
      console.warn(`[Audio Debug] Cannot add local tracks. localStream is not ready yet for ${targetName}`);
    }

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        console.log(`[Audio Debug] Sending local ICE candidate to ${targetName}: Candidate=${event.candidate.candidate}`);
        socket.emit('ice-candidate', {
          to: targetUserId,
          candidate: event.candidate
        });
      }
    };

    // Receive remote tracks — directly map the browser's WebRTC-managed stream to React state.
    // Downstream elements will attach to it idempotently via a srcObject check in their ref callback.
    pc.ontrack = (event) => {
      const track = event.track;
      const remoteStream = event.streams[0];
      console.log(`[Audio Debug] Received remote track from ${targetName} (${targetUserId}). Kind=${track.kind}, ID=${track.id}`);
      if (track.kind === 'audio') {
        console.log("Remote track received");
        console.log(`[Audio Debug] Remote audio track received from ${targetName}: Enabled=${track.enabled}, ReadyState=${track.readyState}`);

        track.onmute = () => {
          console.log("Audio interruptions");
          console.log("Audio playback interrupted");
          console.warn(`[Audio Debug] Remote audio track muted/interrupted for ${targetName}`);
        };
        track.onunmute = () => {
          console.log("Audio recovered");
          console.log(`[Audio Debug] Remote audio track unmuted/recovered for ${targetName}`);
        };
      } else {
        console.log(`[Audio Debug] Remote video track received from ${targetName}: Enabled=${track.enabled}, ReadyState=${track.readyState}`);
      }

      if (remoteStream) {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(targetUserId, { stream: remoteStream, displayName: targetName });
          return next;
        });
      } else {
        console.warn(`[Audio Debug] No remote stream found for track ${track.id} from ${targetName}`);
      }
    };

    // If offerer, create negotiation offer
    if (isOfferer) {
      pc.onnegotiationneeded = async () => {
        try {
          console.log(`[Audio Debug] Negotiation needed with ${targetName}. Creating offer...`);
          const offer = await pc.createOffer();
          console.log(`[Audio Debug] Offer created for ${targetName}. Local description set.`);
          await pc.setLocalDescription(offer);
          if (socket) {
            console.log("Offer sent");
            socket.emit('webrtc-offer', {
              to: targetUserId,
              offer
            });
          }
        } catch (e) {
          console.error("Error creating WebRTC offer:", e);
        }
      };
    }

    return pc;
  };

  useEffect(() => {
    if (!socket) return;

    // Triggered when another admitted user joins
    socket.on('participant-joined', (data: { userId: string; displayName: string }) => {
      if (data.userId === userId) return;
      console.log(`[Audio Debug] Participant joined: ${data.displayName} (${data.userId}). Initiating offer...`);
      createPeerConnection(data.userId, data.displayName, true);
    });

    // Received WebRTC Offer
    socket.on('webrtc-offer', async (data: { from: string; fromName: string; offer: any }) => {
      console.log(`[Audio Debug] Received WebRTC offer from ${data.fromName} (${data.from})`);
      let pc = pcsRef.current.get(data.from);
      if (!pc) {
        pc = createPeerConnection(data.from, data.fromName, false);
      } else {
        console.log(`[Audio Debug] Reusing existing peer connection for offer from ${data.fromName}`);
      }
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log(`[Audio Debug] Set remote description success. Processing queued candidates for ${data.fromName}`);
        await processIceQueue(data.from, pc);

        console.log(`[Audio Debug] Creating answer for ${data.fromName}`);
        const answer = await pc.createAnswer();
        console.log(`[Audio Debug] Created answer for ${data.fromName}. Local description set.`);
        await pc.setLocalDescription(answer);
        
        socket.emit('webrtc-answer', {
          to: data.from,
          answer
        });
      } catch (err) {
        console.error("Error handling WebRTC offer:", err);
      }
    });

    // Received WebRTC Answer
    socket.on('webrtc-answer', async (data: { from: string; answer: any }) => {
      console.log("Answer received");
      console.log(`[Audio Debug] Received WebRTC answer from ${data.from}`);
      const pc = pcsRef.current.get(data.from);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`[Audio Debug] Set remote description (answer) success for ${data.from}. Processing queued candidates.`);
          await processIceQueue(data.from, pc);
        } catch (err) {
          console.error("Error setting WebRTC remote description (answer):", err);
        }
      } else {
        console.warn(`[Audio Debug] Received answer but no peer connection exists for ${data.from}`);
      }
    });

    // Received ICE Candidate
    socket.on('ice-candidate', async (data: { from: string; candidate: any }) => {
      console.log(`[Audio Debug] Received ICE candidate from ${data.from}`);
      const pc = pcsRef.current.get(data.from);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log(`[Audio Debug] Successfully added remote ICE candidate from ${data.from}`);
        } catch (err) {
          console.error("Error adding remote ICE candidate:", err);
        }
      } else {
        console.log(`[Audio Debug] Queueing ICE candidate from ${data.from} (remote description not set yet)`);
        if (!iceQueuesRef.current.has(data.from)) {
          iceQueuesRef.current.set(data.from, []);
        }
        iceQueuesRef.current.get(data.from)!.push(data.candidate);
      }
    });

    // User disconnected or kicked
    socket.on('participant-left', (data: { userId: string }) => {
      console.log(`[Audio Debug] Participant left room: ${data.userId}. Closing peer connection.`);
      if (pcsRef.current.has(data.userId)) {
        pcsRef.current.get(data.userId)?.close();
        pcsRef.current.delete(data.userId);
      }
      iceQueuesRef.current.delete(data.userId);
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
    });

    return () => {
      socket.off('participant-joined');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('ice-candidate');
      socket.off('participant-left');

      // Cleanup all peer connections on unmount
      pcsRef.current.forEach(pc => pc.close());
      pcsRef.current.clear();
      iceQueuesRef.current.clear();
      setRemoteStreams(new Map());
    };
  }, [socket, userId]);

  // ICE-state-based monitoring is already handled in createPeerConnection via
  // oniceconnectionstatechange. A separate getStats() polling loop is intentionally
  // omitted: calling getStats() every 3s on all peer connections adds scheduling
  // jitter that can contribute to audio glitches on constrained systems.

  return {
    localStream,
    screenStream,
    remoteStreams,
    startLocalStream,
    stopLocalStream,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare
  };
}
