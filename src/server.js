import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db } from './config/db.js';
import { messages, users } from './db/schema.js';
import { firebaseAuth } from './config/firebase.js';
import { canAccessBookingChat } from './routes/messages.routes.js';
import authRoutes from './routes/auth.routes.js';
import workersRoutes from './routes/workers.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import adminAuthRoutes from './routes/admin-auth.routes.js';
import adminWorkersRoutes from './routes/admin-workers.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import fcmRoutes from './routes/fcm.routes.js';
import messagesRoutes from './routes/messages.routes.js';

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
app.use('/messages', messagesRoutes);


const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });


// ── Socket.IO chat ────────────────────────────────────────────────────────
// Authentication: client sends Firebase ID token in socket handshake auth.
// We verify it and look up the user before allowing any room join.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('NO_TOKEN'));

    const decoded = await firebaseAuth.verifyIdToken(token);
    const [user] = await db.select().from(users).where(eq(users.firebaseUid, decoded.uid));
    if (!user) return next(new Error('USER_NOT_SYNCED'));

    socket.user = user;
    next();
  } catch {
    next(new Error('INVALID_TOKEN'));
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (user ${socket.user.id})`);

  // Client joins a booking-scoped room. Only the client and assigned worker
  // for that booking are allowed in — anyone else is silently refused.
  socket.on('join_booking', async (bookingId) => {
    const id = Number(bookingId);
    const allowed = await canAccessBookingChat(socket.user.id, socket.user.role, id);
    if (!allowed) {
      socket.emit('error', { message: 'Access denied' });
      return;
    }
    socket.join(`booking:${id}`);
    console.log(`User ${socket.user.id} joined booking:${id}`);
  });

  // Client sends a message. Persist to DB then broadcast to the room.
  socket.on('message:send', async ({ bookingId, text }) => {
    const id = Number(bookingId);
    if (!text?.trim()) return;

    const allowed = await canAccessBookingChat(socket.user.id, socket.user.role, id);
    if (!allowed) return;

    try {
      const [saved] = await db.insert(messages).values({
        bookingId: id,
        senderId: socket.user.id,
        text: text.trim(),
      }).returning();

      // Broadcast to everyone in the room (including sender for confirmation)
      io.to(`booking:${id}`).emit('message:new', {
        id: saved.id,
        bookingId: saved.bookingId,
        senderId: saved.senderId,
        senderName: socket.user.name,
        text: saved.text,
        createdAt: saved.createdAt,
      });
    } catch (err) {
      console.error('message:send error:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`HomeCare Connect API listening on port ${PORT}`);
});
