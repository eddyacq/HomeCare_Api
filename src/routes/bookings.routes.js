import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, workers, users } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * POST /bookings
 *
 * Creates a new booking for the logged-in client.
 * req.user is set by verifyFirebaseToken — expected to contain at least
 * the firebaseUid, which we use to look up the internal user id.
 *
 * Body: { workerId, serviceType, scheduledAt, address, notes? }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { workerId, serviceType, scheduledAt, address, notes } = req.body;

    if (!workerId || !serviceType || !scheduledAt || !address) {
      return res.status(400).json({
        error: { message: 'workerId, serviceType, scheduledAt, and address are required' },
      });
    }

    // Look up the internal user row for this Firebase user (the client)
    const [client] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, req.user.uid));

    if (!client) {
      return res.status(404).json({ error: { message: 'User not found. Please log in again.' } });
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
 * worker name for display. Optional ?status=pending,confirmed filter.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [client] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, req.user.uid));

    if (!client) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

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
      })
      .from(bookings)
      .leftJoin(workers, eq(workers.id, bookings.workerId))
      .leftJoin(users, eq(users.id, workers.userId))
      .where(eq(bookings.clientId, client.id))
      .orderBy(desc(bookings.scheduledAt));

    res.json({ data: rows });
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
    const { id } = req.params;
    const { reason } = req.body;

    const [client] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, req.user.uid));

    if (!client) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

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

export default router;