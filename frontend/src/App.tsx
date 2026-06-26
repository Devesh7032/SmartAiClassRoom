import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import GreenRoom from './components/GreenRoom';
import Classroom from './components/Classroom';
import ReportView from './components/ReportView';
import { LogOut, Plus, LogIn, Sun, Moon } from 'lucide-react';

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(null);
  const [meetingId, setMeetingId] = useState<string>('');
  const [meetingTitle, setMeetingTitle] = useState<string>('');
  const [view, setView] = useState<'auth' | 'lobby' | 'greenroom' | 'classroom' | 'report'>('auth');
  const [reportMeetingId, setReportMeetingId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [initialMicActive, setInitialMicActive] = useState<boolean>(true);
  const [initialCameraActive, setInitialCameraActive] = useState<boolean>(true);

  // Initialize theme
  useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-mode' : 'light-mode';
  }, [theme]);

  // Decode user details from JWT token
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then(data => {
          setUser(data.user);
          
          // Route immediately to greenroom if room URL is present on boot
          const path = window.location.pathname;
          if (path.startsWith('/room/')) {
            const targetId = path.substring(6);
            if (targetId) {
              setMeetingId(targetId);
              setView('greenroom');
              return;
            }
          }
          setView('lobby');
        })
        .catch(() => {
          handleLogout();
        });
    } else {
      setView('auth');
      setUser(null);
    }
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setView('auth');
    window.history.pushState({}, '', '/');
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingTitle) return;

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: meetingTitle })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMeetingId(data.meeting.id);
      window.history.pushState({}, '', `/room/${data.meeting.id}`);
      setView('greenroom');
    } catch (err: any) {
      alert(err.message || 'Failed to create meeting');
    }
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingId) return;

    // Handle full URLs pasted in
    let cleanedId = meetingId;
    if (meetingId.includes('/')) {
      const parts = meetingId.split('/');
      cleanedId = parts[parts.length - 1];
    }
    
    setMeetingId(cleanedId);
    window.history.pushState({}, '', `/room/${cleanedId}`);
    setView('greenroom');
  };

  return (
    <div className="app-container">
      {/* Header controls bar */}
      <header className="glass-panel" style={{
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        borderBottom: '1px solid var(--border-color)',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>🎓</span>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '18px', letterSpacing: '-0.5px' }}>
            SmartClass <span style={{ color: 'var(--accent)' }}>AI</span>
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Theme Toggle */}
          <button className="btn btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle Light/Dark Theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{user.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase' }}>
                  {user.role}
                </div>
              </div>
              <button className="btn btn-icon danger-active" onClick={handleLogout} title="Log Out">
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main app panel views */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {view === 'auth' && (
          <Auth setToken={setToken} />
        )}

        {view === 'lobby' && user && (
          <div className="auth-wrapper" style={{ minHeight: 'auto', height: '100%' }}>
            <div className="auth-card glass-panel" style={{ maxWidth: '640px' }}>
              <div className="auth-header" style={{ marginBottom: '24px' }}>
                <h2 className="auth-title">Welcome to SmartClass AI Dashboard</h2>
                <p className="auth-subtitle">Create, schedule, or join online classroom meetings instantly.</p>
              </div>

              {user.role === 'teacher' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  {/* Teacher: Create Section */}
                  <div className="control-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px' }}>
                      Start New Classroom
                    </h3>
                    <form onSubmit={handleCreateMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Lesson Title</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g., Mathematics - Algebra 101"
                          value={meetingTitle}
                          onChange={e => setMeetingTitle(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                        <Plus size={16} /> Create Classroom
                      </button>
                    </form>
                  </div>

                  {/* Teacher: Join Section */}
                  <div className="control-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px' }}>
                      Join Existing Classroom
                    </h3>
                    <form onSubmit={handleJoinMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Meeting Code / URL</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Paste meeting code here..."
                          value={meetingId}
                          onChange={e => setMeetingId(e.target.value)}
                          required
                        />
                      </div>
                      <button type="submit" className="btn btn-secondary" style={{ width: '100%' }}>
                        <LogIn size={16} /> Join Lesson
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                // Student: Join Section
                <div className="control-card" style={{ maxWidth: '400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px', textAlign: 'center' }}>
                    Join Class Session
                  </h3>
                  <form onSubmit={handleJoinMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Classroom Code / Invite Link</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Paste classroom ID..."
                        value={meetingId}
                        onChange={e => setMeetingId(e.target.value)}
                        required
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                      <LogIn size={16} /> Request Admission
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'greenroom' && token && user && (
          <GreenRoom
            meetingId={meetingId}
            user={user}
            onJoin={(mic, cam) => {
              setInitialMicActive(mic);
              setInitialCameraActive(cam);
              setView('classroom');
            }}
            onLeave={() => {
              setView('lobby');
              window.history.pushState({}, '', '/');
            }}
          />
        )}

        {view === 'classroom' && token && user && (
          <Classroom
            token={token}
            user={user}
            meetingId={meetingId}
            initialMicActive={initialMicActive}
            initialCameraActive={initialCameraActive}
            onLeaveMeeting={(reportId) => {
              window.history.pushState({}, '', '/');
              if (reportId && user.role === 'teacher') {
                setReportMeetingId(reportId);
                setView('report');
              } else {
                setView('lobby');
              }
            }}
          />
        )}

        {view === 'report' && token && reportMeetingId && (
          <ReportView
            token={token}
            meetingId={reportMeetingId}
            onClose={() => {
              setReportMeetingId(null);
              setView('lobby');
            }}
          />
        )}
      </main>
    </div>
  );
}
