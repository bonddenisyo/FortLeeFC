const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Game Posted!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f4f5;
      margin: 0;
      padding: 20px;
      color: #18181b;
    }
    .card {
      max-width: 500px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      padding: 32px;
      border: 1px solid #e4e4e7;
    }
    .badge {
      display: inline-block;
      background-color: #e0e7ff;
      color: #3730a3;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 12px 0;
      color: #09090b;
    }
    p {
      font-size: 15px;
      line-height: 1.5;
      color: #52525b;
      margin: 0 0 20px 0;
    }
    .event-details {
      background-color: #f8fafc;
      border-left: 4px solid #4f46e5;
      padding: 16px;
      border-radius: 6px;
      margin-bottom: 24px;
    }
    .detail-row {
      font-size: 14px;
      margin-bottom: 6px;
      color: #334155;
    }
    .detail-row:last-child { margin-bottom: 0; }
    .btn {
      display: inline-block;
      background-color: #4f46e5;
      color: #ffffff !important;
      font-weight: 600;
      font-size: 14px;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">🎮 New Event</span>
    <h1>The game has been posted!</h1>
    <p>A new game has just been scheduled on Easy Soccer Fort Lee. Here are the details:</p>
    <div class="event-details">
      <div class="detail-row"><strong>Game:</strong> {{gameTitle}}</div>
      <div class="detail-row"><strong>Date &amp; Time:</strong> {{gameDate}} at {{gameTime}}</div>
      <div class="detail-row"><strong>Location:</strong> {{gameLocation}}</div>
    </div>
    <a href="{{gameUrl}}" class="btn">View Game &amp; Join</a>
  </div>
</body>
</html>`;

function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

async function sendGameCreatedEmail(event, recipientEmails) {
  if (!process.env.RESEND_API_KEY || !recipientEmails.length) return;

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = TEMPLATE
    .replace('{{gameTitle}}',    event.title)
    .replace('{{gameDate}}',     formatDate(event.date))
    .replace('{{gameTime}}',     formatTime(event.time))
    .replace('{{gameLocation}}', event.placeName || '')
    .replace('{{gameUrl}}',      `${appUrl}/#/events/${event.id}`);

  const from = process.env.RESEND_FROM;
  const subject = `⚽ New game: ${event.title} — Easy Soccer Fort Lee`;

  // Send in batches of 100 (Resend batch limit)
  const batches = [];
  for (let i = 0; i < recipientEmails.length; i += 100) {
    batches.push(recipientEmails.slice(i, i + 100));
  }

  for (const batch of batches) {
    await resend.batch.send(
      batch.map(to => ({ from, to, subject, html }))
    );
  }
}

module.exports = { sendGameCreatedEmail };
