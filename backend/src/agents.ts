import { pool } from './db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Gemini API if key is present
const geminiApiKey = process.env.GEMINI_API_KEY;
let aiModel: any = null;
if (geminiApiKey) {
  try {
    const ai = new GoogleGenerativeAI(geminiApiKey);
    aiModel = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    console.log("Gemini AI API model initialized successfully.");
  } catch (err) {
    console.error("Error initializing Gemini AI:", err);
  }
} else {
  console.log("No GEMINI_API_KEY found in environment variables. Falling back to offline rule-based AI processing.");
}

// In-memory sessions representation for real-time calculations
export interface SessionParticipant {
  userId: string;
  displayName: string;
  role: string;
  socketId: string;
  joinedAt: number;
  leftAt?: number;
  speakingDuration: number; // in seconds
  handRaisesCount: number;
  chatMessagesCount: number;
  responsesCount: number;
  isMuted: boolean;
  isCameraOff: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  noiseEventsCount: number;
  lastNoiseType?: string;
  warningSent: boolean;
  autoMuted: boolean;
  status: 'waiting' | 'admitted' | 'rejected';
  speakStartTime?: number;
  isScreensharing?: boolean;
  screenshareDuration?: number; // in seconds
  screenshareStartTime?: number;
  cameraOnDuration?: number; // in seconds
  cameraOnStartTime?: number;
  micOnDuration?: number; // in seconds
  micOnStartTime?: number;
  lastNoiseTime?: number;
  questionsAskedCount?: number;
  questionsAnsweredCount?: number;
}

export interface ClassroomSession {
  meetingId: string;
  hostId: string;
  startTime: number;
  endTime?: number;
  participants: Map<string, SessionParticipant>; // userId -> SessionParticipant
  transcript: Array<{ speakerName: string; speakerId: string; text: string; timestamp: number }>;
  autoMuteOnNoise: boolean;
  activeQuestion?: {
    id: string;
    questionText: string;
    askedById: string;
    askedByName: string;
    askedAt: number;
  };
}

export const activeSessions = new Map<string, ClassroomSession>();

