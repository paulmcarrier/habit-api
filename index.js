require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const cors = require('@fastify/cors');
const formbody = require('@fastify/formbody');
const { fetchKarpathyTweets } = require('./twitter-scraper');
const { fetchKarpathyThreads } = require('./threads-scraper');
const path = require('path');
const fs = require('fs');

const PORT = 5175;
const dbPath = path.resolve(__dirname, 'habits.db');
const versionPath = path.resolve(__dirname, 'VERSION');

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

// GET karpathy feed (cached 1h)
const karpathyCache = { data: null, fetchedAt: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

fastify.get('/karpathy-feed', async (request, reply) => {
  const authToken = process.env.X_AUTH_TOKEN;
  const ct0 = process.env.X_CT0;
  if (!authToken || !ct0) {
    reply.code(503);
    return { error: 'X_AUTH_TOKEN or X_CT0 not set' };
  }

  const now = Date.now();
  if (karpathyCache.data && now - karpathyCache.fetchedAt < CACHE_TTL) {
    return karpathyCache.data;
  }

  const tweets = await fetchKarpathyTweets(authToken, ct0);
  karpathyCache.data = tweets;
  karpathyCache.fetchedAt = now;
  return tweets;
});

// GET karpathy threads (cached 1h)
const threadsCache = { data: null, fetchedAt: 0 };

fastify.get('/threads-feed', async (request, reply) => {
  const sessionId = process.env.X_THREADS_SESSION;
  const csrfToken = process.env.X_THREADS_CSRF;
  if (!sessionId || !csrfToken) {
    reply.code(503);
    return { error: 'X_THREADS_SESSION or X_THREADS_CSRF not set' };
  }

  const now = Date.now();
  if (threadsCache.data && now - threadsCache.fetchedAt < CACHE_TTL) {
    return threadsCache.data;
  }

  const posts = await fetchKarpathyThreads(sessionId, csrfToken);
  threadsCache.data = posts;
  threadsCache.fetchedAt = now;
  return posts;
});

// GET claude quota (rate limits via count_tokens probe)
fastify.get('/claude-quota', async (request, reply) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    reply.code(503);
    return { error: 'ANTHROPIC_API_KEY not set' };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }]
    })
  });

  const quota = {};
  for (const [key, value] of res.headers.entries()) {
    if (key.startsWith('anthropic-ratelimit')) {
      quota[key] = value;
    }
  }

  return quota;
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
