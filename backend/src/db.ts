import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Force Node to prefer IPv4 DNS resolution to prevent IPv6 connection timeouts
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

// Construct connection string for raw PG commands
let projectRef = '';
try {
  const urlObj = new URL(supabaseUrl);
  projectRef = urlObj.hostname.split('.')[0];
} catch (e) {
  console.error("Invalid SUPABASE_URL configured:", supabaseUrl);
}

const dbPassword = supabaseKey;
const connectionString = `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`;

// PostgreSQL Pool instance
export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

export const supabase = createClient(supabaseUrl, supabaseKey);

// Resilient Offline Fallback Database System
let useLocalFallback = false;
const JSON_DB_PATH = path.join(__dirname, '..', 'database.json');

// Interface representing the structure of our JSON DB
interface LocalDatabase {
  users: any[];
  meetings: any[];
  participants: any[];
  attendance: any[];
  chat_messages: any[];
  noise_events: any[];
  participation_metrics: any[];
  transcripts: any[];
  ai_analytics: any[];
  reports: any[];
  questions_answers: any[];
  meeting_timeline: any[];
}

// Helper to load/save JSON database
function getLocalDb(): LocalDatabase {
  if (!fs.existsSync(JSON_DB_PATH)) {
    const initialDb: LocalDatabase = {
      users: [],
      meetings: [],
      participants: [],
      attendance: [],
      chat_messages: [],
      noise_events: [],
      participation_metrics: [],
      transcripts: [],
      ai_analytics: [],
      reports: [],
      questions_answers: [],
      meeting_timeline: [],
    };
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(initialDb, null, 2));
    return initialDb;
  }
  try {
    const data = JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf-8'));
    data.users = data.users || [];
    data.meetings = data.meetings || [];
    data.participants = data.participants || [];
    data.attendance = data.attendance || [];
    data.chat_messages = data.chat_messages || [];
    data.noise_events = data.noise_events || [];
    data.participation_metrics = data.participation_metrics || [];
    data.transcripts = data.transcripts || [];
    data.ai_analytics = data.ai_analytics || [];
    data.reports = data.reports || [];
    data.questions_answers = data.questions_answers || [];
    data.meeting_timeline = data.meeting_timeline || [];
    return data;
  } catch (e) {
    console.error("Error reading database.json:", e);
    return {
      users: [], meetings: [], participants: [], attendance: [],
      chat_messages: [], noise_events: [], participation_metrics: [],
      transcripts: [], ai_analytics: [], reports: [],
      questions_answers: [], meeting_timeline: []
    };
  }
}

function saveLocalDb(db: LocalDatabase) {
  fs.writeFileSync(JSON_DB_PATH, JSON.stringify(db, null, 2));
}

