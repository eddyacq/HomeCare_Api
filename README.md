# HomeCare Connect API — Phase 1 (auth)

Minimal Express + Drizzle + MySQL backend covering just enough to back the
Flutter phone-auth flow: `POST /v1/auth/sync` and `GET /v1/auth/me`.
Everything else in `HomeCare_Connect_API_Reference.md` (workers, bookings,
complaints, etc.) gets added the same way — a table in `schema.js`, a routes
file, mounted in `server.js`.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` — from Railway's MySQL "Connect" tab.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` —
  from a Firebase service account JSON (Project settings → Service accounts
  → Generate new private key). Paste the `private_key` value as-is, quotes
  included — the literal `\n`s in the JSON get unescaped at runtime.

Push the schema to your database:

```bash
npm run db:push
```

Run the server:

```bash
npm run dev
```

## Testing it against the Flutter app

Add the sync call right after `verifyOTP()` succeeds in `OtpVerifyPage`:

```dart
final idToken = await FirebaseAuth.instance.currentUser?.getIdToken();
final response = await http.post(
  Uri.parse('http://<your-machine-ip>:4000/v1/auth/sync'),
  headers: {
    'Authorization': 'Bearer $idToken',
    'Content-Type': 'application/json',
  },
  body: jsonEncode({'role': 'client', 'name': widget.name}),
);
```

Use your machine's LAN IP, not `localhost`, if testing on a physical device
or the Android emulator (`10.0.2.2` for the emulator's host loopback).

You can also test from the command line with a token copied out of the
running app (temporarily `print(await FirebaseAuth.instance.currentUser
?.getIdToken())` after login):

```bash
curl -X POST http://localhost:4000/v1/auth/sync \
  -H "Authorization: Bearer <paste-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"role":"client","name":"Eddy Kofi"}'
```

## What's next

1. Wire the sync call into the Flutter app (above).
2. Add the `workers` table + `/admin/workers` routes (admin creates worker
   accounts — see section 4 of the API reference).
3. Add `requireRole('admin')` checks on every admin route as they're built.