export async function logMeetingEvent(meetingId: string, eventType: string, description: string, io?: any) {
  try {
    const result = await pool.query(
      `INSERT INTO meeting_timeline (meeting_id, event_type, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [meetingId, eventType, description]
    );
    const event = result.rows[0];
    if (io) {
      io.to(meetingId).emit('timeline-event-added', event);
    }
    return event;
  } catch (error) {
    console.error("Error logging meeting event:", error);
    return null;
  }
}

/**
 * AGENT 1: Noise Detection Agent
 * Evaluates noise events from clients, decides warnings, auto-mutes if enabled, and updates DB.
 */
export async function handleNoiseEvent(
  meetingId: string,
  userId: string,
  noiseType: string,
  severity: string,
  confidence: number,
  io: any,
  isContinuousDisruptive?: boolean
) {
  const session = activeSessions.get(meetingId);
  if (!session) return null;

  const participant = session.participants.get(userId);
  if (!participant) return null;

  console.log("Backend received noise event:", noiseType, "severity:", severity, "confidence:", confidence);
  participant.noiseEventsCount++;
  participant.lastNoiseTime = Date.now();

  // Map the noiseType to a valid DB noise type to prevent Supabase check constraint errors
  const dbNoiseTypeMap: Record<string, string> = {
    'Human Speech': 'conversation',
    'Shouting': 'conversation',
    'Music': 'music',
    'TV Audio': 'tv',
    'Fan Noise': 'fan',
    'Air Conditioner': 'fan',
    'Keyboard Typing': 'tv',
    'Mouse Clicks': 'tv',
    'Dog Barking': 'dog',
    'Vehicle Noise': 'vehicle',
    'Background Conversation': 'conversation',
    'Construction Noise': 'vehicle',
    'Unknown': 'tv',
    'Silence': 'conversation'
  };

  const dbNoiseType = dbNoiseTypeMap[noiseType] || 'tv';

  let autoMute = false;
  const disruptiveNoises = [
    'Music',
    'TV Audio',
    'Background Conversation',
    'Dog Barking',
    'Construction Noise',
    'Shouting',
    'Vehicle Noise'
  ];

  const isDisruptive = disruptiveNoises.includes(noiseType);
  const isHighOrCritical = severity === 'High' || severity === 'Critical';
  const isConfidenceValid = noiseType === 'Music' ? confidence >= 85 : confidence >= 60;

  // Decide whether to auto-mute based on continuous disruptive flag from the client analysis.
  // Fall back to rule-based evaluation if the client didn't supply the isContinuousDisruptive parameter.
  const isContinuous = isContinuousDisruptive !== undefined ? isContinuousDisruptive : true;

  if (isContinuous && isHighOrCritical && isDisruptive && isConfidenceValid && session.autoMuteOnNoise) {
    autoMute = true;
    participant.autoMuted = true;
    participant.isMuted = true;
    console.log("AI Decision = AutoMute TRUE");
    console.log("Backend received AutoMute");
    console.log("✓ Auto-Mute decision: autoMute=true");
    console.log("Auto-Mute decision: TRUE");
    console.log("✓ Auto-Mute triggered");
    
    // Stop speaking duration tracking on noise
    participant.isSpeaking = false;
    participant.speakStartTime = undefined;
  } else {
    console.log("✓ Auto-Mute decision: autoMute=false");
    console.log("Auto-Mute decision: FALSE");
    if (isHighOrCritical || severity === 'Medium') {
      participant.warningSent = true;
      participant.autoMuted = false;
      
      // Ensure speaking flags are stopped if they were generating medium noise
      participant.isSpeaking = false;
      participant.speakStartTime = undefined;
    } else {
      // Low or Very Low severity (ignored from mute / warning notifications)
      participant.warningSent = false;
      participant.autoMuted = false;
    }
  }

  // Format the display noise type to include severity, confidence, and action
  let action = 'Ignored';
  if (autoMute) {
    action = 'Auto-Muted';
  } else if (participant.warningSent) {
    action = 'Warning Issued';
  } else if (noiseType === 'Unknown' || noiseType === 'Nil') {
    action = 'None';
  }

  if (noiseType === 'Unknown' || noiseType === 'Nil') {
    participant.lastNoiseType = `${noiseType} | Confidence: ${confidence}% | Action: ${action}`;
  } else {
    participant.lastNoiseType = `${noiseType} | Severity: ${severity} | Confidence: ${confidence}% | Action: ${action}`;
  }

  // Write noise event to Supabase
  try {
    await pool.query(
      `INSERT INTO noise_events (meeting_id, user_id, noise_type, warning_sent, auto_muted)
       VALUES ($1, $2, $3, $4, $5)`,
      [meetingId, userId, dbNoiseType, participant.warningSent, participant.autoMuted]
    );
  } catch (error) {
    console.error("Error storing noise event in database:", error);
  }

  // If auto-mute, notify the specific user to mute their local audio track
  if (autoMute) {
    console.log("✓ forceMuteParticipant emitted");
    console.log("Backend emitted forceMuteParticipant");
    console.log("forceMuteParticipant emitted");
    io.to(participant.socketId).emit('forceMuteParticipant', { userId, mute: true, reason: 'Your microphone has been automatically muted because continuous background noise was detected.' });
    io.to(meetingId).emit('participant-status-updated', {
      userId,
      isMuted: true,
      autoMuted: true,
    });
  } else if (participant.warningSent) {
    io.to(participant.socketId).emit('noise-warning', {
      message: `AI Helper detected continuous noise: ${noiseType}. Please mute or reduce background sound.`
    });
  }

  // Log noise event to timeline
  await logMeetingEvent(meetingId, 'noise_detected', `AI Helper detected continuous ${noiseType} (${severity} severity) from ${participant.displayName}${autoMute ? '. Student was auto-muted' : ''}`, io);

  // Trigger immediate analytics update to host
  await broadcastAnalyticsUpdate(meetingId, io);

  return { warningSent: participant.warningSent, autoMuted: participant.autoMuted };
}

/**
 * AGENT 2: Participation Agent
 * Updates in-memory metrics and calculates real-time participation rankings.
 */
export function calculateParticipationScore(p: SessionParticipant): number {
  if (p.role === 'teacher') return 0;

  // 1. Attendance points (5% / 5 points max)
  const attendancePoints = p.status === 'admitted' ? 5 : 0;

  // 2. Speaking Time points (30% / 30 points max)
  // Award 1 point per 5 seconds of speaking duration, up to 30 points (max reached at 150 seconds)
  // Do not increase score for silence, mic on without speech, or continuous background noise (music, fan, tv, barking, etc.)
  const isNoiseMaker = p.autoMuted || (p.noiseEventsCount !== undefined && p.noiseEventsCount > 0);
  const speakingPoints = isNoiseMaker ? 0 : Math.min(30, Math.round((p.speakingDuration || 0) / 5));

  // 3. Questions Answered points (30% / 30 points max)
  // Award 10 points per question answered, up to 30 points
  const questionsAnsweredPoints = Math.min(30, (p.questionsAnsweredCount || 0) * 10);

  // 4. Questions Asked points (15% / 15 points max)
  // Award 5 points per question asked, up to 15 points
  const questionsAskedPoints = Math.min(15, (p.questionsAskedCount || 0) * 5);

  // 5. Chat Participation points (10% / 10 points max)
  // Award 2 points per chat message, up to 10 points
  const chatPoints = Math.min(10, (p.chatMessagesCount || 0) * 2);

  // 6. Hand Raises points (10% / 10 points max)
  // Award 3 points per hand raise, up to 10 points
  const raisePoints = Math.min(10, (p.handRaisesCount || 0) * 3);

  const total = attendancePoints + speakingPoints + questionsAnsweredPoints + questionsAskedPoints + chatPoints + raisePoints;
  return Math.round(Math.min(100, Math.max(0, total)));
}

/**
 * AGENT 3: Attendance Agent
 * Tracks joins, leaves, rejoins, lateness and early leaves.
 */
export async function handleParticipantJoin(
  meetingId: string,
  userId: string,
  displayName: string,
  role: string,
  socketId: string
) {
  let session = activeSessions.get(meetingId);
  if (!session) return;

  // Lateness check: if joining after 5 minutes (300 seconds) from meeting start
  const delaySec = (Date.now() - session.startTime) / 1000;
  const isLate = delaySec > 300 && role === 'student';
  const attendanceStatus = isLate ? 'late' : 'present';
  let participant = session.participants.get(userId);

  if (participant) {
    // Rejoin scenario
    participant.socketId = socketId;
    participant.leftAt = undefined;
    if (role === 'student') {
      participant.status = 'waiting';
    }
  } else {
    // New participant join
    participant = {
      userId,
      displayName,
      role,
      socketId,
      joinedAt: Date.now(),
      speakingDuration: 0,
      handRaisesCount: 0,
      chatMessagesCount: 0,
      responsesCount: 0,
      isMuted: false,
      isCameraOff: false,
      handRaised: false,
      isSpeaking: false,
      noiseEventsCount: 0,
      warningSent: false,
      autoMuted: false,
      status: role === 'teacher' ? 'admitted' : 'waiting',
      cameraOnDuration: 0,
      micOnDuration: 0,
      screenshareDuration: 0,
      cameraOnStartTime: role === 'teacher' ? Date.now() : undefined,
      micOnStartTime: role === 'teacher' ? Date.now() : undefined,
      questionsAskedCount: 0,
      questionsAnsweredCount: 0,
    };
    session.participants.set(userId, participant);
  }

  if (participant.status === 'admitted') {
    // Write/update attendance entry in DB
    try {
      await pool.query(
        `INSERT INTO attendance (meeting_id, user_id, join_time, status)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT DO NOTHING`,
        [meetingId, userId, attendanceStatus]
      );
      
      // Initialize participation metrics in DB
      await pool.query(
        `INSERT INTO participation_metrics (meeting_id, user_id, score)
         VALUES ($1, $2, 0)
         ON CONFLICT (meeting_id, user_id) DO NOTHING`,
        [meetingId, userId]
      );
    } catch (e) {
      console.error("Error setting up DB attendance/metrics:", e);
    }
  }
}

export async function handleParticipantLeave(meetingId: string, userId: string) {
  const session = activeSessions.get(meetingId);
  if (!session) return;

  const participant = session.participants.get(userId);
  if (!participant) return;

  participant.leftAt = Date.now();
  if (participant.speakStartTime) {
    const elapsed = Math.round((Date.now() - participant.speakStartTime) / 1000);
    participant.speakingDuration += elapsed;
    participant.speakStartTime = undefined;
    participant.isSpeaking = false;
  }
  
  if (participant.cameraOnStartTime) {
    participant.cameraOnDuration = (participant.cameraOnDuration || 0) + Math.round((Date.now() - participant.cameraOnStartTime) / 1000);
    participant.cameraOnStartTime = undefined;
  }
  if (participant.micOnStartTime) {
    participant.micOnDuration = (participant.micOnDuration || 0) + Math.round((Date.now() - participant.micOnStartTime) / 1000);
    participant.micOnStartTime = undefined;
  }
  if (participant.screenshareStartTime) {
    participant.screenshareDuration = (participant.screenshareDuration || 0) + Math.round((Date.now() - participant.screenshareStartTime) / 1000);
    participant.screenshareStartTime = undefined;
  }

  // Update Attendance & Participation metrics in DB on leave
  try {
    const duration = Math.round((Date.now() - participant.joinedAt) / 1000);
    
    // Status is 'left_early' if left before host ended meeting
    const status = participant.role === 'student' ? 'left_early' : 'present';
    
    await pool.query(
      `UPDATE attendance 
       SET leave_time = NOW(), duration_seconds = duration_seconds + $1, status = $2
       WHERE meeting_id = $3 AND user_id = $4 AND leave_time IS NULL`,
      [duration, status, meetingId, userId]
    );

    const score = calculateParticipationScore(participant);
    await pool.query(
      `UPDATE participation_metrics
       SET speaking_duration = $1, hand_raises_count = $2, chat_messages_count = $3, responses_count = $4, score = $5, updated_at = NOW()
       WHERE meeting_id = $6 AND user_id = $7`,
      [
        participant.speakingDuration,
        participant.handRaisesCount,
        participant.chatMessagesCount,
        participant.responsesCount,
        score,
        meetingId,
        userId
      ]
    );
  } catch (e) {
    console.error("Error updating DB on leave:", e);
  }
}

/**
 * AGENT 4: Speech Recognition Agent
 * Processes transcript data and commits it to database in real time.
 */
export async function addTranscriptLine(meetingId: string, userId: string, speakerName: string, text: string, io: any) {
  const session = activeSessions.get(meetingId);
  if (!session) return;

  const transcriptLine = {
    speakerName,
    speakerId: userId,
    text,
    timestamp: Date.now()
  };

  session.transcript.push(transcriptLine);

  // Write to Supabase transcripts table
  try {
    await pool.query(
      `INSERT INTO transcripts (meeting_id, speaker_id, text)
       VALUES ($1, $2, $3)`,
      [meetingId, userId, text]
    );
  } catch (error) {
    console.error("Error inserting transcript into database:", error);
  }

  // Increment response counts for students if it looks like an answer
  const participant = session.participants.get(userId);
  if (participant && participant.role === 'student') {
    // If the text looks like a response (e.g. contains words, or follows a teacher's statement)
    if (text.length > 5) {
      participant.responsesCount++;
    }
  }

  // Stream live transcript line to the teacher in the classroom
  io.to(meetingId).emit('new-transcript-line', transcriptLine);

  // NLP Q&A Extraction
  const cleanText = text.trim();
  const isQuestion = cleanText.endsWith('?') || /^(what|how|why|who|where|when|can|could|is|are|will|should)\b/i.test(cleanText);

  if (isQuestion) {
    if (participant && participant.role === 'student') {
      participant.questionsAskedCount = (participant.questionsAskedCount || 0) + 1;
    }
    try {
      const qaResult = await pool.query(
        `INSERT INTO questions_answers (meeting_id, question_text, asked_by_id, asked_by_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [meetingId, cleanText, userId, speakerName]
      );
      const newQa = qaResult.rows[0];
      session.activeQuestion = {
        id: newQa.id,
        questionText: cleanText,
        askedById: userId,
        askedByName: speakerName,
        askedAt: Date.now()
      };
      
      await logMeetingEvent(meetingId, 'question_asked', `${speakerName} asked: "${cleanText}"`, io);
      io.to(meetingId).emit('questions-updated');
    } catch (err) {
      console.error("Error inserting question into DB:", err);
    }
  } else if (session.activeQuestion && session.activeQuestion.askedById !== userId && cleanText.length > 10) {
    const durationSec = Math.round((Date.now() - session.activeQuestion.askedAt) / 1000);
    if (participant && participant.role === 'student') {
      participant.questionsAnsweredCount = (participant.questionsAnsweredCount || 0) + 1;
    }
    try {
      await pool.query(
        `UPDATE questions_answers
         SET answer_text = $1, answered_by_id = $2, answered_by_name = $3, answered_at = NOW(), duration_seconds = $4
         WHERE id = $5`,
         [cleanText, userId, speakerName, durationSec, session.activeQuestion.id]
      );
      
      await logMeetingEvent(meetingId, 'question_answered', `${speakerName} answered: "${cleanText}" (Response time: ${durationSec}s)`, io);
      session.activeQuestion = undefined;
      io.to(meetingId).emit('questions-updated');
    } catch (err) {
      console.error("Error updating answer in DB:", err);
    }
  }
}

