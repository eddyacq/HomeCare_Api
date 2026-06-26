import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, complaints } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const VALID_CATEGORIES = ['no_show', 'quality', 'behavior', 'safety', 'payment', 'other'];

/**
 * POST /complaints
 * Body: { bookingId, category, description, attachmentUrl? }
 *
 * Client-only for now (per current scope) -- files a complaint against
 * one of their own bookings. Doesn't require the booking to be in any
 * particular status: a client might report a no-show on a still-pending
 * booking, or quality issues after completion, so no status gate here
 * beyond ownership.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }
    const client = req.user;

    const { bookingId, category, description, attachmentUrl } = req.body;

    if (!bookingId || !category || !description) {
      return res.status(400).json({
        error: { message: 'bookingId, category, and description are required' },
      });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: { message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` },
      });
    }

    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, Number(bookingId)), eq(bookings.clientId, client.id)));

    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }

    const [created] = await db
      .insert(complaints)
      .values({
        bookingId: booking.id,
        raisedBy: client.id,
        category,
        description,
        attachmentUrl: attachmentUrl || null,
        status: 'open',
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /complaints error:', err);
    res.status(500).json({ error: { message: 'Failed to submit complaint' } });
  }
});

/**
 * GET /complaints/me
 *
 * Client's own complaint history -- lets them see status of things
 * they've reported without needing to contact support to ask.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }

    const rows = await db
      .select()
      .from(complaints)
      .where(eq(complaints.raisedBy, req.user.id))
      .orderBy(complaints.createdAt);

    res.json({ data: rows });
  } catch (err) {
    console.error('GET /complaints/me error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch complaints' } });
  }
});

export default router;