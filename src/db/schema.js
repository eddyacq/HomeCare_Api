import {
  mysqlTable,
  varchar,
  int,
  boolean,
  timestamp,
  mysqlEnum,
} from 'drizzle-orm/mysql-core';

// Phase 1 scope: just enough to back /auth/sync and /auth/me.
// workers, bookings, reviews, complaints tables get added as their
// matching API endpoints are built — see HomeCare_Connect_API_Reference.md
export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
  role: mysqlEnum('role', ['client', 'worker', 'admin']).notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  name: varchar('name', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});
