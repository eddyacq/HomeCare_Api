import { Router } from 'express';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, reviews, workers, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /reviews
 * Body: { bookingId, rating, comment? }
 *
 * Client reviews a completed booking. Only allowed once per booking
 * (enforced by the unique constraint on reviews.bookingId, but checked
 * here too for a clean error message instead of a raw DB conflict).
 *
 * On success, recalculates the worker's ratingAverage and ratingCount.
 * These are denormalized on `workers` so list/sort queries don't need
 * to aggregate reviews every time — this is the only place that does
 * the aggregation and writes the result back.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }
    const client = req.user;

    const { bookingId, rating, comment } = req.body;

    if (!bookingId || !rating) {
      return res.status(400).json({ error: { message: 'bookingId and rating are required' } });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: { message: 'rating must be between 1 and 5' } });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, Number(bookingId)), eq(bookings.clientId, client.id)));

    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }
    if (booking.status !== 'completed') {
      return res.status(409).json({ error: { message: 'You can only review a completed booking' } });
    }
    if (!booking.workerId) {
      return res.status(409).json({ error: { message: 'This booking has no assigned worker to review' } });
    }

    const [existingReview] = await db.select().from(reviews).where(eq(reviews.bookingId, booking.id));
    if (existingReview) {
      return res.status(409).json({ error: { message: 'You\'ve already reviewed this booking' } });
    }

    const [created] = await db
      .insert(reviews)
      .values({
        bookingId: booking.id,
        clientId: client.id,
        workerId: booking.workerId,
        rating: Number(rating),
        comment: comment || null,
      })
      .returning();

    // Recalculate this worker's aggregate rating from all their reviews.
    const [agg] = await db
      .select({
        avg: sql`AVG(${reviews.rating})`,
        count: sql`COUNT(*)`,
      })
      .from(reviews)
      .where(eq(reviews.workerId, booking.workerId));

    await db
      .update(workers)
      .set({
        ratingAverage: Number(agg.avg).toFixed(2),
        ratingCount: Number(agg.count),
        updatedAt: new Date(),
      })
      .where(eq(workers.id, booking.workerId));

    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /reviews error:', err);
    res.status(500).json({ error: { message: 'Failed to submit review' } });
  }
});

/**
 * GET /reviews/worker/:workerId
 *
 * Public-ish list of a worker's reviews (still requires login, just not
 * restricted to a particular role) — used for a "see all reviews" screen
 * on a worker's profile in the client app.
 */
router.get('/worker/:workerId', requireAuth, async (req, res) => {
  try {
    const { workerId } = req.params;

    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        clientName: users.name,
      })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.clientId))
      .where(eq(reviews.workerId, Number(workerId)))
      .orderBy(desc(reviews.createdAt));

    res.json({ data: rows });
  } catch (err) {
    console.error('GET /reviews/worker/:workerId error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch reviews' } });
  }
});

export default router;