const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const cors = require('@fastify/cors');
const formbody = require('@fastify/formbody');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5175;
const dbPath = path.resolve(__dirname, 'habits.db');

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

// GET calendar events using Swift binary
fastify.get('/calendar', async (request, reply) => {
  const binaryPath = path.resolve(__dirname, 'fetch_events');
  return new Promise((resolve, reject) => {
    exec(binaryPath, (error, stdout, stderr) => {
      if (error) {
        fastify.log.error(`Swift execution error: ${error.message}`);
        return resolve([]); // Return empty rather than crashing
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        fastify.log.error(`JSON parse error: ${e.message}`);
        resolve([]);
      }
    });
  });
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