// Mock query executor simulating PostgreSQL responses for the backend
async function executeLocalQuery(text: string, params: any[] = []): Promise<{ rows: any[] }> {
  const db = getLocalDb();
  const query = text.trim();
  
  // 1. SELECT * FROM users WHERE email = $1
  if (query.startsWith('SELECT * FROM users WHERE email =')) {
    const email = params[0].toLowerCase();
    const rows = db.users.filter(u => u.email === email);
    return { rows };
  }
  
  // 2. INSERT INTO users (email, password_hash, name, role)
  if (query.startsWith('INSERT INTO users')) {
    const id = crypto.randomUUID();
    const newUser = {
      id,
      email: params[0].toLowerCase(),
      password_hash: params[1],
      name: params[2],
      role: params[3],
      created_at: new Date().toISOString()
    };
    db.users.push(newUser);
    saveLocalDb(db);
    return { rows: [newUser] };
  }

  // 3. SELECT * FROM meetings WHERE id = $1
  if (query.startsWith('SELECT m.*, u.name as host_name FROM meetings')) {
    const meetingId = params[0];
    const meeting = db.meetings.find(m => m.id === meetingId);
    if (!meeting) return { rows: [] };
    const host = db.users.find(u => u.id === meeting.host_id);
    return { rows: [{ ...meeting, host_name: host ? host.name : 'Unknown Host' }] };
  }
  
  if (query.startsWith('SELECT * FROM meetings WHERE id =')) {
    const meetingId = params[0];
    const rows = db.meetings.filter(m => m.id === meetingId);
    return { rows };
  }

  // 4. INSERT INTO meetings (host_id, title, status, scheduled_at)
  if (query.startsWith('INSERT INTO meetings')) {
    const id = crypto.randomUUID();
    const newMeeting = {
      id,
      host_id: params[0],
      title: params[1],
      status: 'scheduled',
      scheduled_at: params[2],
      locked: false,
      created_at: new Date().toISOString()
    };
    db.meetings.push(newMeeting);
    saveLocalDb(db);
    return { rows: [newMeeting] };
  }

  // 5. UPDATE meetings SET status = 'ended'
  if (query.startsWith('UPDATE meetings SET status = \'ended\'')) {
    const meetingId = params[0];
    db.meetings = db.meetings.map(m => m.id === meetingId ? { ...m, status: 'ended' } : m);
    saveLocalDb(db);
    return { rows: [] };
  }

  // 6. UPDATE meetings SET locked = $1
  if (query.startsWith('UPDATE meetings SET locked = $1')) {
    const locked = params[0];
    const meetingId = params[1];
    db.meetings = db.meetings.map(m => m.id === meetingId ? { ...m, locked } : m);
    saveLocalDb(db);
    return { rows: [] };
  }

  // 7. INSERT INTO participants
  if (query.startsWith('INSERT INTO participants')) {
    const id = crypto.randomUUID();
    const newParticipant = {
      id,
      meeting_id: params[0],
      user_id: params[1],
      display_name: params[2],
      socket_id: params[3],
      status: params[4] || 'waiting',
      joined_at: new Date().toISOString(),
      left_at: null,
      is_muted: false,
      is_camera_off: false,
      hand_raised: false
    };
    
    // Remove duplicate participant
    db.participants = db.participants.filter(p => !(p.meeting_id === params[0] && p.user_id === params[1]));
    db.participants.push(newParticipant);
    saveLocalDb(db);
    return { rows: [newParticipant] };
  }

  // 8. UPDATE participants SET status = 'admitted'
  if (query.startsWith('UPDATE participants SET status = \'admitted\'')) {
    const meetingId = params[0];
    const userId = params[1];
    db.participants = db.participants.map(p => 
      (p.meeting_id === meetingId && p.user_id === userId) 
        ? { ...p, status: 'admitted', joined_at: new Date().toISOString() } 
        : p
    );
    saveLocalDb(db);
    return { rows: [] };
  }

  // 9. UPDATE participants SET status = 'rejected'
  if (query.startsWith('UPDATE participants SET status = \'rejected\'')) {
    const meetingId = params[0];
    const userId = params[1];
    db.participants = db.participants.map(p => 
      (p.meeting_id === meetingId && p.user_id === userId) 
        ? { ...p, status: 'rejected' } 
        : p
    );
    saveLocalDb(db);
    return { rows: [] };
  }

  // 10. INSERT INTO attendance
  if (query.startsWith('INSERT INTO attendance')) {
    const id = crypto.randomUUID();
    const newAttendance = {
      id,
      meeting_id: params[0],
      user_id: params[1],
      join_time: new Date().toISOString(),
      leave_time: null,
      duration_seconds: 0,
      status: params[2] || 'present'
    };
    db.attendance.push(newAttendance);
    saveLocalDb(db);
    return { rows: [newAttendance] };
  }

  // 11. UPDATE attendance SET leave_time = NOW()
  if (query.startsWith('UPDATE attendance SET leave_time = NOW()')) {
    const duration = params[0];
    const status = params[1];
    const meetingId = params[2];
    const userId = params[3];
    db.attendance = db.attendance.map(a => 
      (a.meeting_id === meetingId && a.user_id === userId && a.leave_time === null)
        ? { ...a, leave_time: new Date().toISOString(), duration_seconds: a.duration_seconds + duration, status }
        : a
    );
    saveLocalDb(db);
    return { rows: [] };
  }

  // 12. INSERT INTO chat_messages
  if (query.startsWith('INSERT INTO chat_messages')) {
    const id = crypto.randomUUID();
    const chat = {
      id,
      meeting_id: params[0],
      user_id: params[1],
      message: params[2],
      sent_at: new Date().toISOString()
    };
    db.chat_messages.push(chat);
    saveLocalDb(db);
    return { rows: [chat] };
  }

  // 13. INSERT INTO noise_events
  if (query.startsWith('INSERT INTO noise_events')) {
    const id = crypto.randomUUID();
    const noise = {
      id,
      meeting_id: params[0],
      user_id: params[1],
      noise_type: params[2],
      warning_sent: params[3],
      auto_muted: params[4],
      created_at: new Date().toISOString()
    };
    db.noise_events.push(noise);
    saveLocalDb(db);
    return { rows: [noise] };
  }

  // 14. INSERT INTO participation_metrics
  if (query.startsWith('INSERT INTO participation_metrics')) {
    const metric = {
      id: crypto.randomUUID(),
      meeting_id: params[0],
      user_id: params[1],
      speaking_duration: 0,
      hand_raises_count: 0,
      chat_messages_count: 0,
      responses_count: 0,
      score: params[2] || 0.0,
      updated_at: new Date().toISOString()
    };
    // Avoid duplicate
    db.participation_metrics = db.participation_metrics.filter(m => !(m.meeting_id === params[0] && m.user_id === params[1]));
    db.participation_metrics.push(metric);
    saveLocalDb(db);
    return { rows: [metric] };
  }

  // 15. UPDATE participation_metrics
  if (query.startsWith('UPDATE participation_metrics')) {
    const speaking = params[0];
    const handRaises = params[1];
    const chatMsgs = params[2];
    const responses = params[3];
    const score = params[4];
    const meetingId = params[5];
    const userId = params[6];
    
    db.participation_metrics = db.participation_metrics.map(m => 
      (m.meeting_id === meetingId && m.user_id === userId)
        ? { ...m, speaking_duration: speaking, hand_raises_count: handRaises, chat_messages_count: chatMsgs, responses_count: responses, score, updated_at: new Date().toISOString() }
        : m
    );
    saveLocalDb(db);
    return { rows: [] };
  }

  // 16. INSERT INTO transcripts
  if (query.startsWith('INSERT INTO transcripts')) {
    const id = crypto.randomUUID();
    const trans = {
      id,
      meeting_id: params[0],
      speaker_id: params[1],
      text: params[2],
      timestamp: new Date().toISOString()
    };
    db.transcripts.push(trans);
    saveLocalDb(db);
    return { rows: [trans] };
  }

  // 17. INSERT INTO ai_analytics ON CONFLICT
  if (query.startsWith('INSERT INTO ai_analytics')) {
    const meetingId = params[0];
    const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
    
    const newAnalytics = {
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      data,
      updated_at: new Date().toISOString()
    };
    
    db.ai_analytics = db.ai_analytics.filter(a => a.meeting_id !== meetingId);
    db.ai_analytics.push(newAnalytics);
    saveLocalDb(db);
    return { rows: [newAnalytics] };
  }

  // 18. INSERT INTO reports ON CONFLICT
  if (query.startsWith('INSERT INTO reports')) {
    const meetingId = params[0];
    const summary = params[1];
    const topics = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
    const homework = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
    const actionItems = typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4];
    const metricsData = typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5];

    const report = {
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      summary,
      topics,
      homework,
      action_items: actionItems,
      metrics: metricsData,
      created_at: new Date().toISOString()
    };

    db.reports = db.reports.filter(r => r.meeting_id !== meetingId);
    db.reports.push(report);
    saveLocalDb(db);
    return { rows: [report] };
  }

  // 19. SELECT * FROM reports WHERE meeting_id = $1
  if (query.startsWith('SELECT * FROM reports WHERE meeting_id =')) {
    const meetingId = params[0];
    const rows = db.reports.filter(r => r.meeting_id === meetingId);
    return { rows };
  }

  // 20. INSERT INTO meeting_timeline
  if (query.startsWith('INSERT INTO meeting_timeline')) {
    const id = crypto.randomUUID();
    const event = {
      id,
      meeting_id: params[0],
      event_type: params[1],
      description: params[2],
      created_at: new Date().toISOString()
    };
    db.meeting_timeline.push(event);
    saveLocalDb(db);
    return { rows: [event] };
  }

  // 21. SELECT * FROM meeting_timeline
  if (query.startsWith('SELECT * FROM meeting_timeline WHERE meeting_id =')) {
    const meetingId = params[0];
    const rows = db.meeting_timeline
      .filter(e => e.meeting_id === meetingId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return { rows };
  }

  // 22. INSERT INTO questions_answers
  if (query.startsWith('INSERT INTO questions_answers')) {
    const id = crypto.randomUUID();
    const qa = {
      id,
      meeting_id: params[0],
      question_text: params[1],
      asked_by_id: params[2],
      asked_by_name: params[3],
      answer_text: null,
      answered_by_id: null,
      answered_by_name: null,
      asked_at: new Date().toISOString(),
      answered_at: null,
      duration_seconds: null
    };
    db.questions_answers.push(qa);
    saveLocalDb(db);
    return { rows: [qa] };
  }

  // 23. UPDATE questions_answers
  if (query.startsWith('UPDATE questions_answers')) {
    const answerText = params[0];
    const answeredById = params[1];
    const answeredByName = params[2];
    const durationSeconds = params[3];
    const qaId = params[4];
    
    db.questions_answers = db.questions_answers.map(qa => 
      qa.id === qaId 
        ? { ...qa, answer_text: answerText, answered_by_id: answeredById, answered_by_name: answeredByName, answered_at: new Date().toISOString(), duration_seconds: durationSeconds }
        : qa
    );
    saveLocalDb(db);
    return { rows: [] };
  }

  // 24. SELECT * FROM questions_answers
  if (query.startsWith('SELECT * FROM questions_answers WHERE meeting_id =')) {
    const meetingId = params[0];
    const rows = db.questions_answers
      .filter(qa => qa.meeting_id === meetingId)
      .sort((a, b) => new Date(a.asked_at).getTime() - new Date(b.asked_at).getTime());
    return { rows };
  }

  return { rows: [] };
}

