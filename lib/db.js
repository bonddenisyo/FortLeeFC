// lib/db.js — PostgreSQL via Neon
const { Pool } = require('pg');
const crypto = require('crypto');

const ADMIN_EMAILS = new Set(['bonddenisyo@gmail.com']);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---- Schema bootstrap ------------------------------------------------------

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT,
      first_name    TEXT,
      last_name     TEXT,
      role          TEXT NOT NULL DEFAULT 'user',
      picture       TEXT,
      created_at    BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      date         TEXT NOT NULL,
      time         TEXT NOT NULL,
      place_name   TEXT,
      lat          DOUBLE PRECISION,
      lng          DOUBLE PRECISION,
      capacity     INTEGER NOT NULL DEFAULT 20,
      question     TEXT,
      image        TEXT,
      host_id      TEXT NOT NULL REFERENCES users(id),
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   BIGINT NOT NULL,
      cancelled_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS signups (
      id              TEXT PRIMARY KEY,
      event_id        TEXT NOT NULL REFERENCES events(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      status          TEXT NOT NULL,
      guests          INTEGER NOT NULL DEFAULT 0,
      question_answer TEXT,
      created_at      BIGINT NOT NULL,
      cancelled_at    BIGINT,
      promoted_at     BIGINT
    );
  `);
  await pool.query(`UPDATE users SET role = 'admin' WHERE role = 'host'`);
  await pool.query(`ALTER TABLE signups ADD COLUMN IF NOT EXISTS is_game_host BOOLEAN NOT NULL DEFAULT FALSE`);
}

// ---- Column selectors (camelCase aliases) ----------------------------------

const U = `id, email, name, first_name AS "firstName", last_name AS "lastName", role, picture, created_at AS "createdAt"`;
const E = `id, title, date, time, place_name AS "placeName", lat, lng, capacity, question, image, host_id AS "hostId", status, created_at AS "createdAt", cancelled_at AS "cancelledAt"`;
const S = `id, event_id AS "eventId", user_id AS "userId", status, guests, question_answer AS "questionAnswer", created_at AS "createdAt", cancelled_at AS "cancelledAt", promoted_at AS "promotedAt", is_game_host AS "isGameHost"`;

// ---- Internal helpers ------------------------------------------------------

function uid() { return crypto.randomBytes(9).toString('base64url'); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const buf = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), buf);
  } catch { return false; }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function withCounts(event) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM signups WHERE event_id = $1 GROUP BY status`,
    [event.id]
  );
  const c = { attending: 0, waitlisted: 0, cancelled: 0 };
  rows.forEach((r) => { c[r.status] = r.count; });
  return { ...event, counts: { ...c, spotsLeft: Math.max(event.capacity - c.attending, 0) } };
}

// ---- Users -----------------------------------------------------------------

async function registerUser({ email, password, firstName, lastName }) {
  const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (rows.length) throw httpError(400, 'Email already registered');
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const role = ADMIN_EMAILS.has(email.toLowerCase()) ? 'admin' : 'user';
  const userId = uid();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, first_name, last_name, role, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId, email.toLowerCase(), hashPassword(password), name, firstName || null, lastName || null, role, Date.now()]
  );
  return getUser(userId);
}

async function loginUser({ email, password }) {
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, role FROM users WHERE LOWER(email) = LOWER($1)`, [email]
  );
  const raw = rows[0];
  if (!raw || !verifyPassword(password, raw.password_hash)) throw httpError(401, 'Invalid email or password');
  if (ADMIN_EMAILS.has(raw.email) && raw.role !== 'admin') {
    await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [raw.id]);
  }
  return getUser(raw.id);
}

async function getUser(userId) {
  const { rows } = await pool.query(`SELECT ${U} FROM users WHERE id = $1`, [userId]);
  return rows[0] || null;
}

async function listUsers() {
  const { rows } = await pool.query(`SELECT ${U} FROM users ORDER BY name`);
  return rows;
}

async function setUserRole(userId, role) {
  const { rows } = await pool.query(
    `UPDATE users SET role = $1 WHERE id = $2 RETURNING ${U}`, [role, userId]
  );
  if (!rows.length) throw httpError(404, 'User not found');
  return rows[0];
}

async function updateUser(userId, { firstName, lastName, picture }) {
  const { rows: cur } = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
  if (!cur.length) throw httpError(404, 'User not found');
  const fn = firstName !== undefined ? firstName.trim() : cur[0].first_name;
  const ln = lastName !== undefined ? (lastName.trim() || null) : cur[0].last_name;
  const name = [fn, ln].filter(Boolean).join(' ');
  const { rows } = picture !== undefined
    ? await pool.query(
        `UPDATE users SET first_name=$1, last_name=$2, name=$3, picture=$4 WHERE id=$5 RETURNING ${U}`,
        [fn, ln, name, picture, userId]
      )
    : await pool.query(
        `UPDATE users SET first_name=$1, last_name=$2, name=$3 WHERE id=$4 RETURNING ${U}`,
        [fn, ln, name, userId]
      );
  return rows[0];
}

// ---- Events ----------------------------------------------------------------

async function listEvents() {
  const { rows } = await pool.query(`SELECT ${E} FROM events ORDER BY date ASC, time ASC`);
  return Promise.all(rows.map(withCounts));
}

async function getEvent(eventId) {
  const { rows } = await pool.query(`SELECT ${E} FROM events WHERE id = $1`, [eventId]);
  return rows[0] ? withCounts(rows[0]) : null;
}

async function createEvent({ title, date, time, placeName, lat, lng, capacity, question, image, hostId }) {
  const eventId = uid();
  await pool.query(
    `INSERT INTO events (id, title, date, time, place_name, lat, lng, capacity, question, image, host_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [eventId, title, date, time, placeName, lat, lng, Number(capacity) || 20, question || null, image || null, hostId, Date.now()]
  );
  return getEvent(eventId);
}

