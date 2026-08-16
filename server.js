// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./lib/db');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ---- Auth -----------------------------------------------------------

app.post(
  '/api/register',
  asyncRoute(async (req, res) => {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !email.trim()) throw httpError(400, 'Email is required');
    if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    if (!firstName || !firstName.trim()) throw httpError(400, 'First name is required');
    const user = await db.registerUser({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName?.trim() || null });
    res.status(201).json({ user });
  })
);

app.post(
  '/api/login',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw httpError(400, 'Email and password are required');
    const user = await db.loginUser({ email: email.trim(), password });
    res.json({ user });
  })
);

// ---- Events -------------------------------------------------------------

app.get(
  '/api/events',
  asyncRoute(async (req, res) => {
    res.json({ events: await db.listEvents() });
  })
);

app.get(
  '/api/events/:id',
  asyncRoute(async (req, res) => {
    const event = await db.getEvent(req.params.id);
    if (!event) throw httpError(404, 'Event not found');
    const signups = await db.listSignups(event.id);
    res.json({ event, signups });
  })
);

app.post(
  '/api/events',
  asyncRoute(async (req, res) => {
    const hostId = req.header('x-user-id');
    const host = hostId ? await db.getUser(hostId) : null;
    if (!host || host.role !== 'admin') throw httpError(403, 'Only admins can create events');
    const { title, date, time, placeName, lat, lng, capacity, question, image, hostUserIds } = req.body;
    if (!title || !date || !time || !placeName) throw httpError(400, 'title, date, time and placeName are required');
    const event = await db.createEvent({ title, date, time, placeName, lat, lng, capacity, question, image, hostId: host.id });
    if (Array.isArray(hostUserIds) && hostUserIds.length) {
      await db.addGameHosts(event.id, hostUserIds);
    }
    res.status(201).json({ event });
  })
);

// ---- Weather -------------------------------------------------------------

app.get(
  '/api/weather',
  asyncRoute(async (req, res) => {
    const { lat, lng, date, time } = req.query;
    if (!lat || !lng || !date || !time) throw httpError(400, 'lat, lng, date and time are required');

    const gameHour = parseInt(time.split(':')[0], 10);
    const targetHours = [-2, -1, 0, 1, 2]
      .map(o => gameHour + o)
      .filter(h => h >= 0 && h <= 23);

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&start_date=${date}&end_date=${date}` +
      `&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m` +
      `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FNew_York`;

    const r = await fetch(url);
    if (!r.ok) throw httpError(502, 'Weather service unavailable');
    const data = await r.json();

    const times = data.hourly.time;
    const hours = targetHours.map(h => {
      const key = `${date}T${String(h).padStart(2, '0')}:00`;
      const idx = times.indexOf(key);
      if (idx === -1) return null;
      return {
        hour: h,
        temp: Math.round(data.hourly.temperature_2m[idx]),
        precip: data.hourly.precipitation_probability[idx] ?? 0,
        code: data.hourly.weathercode[idx],
        wind: Math.round(data.hourly.windspeed_10m[idx]),
      };
    }).filter(Boolean);

    res.json({ available: true, gameHour, hours });
  })
);

// ---- Users (host-only) ---------------------------------------------------

app.get(
  '/api/users',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user || user.role !== 'admin') throw httpError(403, 'Admins only');
    res.json({ users: await db.listUsers() });
  })
);

app.patch(
  '/api/users/:id/role',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user || user.role !== 'admin') throw httpError(403, 'Admins only');
    const { role } = req.body;
    const updated = await db.setUserRole(req.params.id, role);
    res.json({ user: updated });
  })
);

// ---- Comments ------------------------------------------------------------

app.get(
  '/api/events/:id/comments',
  asyncRoute(async (req, res) => {
    res.json({ comments: await db.listComments(req.params.id) });
  })
);

app.post(
  '/api/events/:id/comments',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const { body } = req.body;
    if (!body || !body.trim()) throw httpError(400, 'Comment cannot be empty');
    const comment = await db.addComment(req.params.id, user.id, body.trim());
    res.status(201).json({ comment });
  })
);

app.delete(
  '/api/comments/:id',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user || user.role !== 'admin') throw httpError(403, 'Admins only');
    await db.deleteComment(req.params.id);
    res.json({ ok: true });
  })
);

// ---- Profile -------------------------------------------------------------

app.get(
  '/api/profile',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const signups = await db.getUserSignups(userId);
    res.json({ profile: user, signups });
  })
);

app.patch(
  '/api/profile',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const { firstName, lastName, picture } = req.body;
    const updated = await db.updateUser(userId, { firstName, lastName, picture });
    res.json({ user: updated });
  })
);

// ---- Signups (attendance / waitlist / cancelled) -------------------------

app.post(
  '/api/events/:id/signup',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const { guests, questionAnswer } = req.body || {};
    const signup = await db.signUp(req.params.id, user.id, { guests, questionAnswer });
    res.status(201).json({ signup });
  })
);

app.post(
  '/api/events/:id/cancel-game',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const event = await db.cancelEvent(req.params.id, user.id);
    res.json({ event });
  })
);

app.post(
  '/api/events/:id/cancel',
  asyncRoute(async (req, res) => {
    const userId = req.header('x-user-id');
    const user = userId ? await db.getUser(userId) : null;
    if (!user) throw httpError(401, 'Sign in first');
    const signup = await db.cancelSignup(req.params.id, user.id);
    res.json({ signup });
  })
);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---- Error handling -------------------------------------------------------

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

// ---- Boot (wait for DB schema before accepting requests) ------------------

const PORT = process.env.PORT || 3000;

function scheduleCleanup() {
  const run = () => db.cleanupOldEvents().catch(err => console.error('Cleanup error:', err));
  run();
  setInterval(run, 14 * 24 * 60 * 60 * 1000);
}

db.init()
  .then(() => {
    scheduleCleanup();
    app.listen(PORT, () => console.log(`Fort Lee FC running at http://localhost:${PORT}`));
  })
  .catch((err) => { console.error('DB init failed:', err); process.exit(1); });
