// import { defineConfig } from 'drizzle-kit';
// import 'dotenv/config';

// export default defineConfig({
//   schema: './src/db/schema.js',
//   out: './drizzle',
//   dialect: 'mysql',
//   dbCredentials: {
//     url: process.env.DATABASE_URL,
//   },
// });
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/db/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  },
  tablesFilter: ['users', 'workers', 'bookings', 'reviews', 'complaints', 'admins'],
});