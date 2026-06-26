import { Server, Socket } from 'socket.io';
import { verifyToken } from './auth';
import { pool } from './db';
import {
  activeSessions,
  handleParticipantJoin,
  handleParticipantLeave,
  handleNoiseEvent,
  addTranscriptLine,
  broadcastAnalyticsUpdate,
  compileAndStoreReport,
  logMeetingEvent,
} from './agents';

export function setupWebSockets(server: any) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  console.log("WebSocket Server initialized.");

  // Middle-layer authentication of WebSocket connection
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    const meetingId = socket.handshake.auth.meetingId || socket.handshake.query.meetingId;

    if (!token || !meetingId) {
      return next(new Error('Authentication failed: Token and Meeting ID required.'));
    }

    const decoded = verifyToken(token as string);
    if (!decoded) {
      return next(new Error('Authentication failed: Invalid token.'));
    }

    socket.data.user = decoded;
    socket.data.meetingId = meetingId;
    next();
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user;
    const meetingId = socket.data.meetingId;
    
    console.log(`Socket connected: ${socket.id} (User: ${user.name}, Role: ${user.role}, Meeting: ${meetingId})`);

    // Verify meeting exists in DB
    let meetingResult;
    try {
      meetingResult = await pool.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
      if (meetingResult.rows.length === 0) {
        socket.emit('error-message', 'Meeting does not exist.');
        return socket.disconnect();
      }
    } catch (e) {
      socket.emit('error-message', 'Database error verifying meeting.');
      return socket.disconnect();
    }

    const meeting = meetingResult.rows[0];

    // Handle Teacher Host initialization
    if (user.role === 'teacher') {
      let session = activeSessions.get(meetingId);
      const isNewSession = !session;
      if (!session) {
        session = {
          meetingId,
          hostId: user.id,
          startTime: Date.now(),
          participants: new Map(),
          transcript: [],
          autoMuteOnNoise: true,
        };
        activeSessions.set(meetingId, session);

        // Update meeting status in DB to live
        await pool.query("UPDATE meetings SET status = 'live' WHERE id = $1", [meetingId]);
        console.log(`Teacher started meeting ${meetingId}. Session cached.`);
        await logMeetingEvent(meetingId, 'class_start', `Teacher ${user.name} started the classroom session`, io);
      }

      socket.join(meetingId);
      await handleParticipantJoin(meetingId, user.id, user.name, user.role, socket.id);
      
      // Update participant record in DB
      await pool.query(
        `INSERT INTO participants (meeting_id, user_id, display_name, socket_id, status)
         VALUES ($1, $2, $3, $4, 'admitted')
         ON CONFLICT (meeting_id, user_id) DO UPDATE SET socket_id = EXCLUDED.socket_id, status = 'admitted'`,
        [meetingId, user.id, user.name, socket.id]
      );

      // Confirm join success
      socket.emit('room-joined', { role: 'teacher', status: 'admitted', autoMuteOnNoise: session.autoMuteOnNoise });
      await logMeetingEvent(meetingId, 'teacher_join', `Teacher ${user.name} joined the classroom`, io);
      
      // Promote waiting room students if isNewSession
      if (isNewSession) {
        const waitingSockets = await io.in(`waiting_${meetingId}`).fetchSockets();
        for (const ws of waitingSockets) {
          const student = ws.data.user;
          if (student && student.role === 'student') {
            if (!session.participants.has(student.id)) {
              await handleParticipantJoin(meetingId, student.id, student.name, 'student', ws.id);
              await pool.query(
                `INSERT INTO participants (meeting_id, user_id, display_name, socket_id, status)
                 VALUES ($1, $2, $3, $4, 'waiting')
                 ON CONFLICT (meeting_id, user_id) DO UPDATE SET socket_id = EXCLUDED.socket_id, status = 'waiting'`,
                [meetingId, student.id, student.name, ws.id]
              );
              ws.emit('waiting-room-status', { status: 'waiting-admission', message: 'Requesting permission to join the classroom...' });
            }
          }
        }
      }

      // Send list of current waiting room join requests
      sendJoinRequestsToHost(meetingId, io);

      // Start periodic 5s Analytics Agent loop if not already running
      startAnalyticsLoop(meetingId, io);

    } else {
      // Student connection flow
      let session = activeSessions.get(meetingId);
      if (!session) {
        // Teacher hasn't started the meeting yet
        socket.emit('waiting-room-status', { status: 'waiting-for-teacher', message: 'The teacher has not started this classroom session yet. Please wait.' });
        
        // Temporarily put student socket in a waiting room to notify when host starts
        socket.join(`waiting_${meetingId}`);
        return;
      }

      // Check if classroom is locked
      if (meeting.locked) {
        socket.emit('error-message', 'This classroom is currently locked by the teacher.');
        return socket.disconnect();
      }

      socket.join(`waiting_${meetingId}`);
      await handleParticipantJoin(meetingId, user.id, user.name, user.role, socket.id);

      // Insert participant as waiting
      try {
        await pool.query(
          `INSERT INTO participants (meeting_id, user_id, display_name, socket_id, status)
           VALUES ($1, $2, $3, $4, 'waiting')
           ON CONFLICT (meeting_id, user_id) DO UPDATE SET socket_id = EXCLUDED.socket_id, status = 'waiting'`,
          [meetingId, user.id, user.name, socket.id]
        );
      } catch (err) {
        console.error("Error inserting student participant:", err);
      }

      socket.emit('waiting-room-status', { status: 'waiting-admission', message: 'Requesting permission to join the classroom...' });
      await logMeetingEvent(meetingId, 'join_request', `${user.name} requested to join the classroom`, io);
      
      // Notify host of the join request
      sendJoinRequestsToHost(meetingId, io);
    }

    // --- WebRTC Signaling Relay ---
    socket.on('webrtc-offer', (data: { to: string; offer: any }) => {
      // Find recipient socket ID in active session
      const session = activeSessions.get(meetingId);
      if (!session) return;
      
      let targetSocketId = '';
      for (const p of session.participants.values()) {
        if (p.userId === data.to) {
          targetSocketId = p.socketId;
          break;
        }
      }
      
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-offer', {
          from: user.id,
          fromName: user.name,
          offer: data.offer,
        });
      }
    });

    socket.on('webrtc-answer', (data: { to: string; answer: any }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      let targetSocketId = '';
      for (const p of session.participants.values()) {
        if (p.userId === data.to) {
          targetSocketId = p.socketId;
          break;
        }
      }

      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-answer', {
          from: user.id,
          answer: data.answer,
        });
      }
    });

    socket.on('ice-candidate', (data: { to: string; candidate: any }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      let targetSocketId = '';
      for (const p of session.participants.values()) {
        if (p.userId === data.to) {
          targetSocketId = p.socketId;
          break;
        }
      }

      if (targetSocketId) {
        io.to(targetSocketId).emit('ice-candidate', {
          from: user.id,
          candidate: data.candidate,
        });
      }
    });

    // --- Host Controls (Teacher Admits/Rejects/Mutes/Locks) ---
    
    socket.on('approve-join-request', async (data: { userId: string }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const studentParticipant = session.participants.get(data.userId);
      if (!studentParticipant) return;

      studentParticipant.status = 'admitted';
      studentParticipant.joinedAt = Date.now();
      studentParticipant.cameraOnStartTime = !studentParticipant.isCameraOff ? Date.now() : undefined;
      studentParticipant.micOnStartTime = !studentParticipant.isMuted ? Date.now() : undefined;

      // Update DB participant & attendance
      try {
        await pool.query(
          `UPDATE participants 
           SET status = 'admitted', joined_at = NOW() 
           WHERE meeting_id = $1 AND user_id = $2`,
          [meetingId, data.userId]
        );

        await pool.query(
          `INSERT INTO attendance (meeting_id, user_id, join_time, status)
           VALUES ($1, $2, NOW(), 'present')
           ON CONFLICT DO NOTHING`,
          [meetingId, data.userId]
        );
      } catch (err) {
        console.error("Error approving join request in DB:", err);
      }

      // Notify host dashboard
      sendJoinRequestsToHost(meetingId, io);

      // Move student socket out of waiting room into main meeting room
      const studentSocket = io.sockets.sockets.get(studentParticipant.socketId);
      if (studentSocket) {
        studentSocket.leave(`waiting_${meetingId}`);
        studentSocket.join(meetingId);
        studentSocket.emit('room-joined', { role: 'student', status: 'admitted' });
      }

      console.log(`Teacher approved join request for ${studentParticipant.displayName}`);
      await logMeetingEvent(meetingId, 'student_join', `Student ${studentParticipant.displayName} joined the classroom`, io);
      await broadcastAnalyticsUpdate(meetingId, io);
    });

    socket.on('participant-ready', () => {
      const session = activeSessions.get(meetingId);
      if (!session) return;
      const p = session.participants.get(user.id);
      if (!p) return;

      console.log(`[Audio Debug] Participant ${p.displayName} (${user.role}) is ready with streams. Broadcasting join to room.`);
      
      // Broadcast new participant join to everyone in room (useful for establishing WebRTC mesh)
      io.to(meetingId).emit('participant-joined', {
        userId: p.userId,
        displayName: p.displayName,
        isMuted: p.isMuted,
        isCameraOff: p.isCameraOff,
        handRaised: p.handRaised,
      });
    });

    socket.on('reject-join-request', async (data: { userId: string }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const studentParticipant = session.participants.get(data.userId);
      if (!studentParticipant) return;

      studentParticipant.status = 'rejected';

      try {
        await pool.query(
          `UPDATE participants 
           SET status = 'rejected' 
           WHERE meeting_id = $1 AND user_id = $2`,
          [meetingId, data.userId]
        );
      } catch (err) {
        console.error("Error rejecting join request in DB:", err);
      }

      sendJoinRequestsToHost(meetingId, io);

      const studentSocket = io.sockets.sockets.get(studentParticipant.socketId);
      if (studentSocket) {
        studentSocket.emit('waiting-room-status', { status: 'rejected', message: 'Your request to join this classroom was declined by the teacher.' });
        studentSocket.disconnect();
      }

      await logMeetingEvent(meetingId, 'join_rejected', `Teacher declined join request for ${studentParticipant.displayName}`, io);
      session.participants.delete(data.userId);
      console.log(`Teacher rejected join request for ${data.userId}`);
    });

    socket.on('toggle-lock-room', async (data: { locked: boolean }) => {
      if (user.role !== 'teacher') return;
      
      try {
        await pool.query('UPDATE meetings SET locked = $1 WHERE id = $2', [data.locked, meetingId]);
        io.to(meetingId).emit('room-lock-status', { locked: data.locked });
        console.log(`Meeting ${meetingId} lock status updated to: ${data.locked}`);
      } catch (e) {
        console.error("Error toggling room lock in DB:", e);
      }
    });

    socket.on('host-mute-user', (data: { userId: string; mute: boolean }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const student = session.participants.get(data.userId);
      if (student) {
        student.isMuted = data.mute;
        if (data.mute) {
          student.isSpeaking = false;
          if (student.speakStartTime) {
            student.speakingDuration += Math.round((Date.now() - student.speakStartTime) / 1000);
            student.speakStartTime = undefined;
          }
        } else {
          student.autoMuted = false;
          student.warningSent = false;
        }
        io.to(student.socketId).emit('host-mute-status', { mute: data.mute, reason: data.mute ? 'Muted by teacher.' : 'Unmuted by teacher.' });
        io.to(meetingId).emit('participant-status-updated', {
          userId: data.userId,
          isMuted: data.mute,
          autoMuted: student.autoMuted,
          warningSent: student.warningSent,
        });
      }
    });

    socket.on('host-disable-camera-user', (data: { userId: string; disable: boolean }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const student = session.participants.get(data.userId);
      if (student) {
        student.isCameraOff = data.disable;
        io.to(student.socketId).emit('host-camera-status', { disable: data.disable });
        io.to(meetingId).emit('participant-status-updated', {
          userId: data.userId,
          isCameraOff: data.disable,
        });
      }
    });

    socket.on('host-mute-all', () => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      session.participants.forEach(p => {
        if (p.role === 'student' && p.status === 'admitted') {
          p.isMuted = true;
          p.isSpeaking = false;
          if (p.speakStartTime) {
            p.speakingDuration += Math.round((Date.now() - p.speakStartTime) / 1000);
            p.speakStartTime = undefined;
          }
          io.to(p.socketId).emit('host-mute-status', { mute: true, reason: 'All participants muted by host.' });
          io.to(meetingId).emit('participant-status-updated', {
            userId: p.userId,
            isMuted: true,
          });
        }
      });
    });

    socket.on('host-disable-all-cameras', () => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      session.participants.forEach(p => {
        if (p.role === 'student' && p.status === 'admitted') {
          p.isCameraOff = true;
          io.to(p.socketId).emit('host-camera-status', { disable: true });
          io.to(meetingId).emit('participant-status-updated', {
            userId: p.userId,
            isCameraOff: true,
          });
        }
      });
    });

    socket.on('host-remove-user', (data: { userId: string }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const student = session.participants.get(data.userId);
      if (student) {
        io.to(student.socketId).emit('kicked', { message: 'You have been removed from the classroom by the teacher.' });
        
        const studentSocket = io.sockets.sockets.get(student.socketId);
        if (studentSocket) studentSocket.disconnect();
        
        session.participants.delete(data.userId);
        io.to(meetingId).emit('participant-left', { userId: data.userId });
        console.log(`Teacher kicked student ${data.userId}`);
      }
    });

    socket.on('toggle-auto-mute-noise', (data: { autoMute: boolean }) => {
      if (user.role !== 'teacher') return;
      const session = activeSessions.get(meetingId);
      if (!session) return;

      session.autoMuteOnNoise = data.autoMute;
      socket.emit('info-message', `AI Auto-Mute on Noise toggled to: ${data.autoMute ? 'ON' : 'OFF'}`);
    });

    // --- Interactive Classroom Events ---

    socket.on('raise-hand', async (data: { raised: boolean }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const p = session.participants.get(user.id);
      if (p) {
        p.handRaised = data.raised;
        if (data.raised) {
          p.handRaisesCount++;
          await logMeetingEvent(meetingId, 'hand_raised', `${user.name} raised hand`, io);
        } else {
          await logMeetingEvent(meetingId, 'hand_lowered', `${user.name} lowered hand`, io);
        }
        
        io.to(meetingId).emit('participant-status-updated', {
          userId: user.id,
          handRaised: data.raised,
        });

        // Trigger immediate analytics update to host
        await broadcastAnalyticsUpdate(meetingId, io);
      }
    });

    socket.on('student-speak-status', (data: { isSpeaking: boolean }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const p = session.participants.get(user.id);
      if (p) {
        p.isSpeaking = data.isSpeaking;
        
        if (data.isSpeaking) {
          if (!p.speakStartTime) {
            p.speakStartTime = Date.now();
          }
        } else {
          if (p.speakStartTime) {
            const elapsed = Math.round((Date.now() - p.speakStartTime) / 1000);
            p.speakingDuration += elapsed;
            p.speakStartTime = undefined;
          }
        }

        io.to(meetingId).emit('participant-status-updated', {
          userId: user.id,
          isSpeaking: data.isSpeaking,
        });
      }
    });

    socket.on('send-chat-message', async (data: { message: string }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const p = session.participants.get(user.id);
      if (!p) return;

      p.chatMessagesCount++;

      // Save chat message to DB
      try {
        await pool.query(
          `INSERT INTO chat_messages (meeting_id, user_id, message)
           VALUES ($1, $2, $3)`,
          [meetingId, user.id, data.message]
        );
      } catch (error) {
        console.error("Failed to insert chat message in DB:", error);
      }

      // Broadcast to room
      io.to(meetingId).emit('chat-message-received', {
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        message: data.message,
        timestamp: Date.now(),
      });
    });

    socket.on('participant-device-toggle', async (data: { isMuted: boolean; isCameraOff: boolean }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const p = session.participants.get(user.id);
      if (p) {
        const oldMuted = p.isMuted;
        const oldCamera = p.isCameraOff;
        
        p.isMuted = data.isMuted;
        p.isCameraOff = data.isCameraOff;

        // Track camera durations
        if (data.isCameraOff !== oldCamera) {
          if (data.isCameraOff) {
            if (p.cameraOnStartTime) {
              p.cameraOnDuration = (p.cameraOnDuration || 0) + Math.round((Date.now() - p.cameraOnStartTime) / 1000);
              p.cameraOnStartTime = undefined;
            }
            await logMeetingEvent(meetingId, 'camera_off', `${user.name} turned camera off`, io);
          } else {
            p.cameraOnStartTime = Date.now();
            await logMeetingEvent(meetingId, 'camera_on', `${user.name} turned camera on`, io);
          }
        }

        // Track mic durations
        if (data.isMuted !== oldMuted) {
          if (data.isMuted) {
            if (p.micOnStartTime) {
              p.micOnDuration = (p.micOnDuration || 0) + Math.round((Date.now() - p.micOnStartTime) / 1000);
              p.micOnStartTime = undefined;
            }
            await logMeetingEvent(meetingId, 'mic_off', `${user.name} muted microphone`, io);
          } else {
            p.micOnStartTime = Date.now();
            p.autoMuted = false;
            p.warningSent = false;
            await logMeetingEvent(meetingId, 'mic_on', `${user.name} unmuted microphone`, io);
          }
        }

        try {
          await pool.query(
            `UPDATE participants 
             SET is_muted = $1, is_camera_off = $2 
             WHERE meeting_id = $3 AND user_id = $4`,
            [data.isMuted, data.isCameraOff, meetingId, user.id]
          );
        } catch (err) {
          console.error("Error updating participant device state in DB:", err);
        }

        io.to(meetingId).emit('participant-status-updated', {
          userId: user.id,
          isMuted: data.isMuted,
          isCameraOff: data.isCameraOff,
          autoMuted: p.autoMuted,
          warningSent: p.warningSent,
        });

        await broadcastAnalyticsUpdate(meetingId, io);
      }
    });

    socket.on('participant-screenshare-toggle', async (data: { isScreensharing: boolean }) => {
      const session = activeSessions.get(meetingId);
      if (!session) return;

      const p = session.participants.get(user.id);
      if (p) {
        const oldScreenshare = !!p.isScreensharing;
        p.isScreensharing = data.isScreensharing;

        if (data.isScreensharing !== oldScreenshare) {
          if (data.isScreensharing) {
            p.screenshareStartTime = Date.now();
            await logMeetingEvent(meetingId, 'screenshare_start', `${user.name} started screen sharing`, io);
          } else {
            if (p.screenshareStartTime) {
              p.screenshareDuration = (p.screenshareDuration || 0) + Math.round((Date.now() - p.screenshareStartTime) / 1000);
              p.screenshareStartTime = undefined;
            }
            await logMeetingEvent(meetingId, 'screenshare_stop', `${user.name} stopped screen sharing`, io);
          }
        }

        io.to(meetingId).emit('participant-status-updated', {
          userId: user.id,
          isScreensharing: data.isScreensharing,
        });

        await broadcastAnalyticsUpdate(meetingId, io);
      }
    });

    // --- AI Telemetry Feed Inputs ---

    socket.on('student-noise-detected', async (data: { noiseType: string; severity?: string; confidence?: number; isContinuousDisruptive?: boolean }) => {
      // Input from Agent 1 (Noise Detection client analyzer)
      if (user.role !== 'student') return;
      await handleNoiseEvent(meetingId, user.id, data.noiseType, data.severity || 'Medium', data.confidence || 70, io, data.isContinuousDisruptive);
    });

    socket.on('student-speech-text', async (data: { text: string }) => {
      // Input from Agent 4 (Speech Recognition client analyzer)
      await addTranscriptLine(meetingId, user.id, user.name, data.text, io);
    });

    socket.on('send-emoji', (data: { emoji: string }) => {
      io.to(meetingId).emit('emoji-received', {
        userId: user.id,
        userName: user.name,
        emoji: data.emoji,
      });
    });

    // --- Meeting End Flow ---
    
    socket.on('end-meeting', async () => {
      if (user.role !== 'teacher') return;
      console.log(`Teacher ended classroom session ${meetingId}. Generating final report...`);

      // Call Agent 8: Report Agent to compile data, run summaries, and store report
      const report = await compileAndStoreReport(meetingId, io);

      // Notify all users in room
      io.to(meetingId).emit('meeting-ended', { reportId: meetingId });

      // Disconnect all sockets in that meeting room
      const roomSockets = io.sockets.adapter.rooms.get(meetingId);
      if (roomSockets) {
        for (const socketId of roomSockets) {
          const socketInstance = io.sockets.sockets.get(socketId);
          if (socketInstance) {
            socketInstance.disconnect();
          }
        }
      }
    });

    // --- Disconnect Hook ---
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id} (${user.name})`);
      
      const session = activeSessions.get(meetingId);
      if (session) {
        const p = session.participants.get(user.id);
        if (p && p.socketId === socket.id) {
          await handleParticipantLeave(meetingId, user.id);
          
          // Log leave event
          await logMeetingEvent(meetingId, p.role === 'teacher' ? 'teacher_leave' : 'student_leave', `${p.displayName} left the classroom`, io);

          // Notify the room that user disconnected
          io.to(meetingId).emit('participant-left', { userId: user.id });

          // If student was waiting for join request, update host panel
          if (p.status === 'waiting') {
            session.participants.delete(user.id);
            sendJoinRequestsToHost(meetingId, io);
          }
        }
      }
    });
  });
}

// Helper to push waitlist queue details to teacher
async function sendJoinRequestsToHost(meetingId: string, io: any) {
  const session = activeSessions.get(meetingId);
  if (!session) return;

  // Find host socket id
  let hostSocketId = '';
  const waitingRequests: any[] = [];

  session.participants.forEach(p => {
    if (p.role === 'teacher') {
      hostSocketId = p.socketId;
    } else if (p.status === 'waiting') {
      waitingRequests.push({
        userId: p.userId,
        name: p.displayName,
      });
    }
  });

  if (hostSocketId) {
    io.to(hostSocketId).emit('waiting-requests-list', waitingRequests);
  }
}

// Active intervals for meetings analytics calculators
const analyticsIntervals = new Map<string, NodeJS.Timeout>();

function startAnalyticsLoop(meetingId: string, io: any) {
  if (analyticsIntervals.has(meetingId)) return;

  console.log(`Starting Analytics loop (Agent 6) for room ${meetingId}...`);
  
  // Recalculate metrics every 5 seconds
  const interval = setInterval(async () => {
    const session = activeSessions.get(meetingId);
    if (!session) {
      // Room terminated, clear interval
      clearInterval(interval);
      analyticsIntervals.delete(meetingId);
      return;
    }

    try {
      await broadcastAnalyticsUpdate(meetingId, io);
    } catch (e) {
      console.error("Error in Analytics loop:", e);
    }
  }, 5000);

  analyticsIntervals.set(meetingId, interval);
}
