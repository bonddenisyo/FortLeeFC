# Commons — a minimal Meetup clone

A working prototype of the core Meetup loop: hosts create gatherings,
people sign up, capacity is enforced with an automatic waitlist, and
cancellations promote the next person in line. No build step, no paid
services.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Click **Sign in**, pick a name and a role
(host or attendee) — there's no password, this is a demo identity system
(see "What's simplified" below).

## How it's put together

```
server.js        Express app: routes + permission checks
lib/db.js         All data access. A JSON file today; swap for Postgres
                   or SQLite later without touching server.js.
public/           Vanilla JS frontend (no framework, no build step)
  index.html
  styles.css       "Ticket stub" visual identity
  app.js           Router, API calls, Leaflet map, Nominatim geocoding
data/db.json       The database file (auto-created, gitignored-worthy)
```

### Data model

- **users**: `id, name, role` (`host` | `user`)
- **events**: `id, title, date, time, placeName, lat, lng, capacity, hostId`
- **signups**: `id, eventId, userId, status, createdAt`
  - `status` is one of `attending`, `waitlisted`, `cancelled` — this one
    table drives all three lists the spec asked for.

### Core logic (in `lib/db.js`)

- **Sign up**: if fewer than `capacity` people are `attending`, the new
  signup is `attending`; otherwise it's `waitlisted`.
- **Cancel**: marks the signup `cancelled`. If the person was
  `attending`, the earliest `waitlisted` signup is automatically
  promoted to `attending`.
- Each event exposes `counts` (attending / waitlisted / cancelled /
  spotsLeft) so the UI never has to recompute it.

### Map integration

Uses **Leaflet** + **OpenStreetMap** tiles (free, no API key) for
display, and the free **Nominatim** geocoding API so a host can type an
address/venue name and drop a pin. Nominatim's usage policy caps casual
use at ~1 request/second and asks for a real User-Agent — fine for a
prototype or small deployment, but swap in Mapbox/Google Places (or your
own geocoder) if you expect real traffic.

## What's simplified (on purpose, for a prototype)

- **Auth**: signing in just creates/looks up a user by name — no
  passwords, no sessions beyond a `localStorage` id sent as the
  `x-user-id` header. Anyone could claim to be anyone. Before this
  touches real users, add real authentication (hashed passwords,
  magic links, or an OAuth provider) and stop trusting a client-supplied
  user id.
- **Storage**: a single JSON file, read/written on every request. Fine
  for a demo or a handful of concurrent users; move to a real database
  (Postgres + Prisma, SQLite, etc.) before concurrent writes matter.
- **Permissions**: only "can create an event" is role-gated. There's no
  "only the host can edit/cancel their own event" yet — a natural next
  step.
- **No email/notifications** for waitlist promotion, reminders, etc.

## Deploying for free

This is a plain Node/Express app, so it runs as-is on **Render**,
**Railway**, **Fly.io**, or **Glitch** free tiers — push the repo, set
the start command to `npm start`, and set `PORT` if the platform
requires it (the code already reads `process.env.PORT`). Note free
tiers usually mean the app "sleeps" after inactivity and the JSON file
storage may not persist across redeploys — good enough for a demo, not
for production data.