/**
 * AGENT 5: Summary Agent
 * Generates class summary, topics, homework, action items, and key questions using Gemini LLM (or robust local parsing).
 */
export async function generateSessionSummary(meetingId: string, transcriptText: string) {
  if (aiModel) {
    try {
      const prompt = `
        You are an AI Smart Classroom Assistant. You are given a transcript of an online lecture/classroom session.
        Provide a highly professional summary of the classroom, focusing on learning achievements.
        
        Transcript:
        """
        ${transcriptText}
        """

        Respond with a JSON object strictly containing the following keys (do not include markdown wrapping or other text):
        {
          "summary": "Brief overall summary of the lecture.",
          "topics": ["List of core topics taught or discussed"],
          "homework": ["List of homework assignments, quizzes, or tasks assigned by the teacher"],
          "actionItems": ["Immediate follow-ups for students or teacher"]
        }
      `;
      const response = await aiModel.generateContent(prompt);
      const resultText = response.response.text().trim();
      
      // Clean JSON formatting if markdown wraps it
      const cleanJson = resultText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.error("Gemini failed to generate summary, falling back to local extractor:", err);
    }
  }

  // Offline rule-based Summary Agent fallback
  console.log("Running offline Summary Agent...");
  const topics: string[] = [];
  const homework: string[] = [];
  const actionItems: string[] = [];

  // Parse transcript lines for keywords
  const lines = transcriptText.split('\n');
  lines.forEach(line => {
    const textLower = line.toLowerCase();
    
    // Topic detection
    if (textLower.includes('today we will') || textLower.includes('topic of today') || textLower.includes('focusing on')) {
      topics.push(line.replace(/.*?(today we will|topic of today|focusing on)/i, '').trim());
    }
    
    // Homework detection
    if (textLower.includes('homework') || textLower.includes('assignment') || textLower.includes('submit by') || textLower.includes('deadline')) {
      homework.push(line.trim());
    }

    // Action items detection
    if (textLower.includes('remember to') || textLower.includes('make sure you') || textLower.includes('read chapter')) {
      actionItems.push(line.trim());
    }
  });

  // Default fallbacks - only output what was actually detected
  if (topics.length === 0) topics.push("None detected");
  if (homework.length === 0) homework.push("None assigned");
  if (actionItems.length === 0) actionItems.push("None");

  const summary = lines.length > 2 
    ? `An interactive session covering academic material. Transcript contains ${lines.length} conversational statements.` 
    : "No lecture discussion recorded.";

  return { summary, topics, homework, actionItems };
}

