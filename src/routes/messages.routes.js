import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../config/db.js';
import { messages, bookings, workers } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Verify the requesting user is either the client or the assigned worker
// for this booking — used by both the history endpoint and the socket handler.
export async function canAccessBookingChat(userId, userRole, bookingId) {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) return false;
  if (booking.clientId === userId) return true;
  if (userRole === 'worker') {
    const [workerRow] = await db.select({ id: workers.id })
      .from(workers).where(eq(workers.userId, userId));
    return workerRow && booking.workerId === workerRow.id;
  }
  return false;
}

// GET /bookings/:id/messages — load chat history when screen opens
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: { message: 'Not authenticated' } });

    const bookingId = Number(req.params.id);
    const allowed = await canAccessBookingChat(req.user.id, req.user.role, bookingId);
    if (!allowed) return res.status(403).json({ error: { message: 'Access denied' } });

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.bookingId, bookingId))
      .orderBy(asc(messages.createdAt));

    res.json({ data: rows });
  } catch (err) {
    console.error('GET /bookings/:id/messages error:', err);
    res.status(500).json({ error: { message: 'Failed to load messages' } });
  }
});

export default router;
