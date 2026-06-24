import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.routes.js';
import workersRoutes from './routes/workers.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import adminAuthRoutes from './routes/admin-auth.routes.js';
import adminWorkersRoutes from './routes/admin-workers.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import fcmRoutes from './routes/fcm.routes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);
app.use('/workers', workersRoutes);
app.use('/bookings', bookingsRoutes);
app.use('/admin/auth', adminAuthRoutes);
app.use('/admin/workers', adminWorkersRoutes);
app.use('/reviews', reviewsRoutes);
app.use('/auth', fcmRoutes); // mounts POST /auth/fcm-token

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
