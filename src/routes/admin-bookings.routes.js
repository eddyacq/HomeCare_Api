import { Router } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, workers, users } from '../db/schema.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';
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
 * GET /admin/bookings
 * GET /admin/bookings?status=pending,confirmed
 *
 * Full booking list for the admin dashboard, joined with client and
 * worker names. Unlike the client/worker-facing routes, this has no
 * ownership filter -- admins see every booking in the system.
 */
router.get('/', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.query;

    // Drizzle doesn't have a clean way to alias the same table twice in
    // one query builder chain without raw SQL, so this does two joins
    // against `users` via different paths: once directly for the client,
    // once through `workers` for the worker's name. Using leftJoin for
    // both since workerId/worker info can be null (unassigned booking).
    const clientUsers = users;

    const rows = await db
      .select({
        id: bookings.id,
        serviceType: bookings.serviceType,
        status: bookings.status,
        scheduledAt: bookings.scheduledAt,
        address: bookings.address,
        notes: bookings.notes,
        createdAt: bookings.createdAt,
        cancelledBy: bookings.cancelledBy,
        cancellationReason: bookings.cancellationReason,
        clientId: bookings.clientId,
        clientName: clientUsers.name,
        clientPhone: clientUsers.phone,
        workerId: bookings.workerId,
      })
      .from(bookings)
      .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
      .orderBy(desc(bookings.scheduledAt));

    // Worker names fetched separately and merged in -- avoids the
    // double-join-on-same-table problem cleanly, at the cost of one
    // extra query. Fine at this scale; revisit with a raw SQL alias
    // if the bookings table ever gets large enough for this to matter.
    const workerRows = await db
      .select({ workerId: workers.id, name: users.name, phone: users.phone })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId));

    const workerMap = new Map(workerRows.map((w) => [w.workerId, w]));

    let result = rows.map((row) => ({
      ...row,
      workerName: row.workerId ? workerMap.get(row.workerId)?.name ?? null : null,
      workerPhone: row.workerId ? workerMap.get(row.workerId)?.phone ?? null : null,
    }));

    if (status) {
      const statusList = status.split(',');
      result = result.filter((b) => statusList.includes(b.status));
    }

    res.json({ data: result });
  } catch (err) {
    console.error('GET /admin/bookings error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch bookings' } });
  }
});

/**
 * PATCH /admin/bookings/:id/reassign
 * Body: { workerId }
 *
 * Admin manually assigns or changes the worker on a booking -- e.g. the
 * original worker can't make it, or a booking was created without one.
 * Allowed on pending/confirmed/on_the_way/in_progress bookings; not on
 * completed/cancelled ones, since reassigning a finished job doesn't
 * make sense.
 *
 * Resets status to 'pending' if it was already past pending, so the new
 * worker gets a normal accept/decline prompt rather than being silently
 * forced into a job already marked confirmed/in-progress by someone else.
 */
router.patch('/:id/reassign', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId } = req.body;

    if (!workerId) {
      return res.status(400).json({ error: { message: 'workerId is required' } });
    }

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, Number(id)));
    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }
    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(409).json({ error: { message: 'Cannot reassign a completed or cancelled booking' } });
    }

    const [newWorker] = await db
      .select({ id: workers.id, userId: workers.userId, isAvailable: workers.isAvailable })
      .from(workers)
      .where(eq(workers.id, Number(workerId)));

    if (!newWorker) {
      return res.status(404).json({ error: { message: 'Worker not found' } });
    }

    const [updated] = await db
      .update(bookings)
      .set({
        workerId: newWorker.id,
        status: 'pending', // give the newly-assigned worker a fresh accept/decline prompt
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, Number(id)))
      .returning();

    sendPushToUser(newWorker.userId, {
      title: 'New job request',
      body: `You've been assigned a ${SERVICE_LABELS[booking.serviceType] || booking.serviceType} job by an admin.`,
      data: { type: 'new_booking', bookingId: booking.id },
    });

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /admin/bookings/:id/reassign error:', err);
    res.status(500).json({ error: { message: 'Failed to reassign booking' } });
  }
});

/**
 * PATCH /admin/bookings/:id/cancel
 * Body: { reason? }
 *
 * Admin force-cancels a booking regardless of who created it or what
 * state it's in (short of already completed/cancelled). Notifies
 * whichever party (client, worker, or both) is relevant.
 */
router.patch('/:id/cancel', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, Number(id)));
    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }
    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(409).json({ error: { message: 'This booking is already completed or cancelled' } });
    }

    const [updated] = await db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledBy: 'admin',
        cancellationReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, Number(id)))
      .returning();

    sendPushToUser(booking.clientId, {
      title: 'Booking cancelled',
      body: 'Your booking was cancelled by HomeCare Connect support.',
      data: { type: 'booking_cancelled', bookingId: booking.id },
    });

    if (booking.workerId) {
      const [worker] = await db.select({ userId: workers.userId }).from(workers).where(eq(workers.id, booking.workerId));
      if (worker) {
        sendPushToUser(worker.userId, {
          title: 'Booking cancelled',
          body: 'A booking assigned to you was cancelled by an admin.',
          data: { type: 'booking_cancelled', bookingId: booking.id },
        });
      }
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /admin/bookings/:id/cancel error:', err);
    res.status(500).json({ error: { message: 'Failed to cancel booking' } });
  }
});

/**
 * PATCH /admin/bookings/:id/force-complete
 *
 * Admin marks a booking completed directly, bypassing the worker's
 * normal on_the_way -> in_progress -> completed progression. Useful
 * when a worker forgot to update status but the job genuinely happened,
 * or in a dispute where the admin is making a judgment call.
 *
 * Still bumps the worker's jobsCompleted counter, same as the normal
 * /advance route, so the count stays accurate regardless of which path
 * got a booking to "completed."
 */
router.patch('/:id/force-complete', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, Number(id)));
    if (!booking) {
      return res.status(404).json({ error: { message: 'Booking not found' } });
    }
    if (booking.status === 'completed') {
      return res.status(409).json({ error: { message: 'This booking is already completed' } });
    }
    if (booking.status === 'cancelled') {
      return res.status(409).json({ error: { message: 'Cannot complete a cancelled booking' } });
    }
    if (!booking.workerId) {
      return res.status(409).json({ error: { message: 'Cannot complete a booking with no assigned worker' } });
    }

    const [updated] = await db
      .update(bookings)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(bookings.id, Number(id)))
      .returning();

    await db
      .update(workers)
      .set({ jobsCompleted: sql`${workers.jobsCompleted} + 1` })
      .where(eq(workers.id, booking.workerId));

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /admin/bookings/:id/force-complete error:', err);
    res.status(500).json({ error: { message: 'Failed to complete booking' } });
  }
});

export default router;