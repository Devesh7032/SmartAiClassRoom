import { User, Volume2, ShieldAlert, Award, AlertTriangle, Users, Lightbulb } from 'lucide-react';

interface AIPanelProps {
  telemetry: {
    activeStudents: Array<{
      userId: string;
      name: string;
      speakingTime: number;
      responses: number;
      chatMessages: number;
      participationScore: number;
    }>;
    lowParticipation: Array<{
      userId: string;
      name: string;
      speakingTime: number;
      responses: number;
      participationScore: number;
    }>;
    noiseDetection: Array<{
      userId: string;
      name: string;
      noiseType: string;
      warningStatus: string;
      autoMutedStatus: string;
      eventsCount: number;
      detectionTime?: string;
    }>;
    raisedHands: Array<{
      userId: string;
      name: string;
    }>;
    attendanceSummary: {
      present: number;
      late: number;
      leftEarly: number;
      disconnected: number;
      rejoined: number;
    };
    liveAISuggestions: string[];
  } | null;
  questions: any[];
  timeline: any[];
}

export default function AIPanel({ telemetry, questions, timeline }: AIPanelProps) {
  if (!telemetry) {
    return (
      <div className="ai-dashboard-container" style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Awaiting telemetry feed from classroom...</p>
      </div>
    );
  }

  const { activeStudents, lowParticipation, noiseDetection, raisedHands, attendanceSummary, liveAISuggestions } = telemetry;

  return (
    <div className="ai-dashboard-container">
      <div className="ai-dashboard-scroll">
        
        {/* Section 6: Live AI Suggestions (Place at top so Teacher sees instantly) */}
        <div className="ai-card ai-card-accent">
          <div className="ai-card-header">
            <Lightbulb size={16} color="var(--accent)" /> Live AI Suggestions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {liveAISuggestions.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Classroom activity stable. No immediate actions suggested.</p>
            ) : (
              liveAISuggestions.map((s, idx) => (
                <div className="suggestion-item animate-slide-in" key={idx}>
                  <span>💡</span>
                  <span>{s}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 7: Live Q&A Extraction */}
        <div className="ai-card">
          <div className="ai-card-header">
            <span style={{ fontSize: '16px' }}>❓</span> Live Q&A Extraction
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {questions.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No questions detected in transcripts yet.</p>
            ) : (
              questions.map((q, idx) => (
                <div className="suggestion-item animate-slide-in" key={q.id || idx} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '4px', display: 'block' }}>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>
                    {q.asked_by_name}: "{q.question_text}"
                  </div>
                  {q.answer_text ? (
                    <div style={{ fontSize: '12px', color: 'var(--success)', marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid var(--success)' }}>
                      <strong>A:</strong> {q.answer_text} <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>({q.answered_by_name}, {q.duration_seconds}s response)</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '4px', fontWeight: 500 }}>
                      ⏳ Awaiting answer...
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 8: Chronological Meeting Timeline */}
        <div className="ai-card">
          <div className="ai-card-header">
            <span style={{ fontSize: '16px' }}>📜</span> Classroom Timeline Logs
          </div>
          <div className="timeline-scroll-container" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
            {timeline.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No classroom events logged yet.</p>
            ) : (
              timeline.map((event, idx) => (
                <div className="animate-fade-in" key={event.id || idx} style={{ display: 'flex', gap: '8px', fontSize: '12px', lineHeight: '1.4' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '10px', whiteSpace: 'nowrap' }}>
                    {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <div>
                    <span style={{
                      fontWeight: 600,
                      color: event.event_type.includes('error') || event.event_type.includes('noise') || event.event_type.includes('leave') || event.event_type.includes('reject') ? 'var(--danger)' :
                             event.event_type.includes('join') ? 'var(--success)' :
                             event.event_type.includes('hand') ? 'var(--warning)' : 'var(--text-primary)'
                    }}>
                      [{event.event_type.replace('_', ' ').toUpperCase()}]
                    </span>{' '}
                    <span>{event.description}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 5: Attendance Counter */}
        <div className="ai-card">
          <div className="ai-card-header">
            <Users size={16} color="var(--accent)" /> Live Attendance
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--success)' }}>
                {attendanceSummary.present}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Present</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--warning)' }}>
                {attendanceSummary.late}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Late</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px', textAlign: 'center', gridColumn: 'span 2' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Left Early / Offline: {attendanceSummary.leftEarly}
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Raised Hands Queue */}
        <div className="ai-card">
          <div className="ai-card-header">
            <span style={{ fontSize: '16px' }}>✋</span> Raised Hands Queue
          </div>
          {raisedHands.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No student hand raises currently queued.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {raisedHands.map((student, idx) => (
                <div
                  className="animate-slide-in"
                  key={student.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    background: 'var(--warning-light)',
                    border: '1px solid var(--warning)',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--warning)'
                  }}
                >
                  <span>{idx + 1}. {student.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 1: Active Students Leaderboard */}
        <div className="ai-card">
          <div className="ai-card-header">
            <Award size={16} color="var(--success)" /> Most Active Students
          </div>
          {activeStudents.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Waiting for classroom participation data...</p>
          ) : (
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Talk Time</th>
                  <th>Chat</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {activeStudents.slice(0, 5).map((s) => (
                  <tr key={s.userId} className="animate-fade-in">
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td>{s.speakingTime}s</td>
                    <td>{s.chatMessages}</td>
                    <td>
                      <span className="score-badge score-high">{s.participationScore}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 2: Low Participation Alerts */}
        <div className="ai-card">
          <div className="ai-card-header">
            <AlertTriangle size={16} color="var(--warning)" /> Low Engagement Alert
          </div>
          {lowParticipation.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--success)' }}>All students satisfy classroom interaction targets.</p>
          ) : (
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Talk Time</th>
                  <th>Ans</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {lowParticipation.map((s) => (
                  <tr key={s.userId} className="animate-fade-in">
                    <td style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{s.name}</td>
                    <td>{s.speakingTime}s</td>
                    <td>{s.responses}</td>
                    <td>
                      <span className="score-badge score-low">{s.participationScore}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 3: Noise Detection Logs */}
        <div className="ai-card ai-card-danger">
          <div className="ai-card-header" style={{ color: 'var(--danger)' }}>
            <Volume2 size={16} color="var(--danger)" /> Noise Detection Log
          </div>
          {noiseDetection.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-primary)' }}>No disruptive sounds logged.</p>
          ) : (
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Noise Type</th>
                  <th>Detection Time</th>
                  <th>Warning Status</th>
                  <th>Auto-Muted Status</th>
                  <th>Number of Noise Events</th>
                </tr>
              </thead>
              <tbody>
                {noiseDetection.map((s) => (
                  <tr key={s.userId} className="animate-fade-in" style={{ fontSize: '12px' }}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{s.noiseType}</td>
                    <td>{s.detectionTime || 'N/A'}</td>
                    <td>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        fontSize: '10px',
                        background: s.warningStatus === 'Warning Issued' ? 'var(--warning)' : 'var(--bg-secondary)',
                        color: s.warningStatus === 'Warning Issued' ? 'white' : 'var(--text-secondary)',
                        border: s.warningStatus === 'Warning Issued' ? 'none' : '1px solid var(--border-color)'
                      }}>
                        {s.warningStatus}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        fontSize: '10px',
                        background: (s.autoMutedStatus === 'Auto-muted' || s.autoMutedStatus === 'Muted by AI') ? 'var(--danger)' : 'var(--success)',
                        color: 'white'
                      }}>
                        {s.autoMutedStatus}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{s.eventsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
