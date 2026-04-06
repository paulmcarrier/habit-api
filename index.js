const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const cors = require('@fastify/cors');
const formbody = require('@fastify/formbody');
const path = require('path');
const fs = require('fs');
const ical = require('node-ical');

const PORT = 5175;
const dbPath = path.resolve(__dirname, 'habits.db');
const versionPath = path.resolve(__dirname, 'VERSION');

const CALENDAR_URLS = [
  'https://p150-caldav.icloud.com/published/2/MjgxODg0Njg3MjgxODg0NpJ02PdAyaLseFiqKNvbhLrtLrffWjKvB2lI28L7RunWI2o3Zy2rwLfu1bjVbbKMYqHRe_fio1SIn3BmwiLfbqw',
  'https://p150-caldav.icloud.com/published/2/MjgxODg0Njg3MjgxODg0NpJ02PdAyaLseFiqKNvbhLpfXZShQbYGx6RMlCr5pQ7TF8AShdhnSoIJwHnTx1ioGjjR5b3jVKpuPRR_oD0CKjk',
];

let APP_VERSION = 'unknown';
try {
  APP_VERSION = fs.readFileSync(versionPath, 'utf8').trim();
} catch (e) {
  console.error('Could not read VERSION file');
}

// Register Plugins
fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'] });
fastify.register(formbody);

// Initialize SQLite DB
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) fastify.log.error(err.message);
  else fastify.log.info('Connected to the habits database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    history TEXT DEFAULT '[]'
  )`);
});

// GET health
fastify.get('/health', async (request, reply) => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// GET version
fastify.get('/version', async (request, reply) => {
  return { version: APP_VERSION };
});

// GET all habits
fastify.get('/habits', async (request, reply) => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM habits', [], (err, rows) => {
      if (err) {
        fastify.log.error(err.message);
        return reject(err);
      }
      resolve(rows.map(row => ({
        ...row,
        active: !!row.active,
        history: JSON.parse(row.history)
      })));
    });
  });
});

// POST new habit
fastify.post('/habits', async (request, reply) => {
  const { id, name, active, history } = request.body;
  const activeInt = active ? 1 : 0;
  const historyStr = JSON.stringify(history || []);
  
  return new Promise((resolve, reject) => {
    db.run('INSERT INTO habits (id, name, active, history) VALUES (?, ?, ?, ?)', 
      [id, name, activeInt, historyStr], 
      function(err) {
        if (err) {
          fastify.log.error(err.message);
          return reject(err);
        }
        reply.code(201);
        resolve({ id, name, active, history });
      }
    );
  });
});

// PATCH habit (update active/history)
fastify.patch('/habits/:id', async (request, reply) => {
  const { active, history } = request.body;
  const { id } = request.params;

  let query = 'UPDATE habits SET ';
  const params = [];

  if (active !== undefined) {
    query += 'active = ?, ';
    params.push(active ? 1 : 0);
  }
  if (history !== undefined) {
    query += 'history = ?, ';
    params.push(JSON.stringify(history));
  }
  
  query = query.slice(0, -2) + ' WHERE id = ?';
  params.push(id);

  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        fastify.log.error(err.message);
        return reject(err);
      }
      resolve({ success: true });
    });
  });
});

// GET calendar events from iCloud webcal feeds
fastify.get('/calendar', async (request, reply) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const allEvents = [];

  for (const url of CALENDAR_URLS) {
    try {
      const data = await ical.async.fromURL(url);

      // Extract calendar name from VCALENDAR object
      const calMeta = Object.values(data).find(v => v.type === 'VCALENDAR');
      const calName = calMeta?.['WR-CALNAME'] || calMeta?.['x-wr-calname'] || 'Calendar';

      for (const event of Object.values(data)) {
        if (event.type !== 'VEVENT') continue;
        const start = event.start instanceof Date ? event.start : new Date(event.start);
        if (isNaN(start.getTime())) continue;
        if (start >= todayStart && start < todayEnd) {
          allEvents.push({
            title: event.summary || 'Untitled',
            start: start.toISOString(),
            calendar: calName,
          });
        }
      }
    } catch (e) {
      fastify.log.error(`Calendar fetch error for ${url}: ${e.message}`);
    }
  }

  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  return allEvents;
});

// GET weather from Open-Meteo
fastify.get('/weather', async (request, reply) => {
  const { lat = 45.523062, lon = -122.676482 } = request.query; // Default to Portland, OR
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    return {
      temp: data.current_weather.temperature,
      condition: data.current_weather.weathercode,
      windspeed: data.current_weather.windspeed
    };
  } catch (err) {
    fastify.log.error(`Weather fetch error: ${err.message}`);
    return reply.code(500).send({ error: 'Failed to fetch weather' });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
