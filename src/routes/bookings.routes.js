import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, workers, users, reviews } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPushToUser } from '../config/notifications.js';

const router = Router();

const SERVICE_LABELS = {
  cleaning: 'Cleaning',
  laundry: 'Laundry',
  housekeeping: 'Housekeeping',
  nanny: 'Nanny',
  babysitter: 'Babysitter',
};

/**
 * POST /bookings
 *
 * Creates a new booking for the logged-in client, then pushes a
 * notification to the assigned worker so they don't have to be sitting
 * in the app to know a job is waiting for their response.
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

    const [worker] = await db
      .select({ id: workers.id, userId: workers.userId, isAvailable: workers.isAvailable })
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

    sendPushToUser(worker.userId, {
      title: 'New job request',
      body: `${client.name || 'A client'} needs ${SERVICE_LABELS[serviceType] || serviceType} help`,
      data: { type: 'new_booking', bookingId: created.id },
    });

    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /bookings error:', err);
    res.status(500).json({ error: { message: 'Failed to create booking' } });
  }
});

/**
 * GET /bookings/me
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

    if (booking.workerId) {
      const [worker] = await db.select({ userId: workers.userId }).from(workers).where(eq(workers.id, booking.workerId));
      if (worker) {
        sendPushToUser(worker.userId, {
          title: 'Booking cancelled',
          body: `The client cancelled the ${SERVICE_LABELS[booking.serviceType] || booking.serviceType} booking.`,
          data: { type: 'booking_cancelled', bookingId: booking.id },
        });
      }
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /bookings/:id/cancel error:', err);
    res.status(500).json({ error: { message: 'Failed to cancel booking' } });
  }
});

/**
 * PATCH /bookings/:id/respond
 */
router.patch('/:id/respond', requireAuth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'worker') {
      return res.status(403).json({ error: { message: 'Only workers can respond to job requests' } });
    }

    const { id } = req.params;
    const { action, reason } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: { message: "action must be 'accept' or 'decline'" } });
    }

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
    if (booking.status !== 'pending') {
      return res.status(409).json({ error: { message: 'This booking has already been responded to' } });
    }

    const [updated] = await db
      .update(bookings)
      .set(
        action === 'accept'
          ? { status: 'confirmed', updatedAt: new Date() }
          : {
              status: 'cancelled',
              cancelledBy: 'worker',
              cancellationReason: reason || null,
              updatedAt: new Date(),
            }
      )
      .where(eq(bookings.id, Number(id)))
      .returning();

    sendPushToUser(booking.clientId, {
      title: action === 'accept' ? 'Booking confirmed!' : 'Worker unavailable',
      body:
        action === 'accept'
          ? `Your ${SERVICE_LABELS[booking.serviceType] || booking.serviceType} booking has been confirmed.`
          : `Your worker can't take this job. We'll help you find another.`,
      data: { type: action === 'accept' ? 'booking_confirmed' : 'booking_declined', bookingId: booking.id },
    });

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /bookings/:id/respond error:', err);
    res.status(500).json({ error: { message: 'Failed to respond to booking' } });
  }
});

/**
 * PATCH /bookings/:id/advance
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

    const statusMessages = {
      on_the_way: 'Your worker is on the way!',
      in_progress: 'Your service has started.',
      completed: 'Your service is complete. Tap to leave a review!',
    };

    sendPushToUser(booking.clientId, {
      title: statusMessages[nextStatus],
      body: `${SERVICE_LABELS[booking.serviceType] || booking.serviceType} booking update`,
      data: { type: 'status_update', status: nextStatus, bookingId: booking.id },
    });

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /bookings/:id/advance error:', err);
    res.status(500).json({ error: { message: 'Failed to update booking status' } });
  }
});
//nice
export default router;