import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../config/db.js';
import { bookings, complaints, users, workers } from '../db/schema.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const router = Router();

/**
 * GET /admin/complaints
 * GET /admin/complaints?status=open,investigating
 *
 * Full complaint list, joined with the booking, the client who raised
 * it, and the worker on that booking (if any) -- an admin reading this
 * needs all three pieces of context to actually investigate anything.
 */
router.get('/', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.query;

    const rows = await db
      .select({
        id: complaints.id,
        category: complaints.category,
        description: complaints.description,
        attachmentUrl: complaints.attachmentUrl,
        status: complaints.status,
        adminNotes: complaints.adminNotes,
        resolvedAt: complaints.resolvedAt,
        createdAt: complaints.createdAt,
        bookingId: complaints.bookingId,
        bookingServiceType: bookings.serviceType,
        bookingStatus: bookings.status,
        bookingScheduledAt: bookings.scheduledAt,
        raisedById: complaints.raisedBy,
        raisedByName: users.name,
        raisedByPhone: users.phone,
        workerId: bookings.workerId,
      })
      .from(complaints)
      .leftJoin(bookings, eq(bookings.id, complaints.bookingId))
      .leftJoin(users, eq(users.id, complaints.raisedBy))
      .orderBy(desc(complaints.createdAt));

    // Worker names fetched separately and merged in, same approach as
    // /admin/bookings -- avoids double-joining `users` (once for the
    // client who raised it, once via `workers` for the assigned worker)
    // in a single Drizzle chain.
    const workerRows = await db
      .select({ workerId: workers.id, name: users.name })
      .from(workers)
      .innerJoin(users, eq(users.id, workers.userId));
    const workerMap = new Map(workerRows.map((w) => [w.workerId, w.name]));

    let result = rows.map((row) => ({
      ...row,
      workerName: row.workerId ? workerMap.get(row.workerId) ?? null : null,
    }));

    if (status) {
      const statusList = status.split(',');
      result = result.filter((c) => statusList.includes(c.status));
    }

    res.json({ data: result });
  } catch (err) {
    console.error('GET /admin/complaints error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch complaints' } });
  }
});

/**
 * PATCH /admin/complaints/:id
 * Body: { status?, adminNotes? }
 *
 * Admin updates a complaint's status and/or leaves an internal note.
 * status moving to 'resolved' or 'dismissed' stamps resolvedAt
 * automatically; moving back to 'open'/'investigating' clears it, so
 * resolvedAt always reflects "is this currently closed," not "was it
 * ever closed in the past."
 */
router.patch('/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const validStatuses = ['open', 'investigating', 'resolved', 'dismissed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${validStatuses.join(', ')}` } });
    }

    const [existing] = await db.select().from(complaints).where(eq(complaints.id, Number(id)));
    if (!existing) {
      return res.status(404).json({ error: { message: 'Complaint not found' } });
    }

    const updates = { updatedAt: new Date() };
    if (status !== undefined) {
      updates.status = status;
      updates.resolvedAt = ['resolved', 'dismissed'].includes(status) ? new Date() : null;
    }
    if (adminNotes !== undefined) {
      updates.adminNotes = adminNotes;
    }

    const [updated] = await db
      .update(complaints)
      .set(updates)
      .where(eq(complaints.id, Number(id)))
      .returning();

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /admin/complaints/:id error:', err);
    res.status(500).json({ error: { message: 'Failed to update complaint' } });
  }
});

export default router;