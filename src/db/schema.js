import {
  pgTable,
  varchar,
  integer,
  boolean,
  timestamp,
  pgEnum,
  text,
  decimal,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────
// ENUMS — Postgres requires these declared separately, then referenced
// inside the table definitions below.
// ─────────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ['client', 'worker', 'admin']);

export const serviceTypeEnum = pgEnum('service_type', [
  'cleaning',
  'laundry',
  'housekeeping',
  'nanny',
  'babysitter',
]);

export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'on_the_way',
  'in_progress',
  'completed',
  'cancelled',
]);

export const cancelledByEnum = pgEnum('cancelled_by', ['client', 'worker', 'admin']);

export const complaintCategoryEnum = pgEnum('complaint_category', [
  'no_show',
  'quality',
  'behavior',
  'safety',
  'payment',
  'other',
]);

export const complaintStatusEnum = pgEnum('complaint_status', [
  'open',
  'investigating',
  'resolved',
  'dismissed',
]);

// ─────────────────────────────────────────────────────────────────────────
// USERS — clients, workers, and admins all live here.
// Worker-specific fields (skills, languages, etc.) live in `workers` below,
// joined 1:1 by userId.
// ─────────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
  role: roleEnum('role').notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  fcmToken: varchar('fcm_token', { length: 255 }), // for push notifications; null until app registers one
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// WORKERS — extra profile data for users with role = 'worker'.
// Created by admin when onboarding a worker.
// ─────────────────────────────────────────────────────────────────────────
export const workers = pgTable('workers', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  userId: integer('user_id').notNull().unique(), // FK -> users.id

  skills: varchar('skills', { length: 500 }),       // e.g. "cleaning,laundry"
  languages: varchar('languages', { length: 255 }), // e.g. "English,Twi,Ga"

  bio: text('bio'),
  profilePhotoUrl: varchar('profile_photo_url', { length: 500 }),

  isAvailable: boolean('is_available').notNull().default(true),
  isChildcareVerified: boolean('is_childcare_verified').notNull().default(false),

  ratingAverage: decimal('rating_average', { precision: 3, scale: 2 }).default('0.00'),
  ratingCount: integer('rating_count').notNull().default(0),
  jobsCompleted: integer('jobs_completed').notNull().default(0),

  adminRemark: text('admin_remark'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// BOOKINGS — the core transaction. One row per service request.
// ─────────────────────────────────────────────────────────────────────────
export const bookings = pgTable('bookings', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),

  clientId: integer('client_id').notNull(), // FK -> users.id
  workerId: integer('worker_id'),           // FK -> workers.id, null until assigned

  serviceType: serviceTypeEnum('service_type').notNull(),
  status: bookingStatusEnum('status').notNull().default('pending'),

  scheduledAt: timestamp('scheduled_at').notNull(),
  isRecurring: boolean('is_recurring').notNull().default(false),

  address: varchar('address', { length: 500 }),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),

  notes: text('notes'),

  cancelledBy: cancelledByEnum('cancelled_by'),
  cancellationReason: text('cancellation_reason'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// REVIEWS — one per completed booking, written by the client.
// ─────────────────────────────────────────────────────────────────────────
export const reviews = pgTable('reviews', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),

  bookingId: integer('booking_id').notNull().unique(), // FK -> bookings.id
  clientId: integer('client_id').notNull(),             // FK -> users.id
  workerId: integer('worker_id').notNull(),             // FK -> workers.id

  rating: integer('rating').notNull(), // 1–5
  comment: text('comment'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// COMPLAINTS — raised by a client (or worker) against a booking.
// ─────────────────────────────────────────────────────────────────────────
export const complaints = pgTable('complaints', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),

  bookingId: integer('booking_id').notNull(), // FK -> bookings.id
  raisedBy: integer('raised_by').notNull(),   // FK -> users.id

  category: complaintCategoryEnum('category').notNull(),
  description: text('description').notNull(),
  attachmentUrl: varchar('attachment_url', { length: 500 }),

  status: complaintStatusEnum('status').notNull().default('open'),

  adminNotes: text('admin_notes'),
  resolvedAt: timestamp('resolved_at'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// ADMINS — separate from `users`/Firebase entirely. Own email+password
// auth, own JWT issued by the Express API on login.
// ─────────────────────────────────────────────────────────────────────────
export const admins = pgTable('admins', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
// import {
//   mysqlTable,
//   varchar,
//   int,
//   boolean,
//   timestamp,
//   mysqlEnum,
//   text,
//   decimal,
// } from 'drizzle-orm/mysql-core';

// // ─────────────────────────────────────────────────────────────────────────
// // USERS — clients, workers, and admins all live here.
// // Worker-specific fields (skills, languages, etc.) live in `workers` below,
// // joined 1:1 by userId.
// // ─────────────────────────────────────────────────────────────────────────
// export const users = mysqlTable('users', {
//   id: int('id').autoincrement().primaryKey(),
//   firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
//   role: mysqlEnum('role', ['client', 'worker', 'admin']).notNull(),
//   phone: varchar('phone', { length: 20 }),
//   email: varchar('email', { length: 255 }),
//   name: varchar('name', { length: 255 }),
//   isActive: boolean('is_active').notNull().default(true),
//   createdAt: timestamp('created_at').notNull().defaultNow(),
//   updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
// });

// // ─────────────────────────────────────────────────────────────────────────
// // WORKERS — extra profile data for users with role = 'worker'.
// // Created by admin when onboarding a worker (per your doc — workers don't
// // self-register).
// // ─────────────────────────────────────────────────────────────────────────
// export const workers = mysqlTable('workers', {
//   id: int('id').autoincrement().primaryKey(),
//   userId: int('user_id').notNull().unique(), // FK -> users.id

//   // Comma-separated for now — move to a join table if you need to filter
//   // by individual skill later (e.g. "cleaning,laundry,housekeeping")
//   skills: varchar('skills', { length: 500 }),
//   languages: varchar('languages', { length: 255 }), // e.g. "English,Twi,Ga"

//   bio: text('bio'),
//   profilePhotoUrl: varchar('profile_photo_url', { length: 500 }),

//   isAvailable: boolean('is_available').notNull().default(true),
//   isChildcareVerified: boolean('is_childcare_verified').notNull().default(false),

//   // Denormalized for fast list/sort queries — recalculated whenever a
//   // review is added (see reviews table below)
//   ratingAverage: decimal('rating_average', { precision: 3, scale: 2 }).default('0.00'),
//   ratingCount: int('rating_count').notNull().default(0),
//   jobsCompleted: int('jobs_completed').notNull().default(0),

//   // Admin notes — visible to clients as the "agency remark" on a profile
//   adminRemark: text('admin_remark'),

//   createdAt: timestamp('created_at').notNull().defaultNow(),
//   updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
// });

// // ─────────────────────────────────────────────────────────────────────────
// // BOOKINGS — the core transaction. One row per service request.
// // ─────────────────────────────────────────────────────────────────────────
// export const bookings = mysqlTable('bookings', {
//   id: int('id').autoincrement().primaryKey(),

//   clientId: int('client_id').notNull(),  // FK -> users.id
//   workerId: int('worker_id'),            // FK -> workers.id, null until assigned

//   serviceType: mysqlEnum('service_type', [
//     'cleaning',
//     'laundry',
//     'housekeeping',
//     'nanny',
//     'babysitter',
//   ]).notNull(),

//   status: mysqlEnum('status', [
//     'pending',      // just created, awaiting worker assignment
//     'confirmed',    // worker assigned and accepted
//     'on_the_way',
//     'in_progress',
//     'completed',
//     'cancelled',
//   ]).notNull().default('pending'),

//   scheduledAt: timestamp('scheduled_at').notNull(),
//   isRecurring: boolean('is_recurring').notNull().default(false),

//   address: varchar('address', { length: 500 }),
//   latitude: decimal('latitude', { precision: 10, scale: 7 }),
//   longitude: decimal('longitude', { precision: 10, scale: 7 }),

//   notes: text('notes'), // client's special instructions

//   cancelledBy: mysqlEnum('cancelled_by', ['client', 'worker', 'admin']),
//   cancellationReason: text('cancellation_reason'),

//   createdAt: timestamp('created_at').notNull().defaultNow(),
//   updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
// });

// // ─────────────────────────────────────────────────────────────────────────
// // REVIEWS — one per completed booking, written by the client.
// // ─────────────────────────────────────────────────────────────────────────
// export const reviews = mysqlTable('reviews', {
//   id: int('id').autoincrement().primaryKey(),

//   bookingId: int('booking_id').notNull().unique(), // FK -> bookings.id
//   clientId: int('client_id').notNull(),            // FK -> users.id
//   workerId: int('worker_id').notNull(),            // FK -> workers.id

//   rating: int('rating').notNull(),  // 1–5
//   comment: text('comment'),

//   createdAt: timestamp('created_at').notNull().defaultNow(),
// });

// // ─────────────────────────────────────────────────────────────────────────
// // COMPLAINTS — raised by a client (or worker) against a booking.
// // ─────────────────────────────────────────────────────────────────────────
// export const complaints = mysqlTable('complaints', {
//   id: int('id').autoincrement().primaryKey(),

//   bookingId: int('booking_id').notNull(), // FK -> bookings.id
//   raisedBy: int('raised_by').notNull(),   // FK -> users.id

//   category: mysqlEnum('category', [
//     'no_show',
//     'quality',
//     'behavior',
//     'safety',
//     'payment',
//     'other',
//   ]).notNull(),

//   description: text('description').notNull(),
//   attachmentUrl: varchar('attachment_url', { length: 500 }),

//   status: mysqlEnum('status', ['open', 'investigating', 'resolved', 'dismissed'])
//     .notNull()
//     .default('open'),

//   adminNotes: text('admin_notes'),
//   resolvedAt: timestamp('resolved_at'),

//   createdAt: timestamp('created_at').notNull().defaultNow(),
//   updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
// });