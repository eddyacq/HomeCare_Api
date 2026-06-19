import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.routes.js';
import workersRoutes from './routes/workers.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);
app.use('/workers', workersRoutes);
app.use('/bookings', bookingsRoutes);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  // Booking-scoped chat rooms (`booking:{id}`) get added here once the
  // bookings table exists.
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`HomeCare Connect API listening on port ${PORT}`);
});
