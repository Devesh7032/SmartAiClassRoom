import { Router, Request, Response, NextFunction } from 'express';
import { pool } from './db';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth';

export const router = Router();

// Middleware to authenticate requests via JWT
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: 'teacher' | 'student';
  };
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token as string);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

// Auth Routes
router.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (role !== 'teacher' && role !== 'student') {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const passwordHash = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), passwordHash, name, role]
    );

    const user = result.rows[0];
    const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });

    return res.status(201).json({ token, user });
  } catch (error: any) {
    if (error.code === '23505') { // Postgres unique_violation
      return res.status(400).json({ error: 'Email already registered' });
    }
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/auth/me', authenticateToken, (req: AuthRequest, res: Response) => {
  return res.json({ user: req.user });
});

// Meetings Routes
router.post('/meetings', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { title, scheduledAt } = req.body;
  const user = req.user;

  if (user?.role !== 'teacher') {
    return res.status(403).json({ error: 'Only teachers can create meetings' });
  }

  if (!title) {
    return res.status(400).json({ error: 'Meeting title is required' });
  }

  try {
    const time = scheduledAt ? new Date(scheduledAt) : new Date();
    const result = await pool.query(
      `INSERT INTO meetings (host_id, title, status, scheduled_at)
       VALUES ($1, $2, 'scheduled', $3)
       RETURNING *`,
      [user.id, title, time]
    );

    return res.status(201).json({ meeting: result.rows[0] });
  } catch (error) {
    console.error('Meeting creation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/meetings/:id', authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT m.*, u.name as host_name 
       FROM meetings m 
       JOIN users u ON m.host_id = u.id 
       WHERE m.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    return res.json({ meeting: result.rows[0] });
  } catch (error) {
    console.error('Get meeting error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Reports Routes
router.get('/reports/:meetingId', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { meetingId } = req.params;
  const user = req.user;

  // AI analytics & reports must be visible ONLY to teachers
  if (user?.role !== 'teacher') {
    return res.status(403).json({ error: 'Access denied: Analytics and reports are host-only resources.' });
  }

  try {
    const result = await pool.query('SELECT * FROM reports WHERE meeting_id = $1', [meetingId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found for this classroom session.' });
    }

    const report = result.rows[0];
    return res.json({ report });
  } catch (error) {
    console.error('Get report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Timeline Route
router.get('/meetings/:id/timeline', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM meeting_timeline WHERE meeting_id = $1 ORDER BY created_at ASC',
      [id]
    );
    return res.json({ timeline: result.rows });
  } catch (error) {
    console.error('Get meeting timeline error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Questions Route
router.get('/meetings/:id/questions', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM questions_answers WHERE meeting_id = $1 ORDER BY asked_at ASC',
      [id]
    );
    return res.json({ questions: result.rows });
  } catch (error) {
    console.error('Get meeting questions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
