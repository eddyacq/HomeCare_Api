import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db } from './config/db.js';
import { messages, users, bookings, workers } from './db/schema.js';
import { firebaseAuth } from './config/firebase.js';
import { sendPush } from './config/notifications.js';
import { canAccessBookingChat } from './routes/messages.routes.js';
import authRoutes from './routes/auth.routes.js';
import fcmRoutes from './routes/fcm.routes.js';
import workersRoutes from './routes/workers.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import adminAuthRoutes from './routes/admin-auth.routes.js';
import adminWorkersRoutes from './routes/admin-workers.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import adminBookingsRoutes from './routes/admin-bookings.routes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);
app.use('/auth', fcmRoutes);
app.use('/workers', workersRoutes);
app.use('/bookings', bookingsRoutes);
app.use('/messages', messagesRoutes);
app.use('/admin/auth', adminAuthRoutes);
app.use('/admin/workers', adminWorkersRoutes);
app.use('/reviews', reviewsRoutes);
app.use('/admin/bookings', adminBookingsRoutes);

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

      // Push notification to the OTHER participant if they're not in the room.
      // Check room membership — if they're already in booking:{id} they'll get
      // the socket event and don't need a push on top of it.
      const room = io.sockets.adapter.rooms.get(`booking:${id}`);
      const socketsInRoom = room ? room.size : 0;

      // Only send push if the recipient isn't already in the room (i.e. < 2 people)
      if (socketsInRoom < 2) {
        try {
          const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
          if (booking) {
            let recipientUserId;
            if (socket.user.role === 'client') {
              // Sender is client — notify the worker
              const [workerRow] = await db.select({ userId: workers.userId })
                .from(workers).where(eq(workers.id, booking.workerId));
              recipientUserId = workerRow?.userId;
            } else {
              // Sender is worker — notify the client
              recipientUserId = booking.clientId;
            }

            if (recipientUserId) {
              const [recipient] = await db.select({ fcmToken: users.fcmToken })
                .from(users).where(eq(users.id, recipientUserId));
              const preview = text.trim().length > 60
                ? text.trim().substring(0, 60) + '…'
                : text.trim();
              sendPush(recipient?.fcmToken, {
                title: socket.user.name || 'New message',
                body: preview,
                data: { bookingId: String(id), type: 'new_message' },
              });
            }
          }
        } catch (pushErr) {
          // Never let a push failure affect the message delivery
          console.error('Chat push notification failed:', pushErr.message);
        }
      }
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