async function addGameHosts(eventId, userIds) {
  for (const userId of userIds) {
    await pool.query(`DELETE FROM signups WHERE event_id=$1 AND user_id=$2`, [eventId, userId]);
    const signupId = uid();
    await pool.query(
      `INSERT INTO signups (id, event_id, user_id, status, guests, is_game_host, created_at)
       VALUES ($1,$2,$3,'attending',0,true,$4)`,
      [signupId, eventId, userId, Date.now()]
    );
  }
}

async function cancelEvent(eventId, hostId) {
  const { rows } = await pool.query(`SELECT ${E} FROM events WHERE id = $1`, [eventId]);
  if (!rows.length) throw httpError(404, 'Event not found');
  const { rows: ur } = await pool.query('SELECT role FROM users WHERE id = $1', [hostId]);
  if (!ur.length || ur[0].role !== 'admin') throw httpError(403, 'Only admins can cancel games');
  await pool.query(
    `UPDATE events SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
    [Date.now(), eventId]
  );
  return getEvent(eventId);
}

// ---- Signups ---------------------------------------------------------------

async function listSignups(eventId) {
  // DISTINCT ON (user_id) ordered by created_at DESC keeps the latest row per user
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (s.user_id)
       s.id, s.event_id AS "eventId", s.user_id AS "userId", s.status, s.guests,
       s.question_answer AS "questionAnswer", s.created_at AS "createdAt",
       s.cancelled_at AS "cancelledAt", s.promoted_at AS "promotedAt",
       s.is_game_host AS "isGameHost",
       u.name AS "userName", u.picture AS "userPicture"
     FROM signups s
     JOIN users u ON u.id = s.user_id
     WHERE s.event_id = $1
     ORDER BY s.user_id, s.created_at DESC`,
    [eventId]
  );
  return {
    attending:  rows.filter((s) => s.status === 'attending').sort((a, b) => a.createdAt - b.createdAt),
    waitlisted: rows.filter((s) => s.status === 'waitlisted').sort((a, b) => a.createdAt - b.createdAt),
    cancelled:  rows.filter((s) => s.status === 'cancelled').sort((a, b) => b.createdAt - a.createdAt),
  };
}

async function signUp(eventId, userId, { guests = 0, questionAnswer = null } = {}) {
  const { rows: evRows } = await pool.query(`SELECT ${E} FROM events WHERE id = $1`, [eventId]);
  if (!evRows.length) throw httpError(404, 'Event not found');
  const event = evRows[0];

  const { rows: active } = await pool.query(
    `SELECT status FROM signups WHERE event_id=$1 AND user_id=$2 AND status != 'cancelled' LIMIT 1`,
    [eventId, userId]
  );
  if (active.length) throw httpError(400, `Already ${active[0].status} for this event`);

  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM signups WHERE event_id=$1 AND status='attending'`, [eventId]
  );
  const status = cnt[0].count < event.capacity ? 'attending' : 'waitlisted';

  await pool.query(`DELETE FROM signups WHERE event_id=$1 AND user_id=$2`, [eventId, userId]);

  const signupId = uid();
  await pool.query(
    `INSERT INTO signups (id, event_id, user_id, status, guests, question_answer, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [signupId, eventId, userId, status, Number(guests) || 0, questionAnswer || null, Date.now()]
  );
  const { rows } = await pool.query(`SELECT ${S} FROM signups WHERE id = $1`, [signupId]);
  return rows[0];
}

async function cancelSignup(eventId, userId) {
  const { rows } = await pool.query(
    `SELECT ${S} FROM signups WHERE event_id=$1 AND user_id=$2 AND status != 'cancelled'
     ORDER BY created_at DESC LIMIT 1`,
    [eventId, userId]
  );
  if (!rows.length) throw httpError(400, 'No active signup to cancel');
  const signup = rows[0];

  await pool.query(
    `UPDATE signups SET status='cancelled', cancelled_at=$1 WHERE id=$2`,
    [Date.now(), signup.id]
  );

  if (signup.status === 'attending') {
    const { rows: wl } = await pool.query(
      `SELECT id FROM signups WHERE event_id=$1 AND status='waitlisted' ORDER BY created_at ASC LIMIT 1`,
      [eventId]
    );
    if (wl.length) {
      await pool.query(
        `UPDATE signups SET status='attending', promoted_at=$1 WHERE id=$2`,
        [Date.now(), wl[0].id]
      );
    }
  }

  const { rows: updated } = await pool.query(`SELECT ${S} FROM signups WHERE id = $1`, [signup.id]);
  return updated[0];
}

async function getUserSignups(userId) {
  const { rows } = await pool.query(
    `SELECT ${S} FROM signups WHERE user_id=$1 AND status != 'cancelled' ORDER BY created_at DESC`,
    [userId]
  );
  return Promise.all(rows.map(async (s) => ({ ...s, event: await getEvent(s.eventId) })));
}

module.exports = {
  init,
  registerUser, loginUser, getUser, listUsers, updateUser, setUserRole,
  listEvents, getEvent, createEvent, addGameHosts, cancelEvent,
  listSignups, getUserSignups, signUp, cancelSignup,
};
