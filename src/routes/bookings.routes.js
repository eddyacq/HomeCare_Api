import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, workers, users, reviews } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /bookings
 *
 * Creates a new booking for the logged-in client.
 * req.user is set by requireAuth — it's the user's row from Postgres
 * (looked up by firebase_uid), so req.user.id is the internal user id.
 * It is null if this Firebase user has never called /auth/sync.
 *
 * Body: { workerId, serviceType, scheduledAt, address, notes? }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }
    const client = req.user;

    const { workerId, serviceType, scheduledAt, address, notes } = req.body;

    if (!workerId || !serviceType || !scheduledAt || !address) {
      return res.status(400).json({
        error: { message: 'workerId, serviceType, scheduledAt, and address are required' },
      });
    }

    // Confirm the worker exists and is available
    const [worker] = await db
      .select({ id: workers.id, isAvailable: workers.isAvailable })
      .from(workers)
      .where(eq(workers.id, Number(workerId)));

    if (!worker) {
      return res.status(404).json({ error: { message: 'Worker not found' } });
    }
    if (!worker.isAvailable) {
      return res.status(409).json({ error: { message: 'This worker is no longer available' } });
    }

    const [created] = await db
      .insert(bookings)
      .values({
        clientId: client.id,
        workerId: worker.id,
        serviceType,
        status: 'pending',
        scheduledAt: new Date(scheduledAt),
        address,
        notes: notes || null,
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /bookings error:', err);
    res.status(500).json({ error: { message: 'Failed to create booking' } });
  }
});

/**
 * GET /bookings/me
 *
 * Lists the logged-in client's bookings, most recent first, joined with
 * worker name for display, and left-joined with reviews so the client
 * app can tell whether a completed booking already has a review without
 * a second request. reviewRating/reviewComment are null when no review
 * exists yet (i.e. hasReview is false).
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }
    const client = req.user;

    const rows = await db
      .select({
        id: bookings.id,
        serviceType: bookings.serviceType,
        status: bookings.status,
        scheduledAt: bookings.scheduledAt,
        address: bookings.address,
        notes: bookings.notes,
        createdAt: bookings.createdAt,
        workerId: bookings.workerId,
        workerName: users.name,
        workerPhone: users.phone,
        reviewRating: reviews.rating,
        reviewComment: reviews.comment,
      })
      .from(bookings)
      .leftJoin(workers, eq(workers.id, bookings.workerId))
      .leftJoin(users, eq(users.id, workers.userId))
      .leftJoin(reviews, eq(reviews.bookingId, bookings.id))
      .where(eq(bookings.clientId, client.id))
      .orderBy(desc(bookings.scheduledAt));

    // hasReview is derived rather than stored — true whenever the left
    // join found a matching review row (reviewRating is non-null).
    const withReviewFlag = rows.map((row) => ({
      ...row,
      hasReview: row.reviewRating !== null,
    }));

    res.json({ data: withReviewFlag });
  } catch (err) {
    console.error('GET /bookings/me error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch bookings' } });
  }
});

/**
 * PATCH /bookings/:id/cancel
 *
 * Client cancels their own pending/confirmed booking.
 */
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
    }
    const client = req.user;

    const { id } = req.params;
    const { reason } = req.body;

    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, Number(id)), eq(bookings.clientId, client.id)));

    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }
    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(409).json({ error: { message: 'This booking can no longer be cancelled' } });
    }

    const [updated] = await db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledBy: 'client',
        cancellationReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, Number(id)))
      .returning();

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /bookings/:id/cancel error:', err);
    res.status(500).json({ error: { message: 'Failed to cancel booking' } });
  }
});

/**
 * PATCH /bookings/:id/advance
 *
 * Worker moves a CONFIRMED booking forward through its lifecycle:
 *   confirmed -> on_the_way -> in_progress -> completed
 *
 * Body: { status: 'on_the_way' | 'in_progress' | 'completed' }
 *
 * Deliberately only allows moving forward one step at a time (no
 * skipping straight from confirmed to completed) to keep the status
 * history meaningful — if you ever need an "I forgot to update status"
 * escape hatch later, that's a conscious follow-up, not implied by this
 * route's design.
 *
 * On reaching 'completed', bumps the worker's jobsCompleted counter —
 * this is the only place that counter changes, so it stays a true
 * count of finished jobs rather than something that could drift.
 */
router.patch('/:id/advance', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'worker') {
      return res.status(403).json({ error: { message: 'Only workers can update job status' } });
    }

    const { id } = req.params;
    const { status: nextStatus } = req.body;

    const validTransitions = {
      confirmed: 'on_the_way',
      on_the_way: 'in_progress',
      in_progress: 'completed',
    };

    const [workerRow] = await db
      .select({ id: workers.id })
      .from(workers)
      .where(eq(workers.userId, req.user.id));

    if (!workerRow) {
      return res.status(404).json({ error: { message: 'No worker profile found for this account.' } });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, Number(id)), eq(bookings.workerId, workerRow.id)));

    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }

    const expectedNext = validTransitions[booking.status];
    if (!expectedNext || nextStatus !== expectedNext) {
      return res.status(409).json({
        error: { message: `Cannot move from "${booking.status}" to "${nextStatus}"` },
      });
    }

    const [updated] = await db
      .update(bookings)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(bookings.id, Number(id)))
      .returning();

    if (nextStatus === 'completed') {
      await db
        .update(workers)
        .set({ jobsCompleted: sql`${workers.jobsCompleted} + 1` })
        .where(eq(workers.id, workerRow.id));
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /bookings/:id/advance error:', err);
    res.status(500).json({ error: { message: 'Failed to update booking status' } });
  }
});

export default router;