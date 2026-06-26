import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWebRTC } from '../hooks/useWebRTC';
import { useAudio } from '../hooks/useAudio';
import AIPanel from './AIPanel';
import { 
  Mic, MicOff, Video, VideoOff, Monitor, StopCircle, 
  Hand, MessageSquare, ShieldAlert, X, Check, Lock, Unlock, 
  Trash2, VolumeX, ShieldCheck, PlayCircle
} from 'lucide-react';

interface ClassroomProps {
  token: string;
  user: any;
  meetingId: string;
  onLeaveMeeting: (reportId: string | null) => void;
  initialMicActive?: boolean;
  initialCameraActive?: boolean;
}

export default function Classroom({ 
  token, 
  user, 
  meetingId, 
  onLeaveMeeting,
  initialMicActive = true,
  initialCameraActive = true
}: ClassroomProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [admitted, setAdmitted] = useState<boolean>(false);
  const [waitingStatus, setWaitingStatus] = useState<string>('Connecting...');
  
  // Audio/Video control states
  const [micActive, setMicActive] = useState<boolean>(initialMicActive);
  const [cameraActive, setCameraActive] = useState<boolean>(initialCameraActive);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [handRaised, setHandRaised] = useState<boolean>(false);
  
  // New Google Meet style UI states
  const [flyingEmojis, setFlyingEmojis] = useState<Array<{ id: number; emoji: string }>>([]);
  const [reactionsOpen, setReactionsOpen] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  
  // UI states
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  
  // Host state
  const [locked, setLocked] = useState<boolean>(false);
  const [autoMuteNoise, setAutoMuteNoise] = useState<boolean>(false);
  const [waitingRequests, setWaitingRequests] = useState<any[]>([]);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [liveTranscript, setLiveTranscript] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'controls'>('chat');

  // AI Q&A and Timeline states
  const [questions, setQuestions] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);

  const fetchQuestions = async () => {
    try {
      const res = await fetch(`/meetings/${meetingId}/questions`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.questions) setQuestions(data.questions);
    } catch (err) {
      console.error("Error fetching questions:", err);
    }
  };

  const fetchTimeline = async () => {
    try {
      const res = await fetch(`/meetings/${meetingId}/timeline`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.timeline) setTimeline(data.timeline);
    } catch (err) {
      console.error("Error fetching timeline:", err);
    }
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Clock utility
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      setCurrentTime(`${hours}:${minutes} ${ampm}`);
    };
    updateClock();
    const interval = setInterval(updateClock, 15000);
    return () => clearInterval(interval);
  }, []);

  // Initialize socket connection
  useEffect(() => {
    const backendUrl = window.location.origin; // Proxied by Vite server config
    const socketInstance = io(backendUrl, {
      auth: { token, meetingId }
    });

    setSocket(socketInstance);

    // Socket global listeners
    socketInstance.on('connect_error', (err) => {
      setWaitingStatus(`Connection error: ${err.message}`);
    });

    socketInstance.on('error-message', (msg) => {
      alert(msg);
      onLeaveMeeting(null);
    });

    socketInstance.on('waiting-room-status', (data: { status: string; message: string }) => {
      setAdmitted(false);
      setWaitingStatus(data.message);
    });

    socketInstance.on('room-joined', (data: { role: string; status: string; autoMuteOnNoise?: boolean }) => {
      if (data.status === 'admitted') {
        setAdmitted(true);
        if (data.autoMuteOnNoise !== undefined) {
          setAutoMuteNoise(data.autoMuteOnNoise);
        }
      }
    });

    socketInstance.on('room-lock-status', (data: { locked: boolean }) => {
      setLocked(data.locked);
    });

     socketInstance.on('host-mute-status', (data: { mute: boolean; reason: string }) => {
      toggleMute(data.mute);
      setMicActive(!data.mute);
      setTimeout(() => {
        alert(data.reason);
      }, 100);
    });

    socketInstance.on('forceMuteParticipant', (data: { userId: string; mute: boolean; reason: string }) => {
      console.log("✓ Student received forceMuteParticipant");
      console.log("✓ forceMuteParticipant received");
      console.log("Student received forceMuteParticipant");
      if (data.userId === user.id) {
        console.log("Participant ID matched");
        toggleMute(data.mute);
        setMicActive(!data.mute);
        if (data.mute) {
          console.log("✓ Audio transmission stopped");
          console.log("Audio transmission stopped");
          console.log("Student muted");
        }
        console.log("Microphone state updated");
        setTimeout(() => {
          alert(data.reason);
        }, 100);
      } else {
        console.warn("Participant ID mismatch:", data.userId, "expected:", user.id);
      }
    });

    socketInstance.on('host-camera-status', (data: { disable: boolean }) => {
      setCameraActive(!data.disable);
      setTimeout(() => {
        alert(data.disable ? 'Your camera was disabled by the teacher.' : 'Your camera was enabled by the teacher.');
      }, 50);
    });

    socketInstance.on('participant-status-updated', (data: { userId: string; isMuted?: boolean; isCameraOff?: boolean; autoMuted?: boolean; warningSent?: boolean }) => {
      if (user.role === 'teacher' && data.isMuted === true) {
        console.log("Teacher received mute update");
      }
      setTelemetry((prev: any) => {
        if (!prev) return prev;
        
        const updatedAllStudents = prev.allStudents?.map((student: any) => {
          if (student.userId === data.userId) {
            return {
              ...student,
              ...(data.isMuted !== undefined ? { isMuted: data.isMuted } : {}),
              ...(data.isCameraOff !== undefined ? { isCameraOff: data.isCameraOff } : {}),
              ...(data.autoMuted !== undefined ? { autoMuted: data.autoMuted } : {}),
            };
          }
          return student;
        });

        const updatedActiveStudents = prev.activeStudents?.map((student: any) => {
          if (student.userId === data.userId) {
            return {
              ...student,
              ...(data.isMuted !== undefined ? { isMuted: data.isMuted } : {}),
              ...(data.isCameraOff !== undefined ? { isCameraOff: data.isCameraOff } : {}),
              ...(data.autoMuted !== undefined ? { autoMuted: data.autoMuted } : {}),
            };
          }
          return student;
        });

        const updatedNoiseDetection = prev.noiseDetection?.map((item: any) => {
          if (item.userId === data.userId) {
            return {
              ...item,
              ...(data.autoMuted !== undefined ? { autoMutedStatus: data.autoMuted ? 'Muted by AI' : 'Active' } : {}),
              ...(data.warningSent !== undefined ? { warningStatus: data.warningSent ? 'Warning Issued' : 'None' } : {}),
            };
          }
          return item;
        });

        return {
          ...prev,
          allStudents: updatedAllStudents,
          activeStudents: updatedActiveStudents,
          noiseDetection: updatedNoiseDetection,
        };
      });
      console.log("✓ Dashboard updated");
      console.log("Teacher dashboard updated");
      console.log("Dashboard updated");
    });

    socketInstance.on('noise-warning', (data: { message: string }) => {
      alert(data.message);
    });

    socketInstance.on('kicked', (data: { message: string }) => {
      alert(data.message);
      onLeaveMeeting(null);
    });

    socketInstance.on('meeting-ended', (data: { reportId: string }) => {
      alert('The teacher has ended this classroom session.');
      onLeaveMeeting(data.reportId);
    });

    socketInstance.on('chat-message-received', (msg: any) => {
      setChatMessages(prev => [...prev, msg]);
    });

    // Host telemetry updates
    socketInstance.on('waiting-requests-list', (list: any[]) => {
      setWaitingRequests(list);
    });

    socketInstance.on('ai-dashboard-telemetry', (data: any) => {
      setTelemetry(data);
      console.log("✓ Dashboard updated");
      console.log("Teacher dashboard updated");
      console.log("Dashboard updated");
    });

    socketInstance.on('new-transcript-line', (line: any) => {
      setLiveTranscript(prev => [...prev, line]);
    });

    socketInstance.on('questions-updated', () => {
      fetchQuestions();
    });

    socketInstance.on('timeline-event-added', (newEvent: any) => {
      setTimeline(prev => [...prev, newEvent]);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [token, meetingId]);

  // Emoji reaction listener
  useEffect(() => {
    if (!socket) return;
    
    socket.on('emoji-received', (data: { userId: string; userName: string; emoji: string }) => {
      const id = Date.now() + Math.random();
      setFlyingEmojis(prev => [...prev, { id, emoji: data.emoji }]);
      setTimeout(() => {
        setFlyingEmojis(prev => prev.filter(e => e.id !== id));
      }, 3000);
    });

    return () => {
      socket.off('emoji-received');
    };
  }, [socket]);

  const handleSendEmoji = (emoji: string) => {
    socket?.emit('send-emoji', { emoji });
    setReactionsOpen(false);
  };

  // WebRTC Mesh Call Setup Hook

  const {
    localStream,
    screenStream,
    remoteStreams,
    startLocalStream,
    stopLocalStream,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare
  } = useWebRTC({
    socket,
    meetingId,
    userId: user.id,
    displayName: user.name,
    onScreenShareEnded: () => {
      setIsScreenSharing(false);
      if (socket) {
        socket.emit('participant-screenshare-toggle', { isScreensharing: false });
      }
    }
  });

  // Audio analysis Hook
  const { isSpeaking } = useAudio({
    socket,
    localStream,
    role: user.role,
    isMuted: !micActive
  });



  // Start media devices once admitted
  useEffect(() => {
    if (admitted) {
      console.log("[Audio Debug] startLocalStream initiated. Camera:", cameraActive, "Mic:", micActive);
      startLocalStream(cameraActive, micActive).then(stream => {
        if (stream && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log("[Audio Debug] startLocalStream completed. Stream attached to local video element.");
        }
        // Force track states to match state variables immediately
        toggleMute(!micActive);
        toggleCamera(!cameraActive);

        if (socket) {
          console.log("[Audio Debug] Emitting participant-ready to server.");
          socket.emit('participant-ready');
        }
      });
    } else {
      stopLocalStream();
    }
    return () => {
      stopLocalStream();
    };
  }, [admitted, socket]);

  // Apply mute/camera toggles to stream tracks
  useEffect(() => {
    toggleMute(!micActive);
  }, [micActive]);

  useEffect(() => {
    toggleCamera(!cameraActive);
  }, [cameraActive]);

  // Synchronize mic/camera active toggles to backend
  useEffect(() => {
    if (socket && admitted) {
      socket.emit('participant-device-toggle', {
        isMuted: !micActive,
        isCameraOff: !cameraActive
      });
    }
  }, [micActive, cameraActive, socket, admitted]);

  // Fetch initial questions and timeline logs for teachers
  useEffect(() => {
    if (admitted && user.role === 'teacher') {
      fetchQuestions();
      fetchTimeline();
    }
  }, [admitted, user.role]);

  // Sync hand raise to server
  const handleToggleHand = () => {
    const nextHand = !handRaised;
    setHandRaised(nextHand);
    if (socket) {
      socket.emit('raise-hand', { raised: nextHand });
    }
  };

  // Screen sharing toggle
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      setIsScreenSharing(false);
    } else {
      const stream = await startScreenShare();
      if (stream) {
        setIsScreenSharing(true);
        // Bind local sharing preview if wanted, or screen stream binds to peers
      }
    }
  };

  // Scroll chat messages to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket) return;

    socket.emit('send-chat-message', { message: chatInput });
    setChatInput('');
  };

  // Host classroom controls
  const handleToggleLock = () => {
    const nextLock = !locked;
    setLocked(nextLock);
    socket?.emit('toggle-lock-room', { locked: nextLock });
  };

  const handleToggleAutoMuteNoise = () => {
    const nextAuto = !autoMuteNoise;
    setAutoMuteNoise(nextAuto);
    socket?.emit('toggle-auto-mute-noise', { autoMute: nextAuto });
  };

  const handleMuteAll = () => {
    socket?.emit('host-mute-all');
  };

  const handleDisableAllCameras = () => {
    socket?.emit('host-disable-all-cameras');
  };

  const handleAdmitStudent = (studentId: string) => {
    socket?.emit('approve-join-request', { userId: studentId });
  };

  const handleRejectStudent = (studentId: string) => {
    socket?.emit('reject-join-request', { userId: studentId });
  };

  const handleMuteStudent = (studentId: string, currentMute: boolean) => {
    socket?.emit('host-mute-user', { userId: studentId, mute: !currentMute });
  };

  const handleCameraStudent = (studentId: string, currentCameraOff: boolean) => {
    socket?.emit('host-disable-camera-user', { userId: studentId, disable: !currentCameraOff });
  };

  const handleKickStudent = (studentId: string) => {
    if (confirm("Are you sure you want to remove this student from the classroom?")) {
      socket?.emit('host-remove-user', { userId: studentId });
    }
  };

  const handleEndMeeting = () => {
    if (confirm("Are you sure you want to end this classroom session? This will log out all students and compile the AI Performance Report.")) {
      socket?.emit('end-meeting');
    }
  };

  const handleLeaveMeeting = () => {
    socket?.disconnect();
    onLeaveMeeting(null);
  };

  // waiting room view
  if (!admitted) {
    return (
      <div className="waiting-room-overlay">
        <div className="waiting-room-card glass-panel">
          <div className="loader-circle"></div>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '20px', marginBottom: '10px' }}>
            Classroom Waiting Room
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            {waitingStatus}
          </p>
          <button className="btn btn-danger" onClick={handleLeaveMeeting}>
            Cancel request
          </button>
        </div>
      </div>
    );
  }

  // Get active participant lists
  const currentParticipants: any[] = [];
  const participantsSource = telemetry?.allStudents || telemetry?.activeStudents;
  if (participantsSource) {
    participantsSource.forEach((student: any) => {
      // Find WebRTC streaming status if available
      const remote = remoteStreams.get(student.userId);
      currentParticipants.push({
        userId: student.userId,
        name: student.name,
        speakingTime: student.speakingTime,
        score: student.participationScore,
        stream: remote?.stream || null,
        isMuted: student.isMuted || false
      });
    });
  }

  // Determine grid size classes for responsive CSS layout
  const peerCount = remoteStreams.size + 1; // peers + self
  let gridLayoutClass = 'grid-1-peer';
  if (peerCount === 2) gridLayoutClass = 'grid-2-peers';
  else if (peerCount === 3) gridLayoutClass = 'grid-3-peers';
  else if (peerCount === 4) gridLayoutClass = 'grid-4-peers';
  else if (peerCount >= 5) gridLayoutClass = 'grid-5-peers';

  return (
    <div className={`classroom-grid ${user.role === 'teacher' ? 'with-sidebar' : ''} ${chatOpen && user.role === 'teacher' ? 'chat-active' : ''}`}>
      
      {/* 1. Main Classroom Feed */}
      <div className="classroom-main">
        
        {/* Top-Left Google Meet Metadata Overlay */}
        <div className="meeting-info-overlay">
          <span>{currentTime}</span>
          <span className="metadata-separator">|</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{meetingId}</span>
          <button 
            className="metadata-copy-btn"
            onClick={() => {
              const inviteUrl = `${window.location.origin}/room/${meetingId}`;
              navigator.clipboard.writeText(inviteUrl);
              alert("Shareable classroom link copied to clipboard!");
            }}
          >
            Copy Link
          </button>
        </div>

        {/* Flying Emojis Overlay */}
        <div className="flying-emojis-container">
          {flyingEmojis.map(e => (
            <div className="flying-emoji" key={e.id}>
              {e.emoji}
            </div>
          ))}
        </div>
        
        {/* Admitting Join Requests Alert Panel for Teachers */}
        {user.role === 'teacher' && waitingRequests.length > 0 && (
          <div className="requests-modal glass-panel animate-scale-in">
            <h4 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={14} color="var(--warning)" /> Join Requests ({waitingRequests.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {waitingRequests.map(req => (
                <div className="request-row" key={req.userId}>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>{req.name}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleAdmitStudent(req.userId)}>
                      <Check size={12} /> Admit
                    </button>
                    <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => handleRejectStudent(req.userId)}>
                      <X size={12} /> Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Video streams */}
        <div className="streams-container">
          <div className={`video-grid ${gridLayoutClass}`}>
            
            {/* Local participant stream */}
            <div className={`video-box ${isSpeaking ? 'speaking' : ''}`}>
              {cameraActive ? (
                <video ref={localVideoRef} className="video-element" autoPlay playsInline muted />
              ) : (
                <div className="video-placeholder">
                  <div className="video-avatar">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span>{user.name} (You)</span>
                </div>
              )}
              
              <div className="video-overlay-info">
                <span>{user.name} ({user.role})</span>
                <div className="indicator-badge">
                  {!micActive && <MicOff size={14} color="var(--danger)" />}
                  {handRaised && <span className="hand-badge">✋</span>}
                </div>
              </div>
            </div>

            {/* Remote participants streams */}
            {Array.from(remoteStreams.entries()).map(([peerId, peer]) => {
              // Find matching participant states from telemetry
              const participantState = (telemetry?.allStudents || telemetry?.activeStudents)?.find((s: any) => s.userId === peerId);
              const isPeerHandRaised = telemetry?.raisedHands?.find((h: any) => h.userId === peerId);
              const isPeerMuted = participantState?.isMuted || false;

              return (
                <div className="video-box" key={peerId}>
                  <video 
                    className="video-element"
                    autoPlay 
                    playsInline 
                    muted={true}
                    ref={el => {
                      if (el && peer.stream) {
                        if (el.srcObject !== peer.stream) {
                          el.srcObject = peer.stream;
                        }
                      }
                    }} 
                  />

                  <audio
                    autoPlay
                    playsInline
                    style={{ display: 'block', width: '1px', height: '1px', opacity: 0, position: 'absolute', pointerEvents: 'none' }}
                    ref={el => {
                      if (el && peer.stream) {
                        if (el.srcObject !== peer.stream) {
                          el.srcObject = peer.stream;
                          el.volume = 1.0;
                          console.log(`[Audio Playback] Attaching remote audio stream for ${peer.displayName}`);
                          el.play().catch(err => {
                            console.warn(`[Audio Playback] Autoplay blocked for ${peer.displayName}:`, err);
                          });
                        }
                      }
                    }}
                  />


                  <div className="video-overlay-info">
                    <span>{peer.displayName}</span>
                    <div className="indicator-badge">
                      {isPeerMuted && <MicOff size={14} color="var(--danger)" />}
                      {isPeerHandRaised && <span className="hand-badge">✋</span>}
                    </div>
                  </div>
                </div>
              );
            })}

          </div>
        </div>

        {/* Real-time classroom streams automatically monitored */}

        {/* Meeting Controls Bar */}
        <div className="controls-bar glass-panel">
          <div className="controls-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="meeting-title-info">
              Classroom Code: <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{meetingId}</span>
            </div>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '6px 12px', fontSize: '11px', height: '30px' }}
              onClick={() => {
                navigator.clipboard.writeText(meetingId);
                alert("Classroom Code copied to clipboard!");
              }}
            >
              Copy Code
            </button>
          </div>

          <div className="controls-center">
            {/* Mic toggle */}
            <button 
              className={`btn btn-icon ${micActive ? 'active' : 'danger-active'}`} 
              onClick={() => setMicActive(!micActive)}
              title={micActive ? "Mute Microphone" : "Unmute Microphone"}
            >
              {micActive ? <Mic size={18} /> : <MicOff size={18} />}
            </button>

            {/* Camera toggle */}
            <button 
              className={`btn btn-icon ${cameraActive ? 'active' : 'danger-active'}`} 
              onClick={() => setCameraActive(!cameraActive)}
              title={cameraActive ? "Turn Camera Off" : "Turn Camera On"}
            >
              {cameraActive ? <Video size={18} /> : <VideoOff size={18} />}
            </button>

            {/* Screen share toggle */}
            <button 
              className={`btn btn-icon ${isScreenSharing ? 'active' : ''}`} 
              onClick={handleToggleScreenShare}
              title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
            >
              <Monitor size={18} />
            </button>

            {/* Student hand raise */}
            {user.role === 'student' && (
              <button 
                className={`btn btn-icon ${handRaised ? 'active' : ''}`} 
                onClick={handleToggleHand}
                title="Raise Hand"
              >
                <Hand size={18} />
              </button>
            )}

            {/* Reactions Trigger Button */}
            <div style={{ position: 'relative' }}>
              <button 
                className={`btn btn-icon ${reactionsOpen ? 'active' : ''}`} 
                onClick={() => setReactionsOpen(!reactionsOpen)}
                title="Send Reaction"
              >
                <span style={{ fontSize: '18px', lineHeight: 1 }}>😊</span>
              </button>
              
              {reactionsOpen && (
                <div className="reactions-picker glass-panel animate-scale-in">
                  {['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔', '👎'].map(emoji => (
                    <button 
                      key={emoji} 
                      className="reaction-picker-btn" 
                      onClick={() => handleSendEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chat sidebar toggle */}
            <button 
              className={`btn btn-icon ${chatOpen ? 'active' : ''}`} 
              onClick={() => setChatOpen(!chatOpen)}
              title="Toggle Classroom Chat"
            >
              <MessageSquare size={18} />
            </button>
          </div>

          <div className="controls-right">
            {user.role === 'teacher' ? (
              <button className="btn btn-danger" style={{ borderRadius: '30px', padding: '10px 24px' }} onClick={handleEndMeeting}>
                End Meeting
              </button>
            ) : (
              <button className="btn btn-danger" style={{ borderRadius: '30px', padding: '10px 24px' }} onClick={handleLeaveMeeting}>
                Leave Class
              </button>
            )}
          </div>
        </div>

      </div>

      {/* 2. Host and Chat panels (Right side tabs for teacher, overlay chat for student) */}
      
      {/* Teacher Layout: Split layout (Left: Meeting, Right: Fixed AI Panel + Toggleable Chat/Controls Sidebar) */}
      {user.role === 'teacher' && (
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
          
          {/* Toggleable Chat/Controls Sidebar */}
          {chatOpen && (
            <div className="right-sidebar" style={{ borderRight: '1px solid var(--border-color)', width: '320px' }}>
              <div className="sidebar-tabs">
                <div 
                  className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setActiveTab('chat')}
                >
                  Chat
                </div>
                <div 
                  className={`sidebar-tab ${activeTab === 'controls' ? 'active' : ''}`}
                  onClick={() => setActiveTab('controls')}
                >
                  Controls
                </div>
              </div>

              <div className="sidebar-content">
                {activeTab === 'chat' ? (
                  <div className="chat-container">
                    <div className="chat-messages">
                      {chatMessages.map((msg, idx) => (
                        <div className={`chat-bubble ${msg.userId === user.id ? 'own' : ''}`} key={idx}>
                          <div className="chat-sender">{msg.userName} ({msg.userRole})</div>
                          <div>{msg.message}</div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                    <form className="chat-input-area" onSubmit={handleSendChat}>
                      <input 
                        type="text" 
                        className="chat-input"
                        placeholder="Send message to class..."
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                      />
                      <button type="submit" className="btn btn-primary" style={{ padding: '8px 14px' }}>
                        Send
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="host-controls-container">
                    
                    {/* General Room Toggles */}
                    <div>
                      <h4 className="section-title">Classroom Settings</h4>
                      <div className="control-card">
                        <div className="control-row">
                          <span style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Lock size={14} /> Lock Classroom
                          </span>
                          <label className="toggle-switch">
                            <input type="checkbox" checked={locked} onChange={handleToggleLock} />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                        <div className="control-row">
                          <span style={{ fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <VolumeX size={14} /> AI Auto-Mute on Noise
                          </span>
                          <label className="toggle-switch">
                            <input type="checkbox" checked={autoMuteNoise} onChange={handleToggleAutoMuteNoise} />
                            <span className="toggle-slider"></span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Bulk controls */}
                    <div>
                      <h4 className="section-title">Bulk Actions</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={handleMuteAll}>
                          Mute All Students
                        </button>
                        <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={handleDisableAllCameras}>
                          Disable All Cams
                        </button>
                      </div>
                    </div>

                    {/* Participant List */}
                    <div>
                      <h4 className="section-title">Active Students</h4>
                      <div className="participants-list-scroll">
                        {(telemetry?.allStudents || telemetry?.activeStudents)?.map((student: any) => {
                          const isMuted = student.isMuted || false;
                          return (
                            <div className="participant-item" key={student.userId}>
                              <span className="participant-name-tag">
                                {student.name}
                                {student.autoMuted && (
                                  <span style={{ fontSize: '10px', color: 'var(--danger)', marginLeft: '6px', fontWeight: 600 }}>
                                    (Muted by AI)
                                  </span>
                                )}
                              </span>
                              <div className="participant-actions">
                                <button 
                                  className={`btn btn-icon ${isMuted ? 'danger-active' : ''}`}
                                  style={{ width: '28px', height: '28px' }}
                                  onClick={() => handleMuteStudent(student.userId, isMuted)}
                                >
                                  {isMuted ? <MicOff size={12} /> : <Mic size={12} />}
                                </button>
                                <button 
                                  className="btn btn-icon danger-active"
                                  style={{ width: '28px', height: '28px' }}
                                  onClick={() => handleKickStudent(student.userId)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Real-time lecture transcripts */}
                    <div>
                      <h4 className="section-title">Verbal Transcripts Feed</h4>
                      <div className="transcript-box" style={{ maxHeight: '180px', background: 'var(--bg-secondary)', padding: '10px', fontSize: '11px' }}>
                        {liveTranscript.map((t, idx) => (
                          <div key={idx} style={{ marginBottom: '6px' }}>
                            <strong>{t.speakerName}:</strong> {t.text}
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

          {/* Teacher AI Dashboard Sidebar (Fixed right sidebar) */}
          <div className="right-sidebar" style={{ width: '380px', flexShrink: 0 }}>
            <div className="sidebar-tabs" style={{ background: 'var(--accent-light)', borderBottom: '1px solid var(--border-color)' }}>
              <div className="sidebar-tab active" style={{ color: 'var(--accent)', cursor: 'default' }}>
                🧠 AI Assistant Dashboard
              </div>
            </div>
            <AIPanel telemetry={telemetry} questions={questions} timeline={timeline} />
          </div>

        </div>
      )}

      {/* Student Layout: Floating Overlay Chat Panel */}
      {user.role === 'student' && chatOpen && (
        <div className="glass-panel" style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          bottom: '104px',
          width: '320px',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 50,
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span style={{ fontWeight: 600, fontSize: '14px' }}>Classroom Chat</span>
            <button className="btn btn-icon" style={{ width: '24px', height: '24px', border: 'none' }} onClick={() => setChatOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="chat-container" style={{ flex: 1, overflow: 'hidden' }}>
            <div className="chat-messages" style={{ maxHeight: 'calc(100% - 60px)' }}>
              {chatMessages.map((msg, idx) => (
                <div className={`chat-bubble ${msg.userId === user.id ? 'own' : ''}`} key={idx}>
                  <div className="chat-sender">{msg.userName}</div>
                  <div>{msg.message}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form className="chat-input-area" onSubmit={handleSendChat}>
              <input 
                type="text" 
                className="chat-input"
                placeholder="Message class..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '8px 14px' }}>
                Send
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
