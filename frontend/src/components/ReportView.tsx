import { useState, useEffect, useRef } from 'react';
import { Download, CheckCircle, Clock, VolumeX, BookOpen, MessageSquare, AlertCircle, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ReportProps {
  token: string;
  meetingId: string;
  onClose: () => void;
}

export default function ReportView({ token, meetingId, onClose }: ReportProps) {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/reports/${meetingId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error("Could not retrieve classroom report. Host-only access.");
        return res.json();
      })
      .then(data => {
        setReport(data.report);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [meetingId, token]);

  const handleDownloadPDF = async () => {
    if (!reportRef.current) return;
    setDownloading(true);
    
    try {
      const element = reportRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: document.body.classList.contains('dark-mode') ? '#1e293b' : '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 size width in mm
      const pageHeight = 297; // A4 size height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`Classroom-Report-${meetingId}.pdf`);
    } catch (err) {
      console.error("Failed to export PDF:", err);
      alert("Failed to export report PDF.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div style={{ textAlign: 'center' }}>
          <div className="loader-circle"></div>
          <p>Compiling Class Analytics & Report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card glass-panel" style={{ textAlign: 'center', borderColor: 'var(--danger)' }}>
          <AlertCircle size={48} color="var(--danger)" style={{ margin: '0 auto 16px' }} />
          <h3 className="auth-title" style={{ color: 'var(--danger)' }}>Access Denied</h3>
          <p className="auth-subtitle" style={{ marginBottom: '24px' }}>{error}</p>
          <button className="btn btn-primary" onClick={onClose}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  // Parse JSON columns
  const topics = typeof report.topics === 'string' ? JSON.parse(report.topics) : report.topics;
  const homework = typeof report.homework === 'string' ? JSON.parse(report.homework) : report.homework;
  const actionItems = typeof report.action_items === 'string' ? JSON.parse(report.action_items) : report.action_items;
  const metrics = typeof report.metrics === 'string' ? JSON.parse(report.metrics) : report.metrics;

  const durationMinutes = Math.round(metrics.durationSeconds / 60);

  return (
    <div className="report-wrapper">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '900px' }}>
        
        {/* Actions header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            &larr; Back to Dashboard
          </button>
          <button className="btn btn-primary" onClick={handleDownloadPDF} disabled={downloading}>
            <Download size={16} /> {downloading ? "Generating PDF..." : "Export as PDF"}
          </button>
        </div>

        {/* Printable Report Panel */}
        <div ref={reportRef} className="report-container">
          
          {/* Header */}
          <div className="report-header">
            <div>
              <div style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '4px' }}>
                Post-Classroom Performance Report
              </div>
              <h2 className="report-title">Lecture Summary & Analytics</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                Classroom Code: <strong>{meetingId}</strong>
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-secondary)', justifyContent: 'flex-end', marginBottom: '4px' }}>
                <Clock size={14} /> Duration: {durationMinutes} mins
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Date: {new Date(report.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Section 1: AI Summary & Topics */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <BookOpen size={16} color="var(--accent)" /> Lesson AI Summary
              </h3>
              <p style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '16px' }}>
                {report.summary}
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Topics Taught
                  </h4>
                  <ul style={{ paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {topics.map((t: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Homework & Tasks Assigned
                  </h4>
                  <ul style={{ paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {homework.map((h: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>{h}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Attendance Summary */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <CheckCircle size={16} color="var(--success)" /> Attendance Summary
              </h3>
              <ul className="report-list">
                <li className="report-list-item">
                  <span>Total Students Present</span>
                  <strong>{metrics.attendance.total}</strong>
                </li>
                <li className="report-list-item">
                  <span>Late Arrivals</span>
                  <span style={{ color: metrics.attendance.late.length > 0 ? 'var(--warning)' : 'inherit', fontWeight: 600 }}>
                    {metrics.attendance.late.length}
                  </span>
                </li>
                <li className="report-list-item">
                  <span>Left Session Early</span>
                  <span style={{ color: metrics.attendance.leftEarly.length > 0 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>
                    {metrics.attendance.leftEarly.length}
                  </span>
                </li>
              </ul>
              
              {metrics.attendance.late.length > 0 && (
                <div style={{ marginTop: '14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <strong>Late Students:</strong> {metrics.attendance.late.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Section 2b: Noise Metrics Table */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <VolumeX size={16} color="var(--danger)" /> AI Noise Detection Log
              </h3>
              {metrics.metrics.noiseEvents.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  No significant background noises (TV, dogs, music, etc.) were flagged during this session.
                </p>
              ) : (
                <table className="ai-table">
                  <thead>
                    <tr>
                      <th>Student Name</th>
                      <th>Noise Type</th>
                      <th>Time</th>
                      <th>Warning Issued</th>
                      <th>Auto-Mute Performed</th>
                      <th>Total Noise Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.metrics.noiseEvents.map((n: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{n.studentName}</td>
                        <td style={{ textTransform: 'capitalize' }}>{n.noiseType}</td>
                        <td>{n.time}</td>
                        <td>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '10px',
                            background: n.warningIssued ? 'var(--warning)' : 'var(--bg-secondary)',
                            color: n.warningIssued ? 'white' : 'var(--text-secondary)',
                            border: n.warningIssued ? 'none' : '1px solid var(--border-color)'
                          }}>
                            {n.warningIssued ? "Yes" : "No"}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '10px',
                            background: n.autoMutePerformed ? 'var(--danger)' : 'var(--success)',
                            color: 'white'
                          }}>
                            {n.autoMutePerformed ? "Yes" : "No"}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{n.totalNoiseEvents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Section 3: Participation Leaderboard */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <MessageSquare size={16} color="var(--accent)" /> Student Engagement Rankings
              </h3>
              <table className="ai-table">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Speaking Time</th>
                    <th>Chat Messages</th>
                    <th>Teacher Answers</th>
                    <th>Interaction Score</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.metrics.activeStudents.map((s: any, idx: number) => {
                    const pct = s.participationScore;
                    let badgeClass = 'score-low';
                    if (pct >= 60) badgeClass = 'score-high';
                    else if (pct >= 30) badgeClass = 'score-mid';

                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td>{s.speakingTime} seconds</td>
                        <td>{s.chatMessages}</td>
                        <td>{s.responses}</td>
                        <td>
                          <span className={`score-badge ${badgeClass}`}>{pct} / 100</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: Quiz Questions */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <FileText size={16} color="var(--accent)" /> AI Quiz Questions Generated
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {metrics.quizzes.map((q: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '13px', background: 'var(--bg-surface)', padding: '12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Q{idx+1}: {q.question}</div>
                    <ul style={{ listStyle: 'none', paddingLeft: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      {q.options.map((opt: string, oIdx: number) => (
                        <li key={oIdx}>• {opt}</li>
                      ))}
                    </ul>
                    <div style={{ color: 'var(--success)', fontWeight: 600 }}>Correct Answer: {q.answer}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 5: Action Items & Follow-up */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title">Host Follow-Up & Action Items</h3>
              <ul style={{ paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {actionItems.map((act: string, idx: number) => (
                  <li key={idx} style={{ marginBottom: '6px' }}>{act}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Section 6: Lecture Speech Transcript */}
          <div className="report-grid">
            <div className="report-card" style={{ gridColumn: 'span 2' }}>
              <h3 className="section-title">Classroom Verbal Transcript</h3>
              {metrics.transcript ? (
                <div className="transcript-box">{metrics.transcript}</div>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  No spoken communication was recorded during this class.
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