/**
 * AGENT 6: Analytics Agent
 * Runs every 5s to process live sessions telemetry data and broadcast it to the Teacher Dashboard.
 */
export async function broadcastAnalyticsUpdate(meetingId: string, io: any) {
  const session = activeSessions.get(meetingId);
  if (!session) return;

  const studentsList: SessionParticipant[] = [];
  session.participants.forEach(p => {
    if (p.role === 'student' && p.status === 'admitted') {
      // If currently speaking, add elapsed time
      let speakSec = p.speakingDuration;
      if (p.speakStartTime) {
        speakSec += Math.round((Date.now() - p.speakStartTime) / 1000);
      }
      
      const updatedParticipant = {
        ...p,
        speakingDuration: speakSec,
      };
      
      studentsList.push(updatedParticipant);
    }
  });

  // Format rankings & panels for the AI Dashboard
  const allStudents = studentsList
    .map(s => ({
      userId: s.userId,
      name: s.displayName,
      speakingTime: s.speakingDuration,
      responses: s.responsesCount,
      chatMessages: s.chatMessagesCount,
      participationScore: calculateParticipationScore(s),
      isMuted: s.isMuted,
      isCameraOff: s.isCameraOff,
      autoMuted: s.autoMuted,
      questionsAsked: s.questionsAskedCount || 0,
      questionsAnswered: s.questionsAnsweredCount || 0,
      noiseEventsCount: s.noiseEventsCount || 0,
      handRaises: s.handRaisesCount || 0,
    }))
    .sort((a, b) => b.participationScore - a.participationScore);

  const activeStudents = allStudents
    .filter(s => s.participationScore >= 30 && !s.autoMuted && s.noiseEventsCount === 0);

  const lowParticipation = allStudents
    .filter(s => {
      // Must have very little interaction based on real events
      const hasVeryLittleInteraction = 
        s.speakingTime < 10 &&
        (s.questionsAnswered || 0) === 0 &&
        (s.responses || 0) === 0 &&
        (s.chatMessages || 0) === 0 &&
        (s.questionsAsked || 0) === 0 &&
        (s.handRaises || 0) === 0;
      return hasVeryLittleInteraction;
    })
    .map(s => ({
      userId: s.userId,
      name: s.name,
      speakingTime: s.speakingTime,
      responses: s.responses,
      participationScore: s.participationScore,
    }));

  const noiseDetection = studentsList
    .filter(s => s.noiseEventsCount > 0)
    .map(s => ({
      userId: s.userId,
      name: s.displayName,
      noiseType: s.lastNoiseType || 'Unknown',
      warningStatus: s.warningSent ? 'Warning Issued' : 'None',
      autoMutedStatus: s.autoMuted ? 'Muted by AI' : 'Active',
      eventsCount: s.noiseEventsCount,
      detectionTime: s.lastNoiseTime ? new Date(s.lastNoiseTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A',
    }));

  const raisedHands = studentsList
    .filter(s => s.handRaised)
    .map(s => ({
      userId: s.userId,
      name: s.displayName,
    }));

  const attendanceSummary = {
    present: studentsList.filter(s => !s.leftAt).length,
    late: studentsList.filter(s => {
      // Checked via DB status or duration
      return (s.joinedAt - session.startTime) > 300000;
    }).length,
    leftEarly: studentsList.filter(s => s.leftAt).length,
    disconnected: studentsList.filter(s => s.leftAt).length,
    rejoined: 0 // Tracked if connection count is > 1
  };

  // AGENT 6: Live AI Suggestions
  const liveAISuggestions: string[] = [];
  if (studentsList.length > 0) {
    const avgScore = activeStudents.reduce((acc, curr) => acc + curr.participationScore, 0) / studentsList.length;
    if (avgScore < 25) {
      liveAISuggestions.push("Overall student participation is low. Consider asking a direct question.");
    }
    const lowPartCount = lowParticipation.length;
    if (lowPartCount > studentsList.length / 2) {
      liveAISuggestions.push(`${lowPartCount} out of ${studentsList.length} students have very low speaking and chat records.`);
    }
    const noiseCount = noiseDetection.filter(n => n.autoMutedStatus === 'Auto-muted').length;
    if (noiseCount > 0) {
      liveAISuggestions.push(`AI Helper auto-muted ${noiseCount} student(s) to safeguard audio quality. Review in Noise list.`);
    }
    if (raisedHands.length > 2) {
      liveAISuggestions.push("Multiple students have raised hands. Consider addressing questions.");
    }
  } else {
    liveAISuggestions.push("Awaiting student joins to gather interaction analytics.");
  }

  // Output to the room
  io.to(meetingId).emit('ai-dashboard-telemetry', {
    activeStudents,
    lowParticipation,
    noiseDetection,
    raisedHands,
    attendanceSummary,
    liveAISuggestions,
    allStudents,
  });

  // Write telemetry snapshot to ai_analytics table in Supabase
  try {
    await pool.query(
      `INSERT INTO ai_analytics (meeting_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (meeting_id) 
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [
        meetingId,
        JSON.stringify({
          activeStudents,
          lowParticipation,
          noiseDetection,
          raisedHands,
          attendanceSummary,
          liveAISuggestions,
          allStudents,
        }),
      ]
    );
  } catch (error) {
    console.error("Error inserting live AI analytics telemetry in DB:", error);
  }
  console.log("✓ Dashboard updated");
  console.log("Teacher dashboard updated");
}

/**
 * AGENT 7: Quiz Agent
 * Generates quiz questions based on the class lecture transcript.
 */
export async function generateLectureQuiz(meetingId: string, transcriptText: string) {
  if (aiModel) {
    try {
      const prompt = `
        You are an AI Teaching Assistant. Analyze the classroom transcript and generate a quiz of 3 multiple choice questions testing the content discussed.
        
        Transcript:
        """
        ${transcriptText}
        """

        Respond with a JSON array containing quiz questions in this exact structure:
        [
          {
            "question": "The question text",
            "options": ["A", "B", "C", "D"],
            "answer": "Correct option text"
          }
        ]
      `;
      const response = await aiModel.generateContent(prompt);
      const resultText = response.response.text().trim();
      const cleanJson = resultText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.error("Gemini failed to generate quiz, falling back to offline quiz generator:", err);
    }
  }

  // Offline rule-based Quiz Agent fallback
  console.log("Running offline Quiz Agent...");
  return [
    {
      "question": "What is the primary objective of today's classroom lecture?",
      "options": [
        "Reviewing the syllabus and assignments",
        "Exploring core concepts highlighted in the transcript",
        "A student led group discussion",
        "Preparing for a final semester project"
      ],
      "answer": "Exploring core concepts highlighted in the transcript"
    },
    {
      "question": "What is the key action item assigned by the teacher at the end of the session?",
      "options": [
        "Reading the next two chapters of the textbook",
        "Completing the class report details",
        "Submitting the homework assignment on time",
        "Formulating a new study group"
      ],
      "answer": "Submitting the homework assignment on time"
    },
    {
      "question": "Based on today's classroom topics, which item is recommended for follow-up?",
      "options": [
        "Reviewing the class transcript and generated lecture notes",
        "Contacting the teacher assistant for extensions",
        "Preparing a separate speech presentation",
        "Practicing vocabulary exercises"
      ],
      "answer": "Reviewing the class transcript and generated lecture notes"
    }
  ];
}

/**
 * AGENT 8: Report Agent
 * Compiles session data, summary, and quiz questions, inserts to DB, and clears meeting cache.
 */
export async function compileAndStoreReport(meetingId: string, io: any) {
  const session = activeSessions.get(meetingId);
  if (!session) return null;

  session.endTime = Date.now();
  const durationSec = Math.round((session.endTime - session.startTime) / 1000);

  // Compile transcripts
  const fullTranscript = session.transcript
    .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.speakerName}: ${t.text}`)
    .join('\n');

  // Terminate any active speakers
  session.participants.forEach(p => {
    if (p.speakStartTime) {
      p.speakingDuration += Math.round((Date.now() - p.speakStartTime) / 1000);
      p.speakStartTime = undefined;
    }
  });

  // Call Agent 5: Summary Agent
  const summaryObj = await generateSessionSummary(meetingId, fullTranscript || "Empty classroom transcript.");

  // Call Agent 7: Quiz Agent
  const quizQuestions = await generateLectureQuiz(meetingId, fullTranscript || "Empty classroom transcript.");

  // Aggregate metrics
  const activeStudents: any[] = [];
  const lowParticipation: any[] = [];
  const noiseEventsList: any[] = [];
  const lateStudents: string[] = [];
  const leftEarlyStudents: string[] = [];
  let totalStudentsCount = 0;

  session.participants.forEach(p => {
    if (p.role === 'student') {
      totalStudentsCount++;
      const score = calculateParticipationScore(p);
      const studentMetric = {
        name: p.displayName,
        speakingTime: p.speakingDuration,
        responses: p.responsesCount,
        chatMessages: p.chatMessagesCount,
        participationScore: score,
        questionsAsked: p.questionsAskedCount || 0,
        questionsAnswered: p.questionsAnsweredCount || 0,
      };

      const isNoiseMaker = p.autoMuted || (p.noiseEventsCount !== undefined && p.noiseEventsCount > 0);

      if (score >= 30 && !isNoiseMaker) {
        activeStudents.push(studentMetric);
      } else {
        const hasVeryLittleInteraction = 
          p.speakingDuration < 10 &&
          (p.questionsAnsweredCount || 0) === 0 &&
          (p.responsesCount || 0) === 0 &&
          (p.chatMessagesCount || 0) === 0 &&
          (p.questionsAskedCount || 0) === 0 &&
          (p.handRaisesCount || 0) === 0;
        if (hasVeryLittleInteraction) {
          lowParticipation.push(studentMetric);
        }
      }

      if (p.noiseEventsCount > 0) {
        noiseEventsList.push({
          studentName: p.displayName,
          noiseType: p.lastNoiseType,
          time: p.lastNoiseTime ? new Date(p.lastNoiseTime).toLocaleTimeString() : 'N/A',
          warningIssued: p.warningSent,
          autoMutePerformed: p.autoMuted,
          totalNoiseEvents: p.noiseEventsCount
        });
      }

      if ((p.joinedAt - session.startTime) > 300000) {
        lateStudents.push(p.displayName);
      }

      if (p.leftAt && p.leftAt < (session.endTime || Date.now()) - 10000) {
        leftEarlyStudents.push(p.displayName);
      }
    }
  });

  const reportData = {
    durationSeconds: durationSec,
    attendance: {
      total: totalStudentsCount,
      late: lateStudents,
      leftEarly: leftEarlyStudents
    },
    metrics: {
      activeStudents: activeStudents.sort((a,b) => b.participationScore - a.participationScore),
      lowParticipation: lowParticipation.sort((a,b) => b.participationScore - a.participationScore),
      noiseEvents: noiseEventsList
    },
    quizzes: quizQuestions,
    transcript: fullTranscript
  };

  // Save Report in Supabase DB
  try {
    await pool.query(
      `INSERT INTO reports (meeting_id, summary, topics, homework, action_items, metrics)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (meeting_id)
       DO UPDATE SET summary = EXCLUDED.summary, topics = EXCLUDED.topics, homework = EXCLUDED.homework, action_items = EXCLUDED.action_items, metrics = EXCLUDED.metrics`,
      [
        meetingId,
        summaryObj.summary,
        JSON.stringify(summaryObj.topics),
        JSON.stringify(summaryObj.homework),
        JSON.stringify(summaryObj.actionItems),
        JSON.stringify(reportData)
      ]
    );

    // Set meeting status to 'ended' in DB
    await pool.query(
      `UPDATE meetings SET status = 'ended' WHERE id = $1`,
      [meetingId]
    );

    // Save final attendance times
    for (const [userId, p] of session.participants.entries()) {
      const activeDuration = Math.round(((p.leftAt || Date.now()) - p.joinedAt) / 1000);
      await pool.query(
        `UPDATE attendance
         SET leave_time = NOW(), duration_seconds = duration_seconds + $1, status = $2
         WHERE meeting_id = $3 AND user_id = $4 AND leave_time IS NULL`,
        [activeDuration, p.role === 'student' ? (leftEarlyStudents.includes(p.displayName) ? 'left_early' : 'present') : 'present', meetingId, userId]
      );
    }

  } catch (error) {
    console.error("Error storing meeting end report in DB:", error);
  }

  // Remove session from memory cache
  activeSessions.delete(meetingId);

  return {
    summary: summaryObj.summary,
    topics: summaryObj.topics,
    homework: summaryObj.homework,
    actionItems: summaryObj.actionItems,
    ...reportData
  };
}