// High-integrity intercepting query function
export async function dbQuery(text: string, params: any[] = []): Promise<{ rows: any[] }> {
  if (useLocalFallback) {
    return executeLocalQuery(text, params);
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("Database connection lost. Swapping to local JSON DB fallback...");
    useLocalFallback = true;
    return executeLocalQuery(text, params);
  }
}

// Intercept pool.query for modules
pool.query = dbQuery as any;

// Automated database migration function
export async function runMigrations() {
  console.log("Checking database connection...");
  let client;
  try {
    client = await pool.connect();
    console.log("Postgres database connected successfully.");
  } catch (error) {
    console.warn("=========================================================");
    console.warn("⚠️  Supabase Postgres connection failed (IPv6/Port blocked).");
    console.warn("⚠️  Resilient fallback: Bootstrapping offline JSON Database.");
    console.warn("=========================================================");
    useLocalFallback = true;
    getLocalDb(); // Boot JSON database
    return;
  }

  try {
    console.log("Running PostgreSQL migrations...");
    
    // Enable UUID extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT CHECK (role IN ('teacher', 'student')) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Meetings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT CHECK (status IN ('scheduled', 'live', 'ended')) DEFAULT 'scheduled' NOT NULL,
        scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        locked BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Participants Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        socket_id TEXT,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        left_at TIMESTAMP WITH TIME ZONE,
        status TEXT CHECK (status IN ('waiting', 'admitted', 'rejected')) DEFAULT 'waiting' NOT NULL,
        is_muted BOOLEAN DEFAULT FALSE NOT NULL,
        is_camera_off BOOLEAN DEFAULT FALSE NOT NULL,
        hand_raised BOOLEAN DEFAULT FALSE NOT NULL,
        CONSTRAINT unique_meeting_participant UNIQUE (meeting_id, user_id)
      );
    `);

    // Attendance Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        join_time TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        leave_time TIMESTAMP WITH TIME ZONE,
        duration_seconds INTEGER DEFAULT 0 NOT NULL,
        status TEXT CHECK (status IN ('present', 'late', 'left_early', 'disconnected')) DEFAULT 'present' NOT NULL
      );
    `);

    // Chat Messages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Noise Events Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS noise_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        noise_type TEXT CHECK (noise_type IN ('fan', 'tv', 'music', 'vehicle', 'dog', 'conversation')) NOT NULL,
        warning_sent BOOLEAN DEFAULT FALSE NOT NULL,
        auto_muted BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Participation Metrics Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS participation_metrics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        speaking_duration INTEGER DEFAULT 0 NOT NULL,
        hand_raises_count INTEGER DEFAULT 0 NOT NULL,
        chat_messages_count INTEGER DEFAULT 0 NOT NULL,
        responses_count INTEGER DEFAULT 0 NOT NULL,
        score FLOAT DEFAULT 0.0 NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        CONSTRAINT unique_meeting_user UNIQUE (meeting_id, user_id)
      );
    `);

    // Transcripts Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transcripts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // AI Analytics Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analytics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE UNIQUE,
        data JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Reports Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE UNIQUE,
        summary TEXT NOT NULL,
        topics JSONB NOT NULL,
        homework JSONB NOT NULL,
        action_items JSONB NOT NULL,
        metrics JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    // Questions Answers Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS questions_answers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        asked_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        asked_by_name TEXT NOT NULL,
        answer_text TEXT,
        answered_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
        answered_by_name TEXT,
        asked_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        answered_at TIMESTAMP WITH TIME ZONE,
        duration_seconds INTEGER
      );
    `);

    // Meeting Timeline Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS meeting_timeline (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
      );
    `);

    console.log("PostgreSQL database migrations completed successfully.");
  } catch (error) {
    console.error("Failed to run database migrations:", error);
    throw error;
  } finally {
    client.release();
  }
}
