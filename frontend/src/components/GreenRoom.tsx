import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, ShieldAlert, LogIn, Play } from 'lucide-react';

interface GreenRoomProps {
  meetingId: string;
  user: any;
  onJoin: (micActive: boolean, cameraActive: boolean) => void;
  onLeave: () => void;
}

export default function GreenRoom({ meetingId, user, onJoin, onLeave }: GreenRoomProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micActive, setMicActive] = useState<boolean>(true);
  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState<string>('Loading Classroom...');
  
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load meeting details
  useEffect(() => {
    fetch(`/api/meetings/${meetingId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        setMeetingTitle(data.meeting.title);
      })
      .catch(() => {
        setMeetingTitle('Live Online Lesson');
      });
  }, [meetingId]);

  // Request media permissions and update video element
  useEffect(() => {
    let activeStream: MediaStream | null = null;

    async function initializeMedia() {
      try {
        setPermissionError(null);
        if (activeStream) {
          activeStream.getTracks().forEach(track => track.stop());
        }

        // If both are toggled off, don't request media
        if (!cameraActive && !micActive) {
          setStream(null);
          return;
        }

        const constraints = {
          video: cameraActive ? { width: 640, height: 480 } : false,
          audio: micActive
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current && cameraActive) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: any) {
        console.error("Green Room media access error:", err);
        setPermissionError(
          "Camera or Microphone permissions were blocked. Click the lock/settings icon next to the address bar to allow permissions, then refresh."
        );
      }
    }

    initializeMedia();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [micActive, cameraActive]);

  const handleJoinClick = () => {
    // Stop local green room stream tracks before transitioning
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    onJoin(micActive, cameraActive);
  };

  return (
    <div className="auth-wrapper" style={{ minHeight: 'auto', height: '100%' }}>
      <div className="auth-card glass-panel" style={{ maxWidth: '800px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px', padding: '32px' }}>
        
        {/* Left: Video Preview Window */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="green-room-video-container" style={{
            width: '100%',
            aspectRatio: '4/3',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-color)',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {cameraActive && !permissionError ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
            ) : (
              <div className="video-placeholder">
                <div className="video-avatar" style={{ width: '96px', height: '96px', fontSize: '36px' }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Camera is Off</span>
              </div>
            )}

            {/* Overlaid quick toggle buttons */}
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '12px',
              zIndex: 10,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(8px)',
              padding: '8px 16px',
              borderRadius: '30px'
            }}>
              <button 
                className={`btn btn-icon ${micActive ? 'active' : 'danger-active'}`} 
                style={{ width: '40px', height: '40px' }}
                onClick={() => setMicActive(m => !m)}
                title={micActive ? "Mute Microphone" : "Unmute Microphone"}
              >
                {micActive ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
              <button 
                className={`btn btn-icon ${cameraActive ? 'active' : 'danger-active'}`} 
                style={{ width: '40px', height: '40px' }}
                onClick={() => setCameraActive(c => !c)}
                title={cameraActive ? "Turn Camera Off" : "Turn Camera On"}
              >
                {cameraActive ? <Video size={16} /> : <VideoOff size={16} />}
              </button>
            </div>
          </div>

          {permissionError && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '12px',
              background: 'var(--danger-light)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius)',
              color: 'var(--danger)',
              fontSize: '13px',
              fontWeight: 500
            }}>
              <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{permissionError}</div>
            </div>
          )}
        </div>

        {/* Right: Joining Action Details */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '20px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
              Green Room Preview
            </div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '24px', letterSpacing: '-0.5px', marginBottom: '8px', lineHeight: '1.2' }}>
              {meetingTitle}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Join as <strong style={{ color: 'var(--text-primary)' }}>{user.name}</strong> ({user.role})
            </p>
          </div>

          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius)',
            padding: '14px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Room ID:</span>
              <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{meetingId}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Audio status:</span>
              <strong style={{ color: micActive ? 'var(--success)' : 'var(--danger)' }}>{micActive ? 'Active' : 'Muted'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Video status:</span>
              <strong style={{ color: cameraActive ? 'var(--success)' : 'var(--danger)' }}>{cameraActive ? 'Active' : 'Off'}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn btn-secondary" 
              style={{ flex: 1, padding: '12px' }}
              onClick={onLeave}
            >
              Back to Lobby
            </button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 1.5, padding: '12px' }}
              onClick={handleJoinClick}
            >
              {user.role === 'teacher' ? (
                <>
                  <Play size={16} /> Start Class
                </>
              ) : (
                <>
                  <LogIn size={16} /> Request to Join
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
