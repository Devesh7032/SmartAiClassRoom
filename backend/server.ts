import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { runMigrations } from './src/db';
import { router } from './src/routes';
import { setupWebSockets } from './src/socket';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json());

// Main Router API registration
app.use('/api', router);

// Default test route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Setup WebSocket server
setupWebSockets(server);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Run Supabase database migrations on launch
    await runMigrations();

    server.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Smart Classroom Backend listening on port ${PORT}`);
      console.log(`====================================================`);
    });
  } catch (error) {
    console.error("Failed to start Smart Classroom Backend Server:", error);
    process.exit(1);
  }
}

startServer();
