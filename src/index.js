import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';
import schema from './schema.json' assert { type: 'json' };

dotenv.config();

// Połączenie z bazą danych
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test połączenia
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Połączono z bazą YetiForce');
    connection.release();
  } catch (error) {
    console.error('❌ Błąd połączenia z bazą:', error.message);
    process.exit(1);
  }
}

// Funkcja do wykonania SELECT
async function executeSelect(query, params = []) {
  const [rows] = await pool.execute(query, params);
  return rows;
}

// Funkcja pobierania modułu z search i limit
async function getModule(moduleName, args = {}) {
  const mod = schema.modules[moduleName];
  if (!mod) throw new Error(`Module ${moduleName} nie istnieje`);

  const table = mod.table;
  const pk = mod.pk;

  let query = `SELECT t.*, e.* 
               FROM ${table} t
               JOIN vtiger_crmentity e ON t.${pk} = e.crmid
               WHERE e.deleted = 0`;

  const params = [];

  if (args.search && mod.searchable_fields.length) {
    const conditions = mod.searchable_fields.map(field => `t.${field} LIKE ?`).join(' OR ');
    query += ' AND (' + conditions + ')';
    mod.searchable_fields.forEach(() => params.push(`%${args.search}%`));
  }

  if (args.limit) {
    query += ' ORDER BY e.modifiedtime DESC LIMIT ?';
    params.push(parseInt(args.limit));
  } else {
    query += ' ORDER BY e.modifiedtime DESC LIMIT 50';
  }

  const [rows] = await pool.execute(query, params);
  return rows;
}

// Express API
const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.API_TOKEN;

app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/schema') return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || token !== AUTH_TOKEN) return res.status(403).json({ error: 'Invalid token' });

  next();
});

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Schema
app.get('/schema', (req, res) => res.json({ success: true, schema }));

// Relacje rekordu
app.get('/relations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await executeSelect(
      `SELECT crmid, relcrmid, module, relmodule
       FROM vtiger_crmentityrel
       WHERE crmid = ? OR relcrmid = ?`,
      [id, id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpointy modułów
['Leads', 'Accounts', 'Contacts', 'Opportunities'].forEach(mod => {
  app.get(`/${mod.toLowerCase()}`, async (req, res) => {
    try {
      const data = await getModule(mod, req.query);
      res.json({ success: true, data, count: data.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// Global search
app.get('/search', async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    if (!query) return res.status(400).json({ success: false, error: 'Query is required' });

    const searchLimit = parseInt(limit);
    const results = [];

    for (const mod of Object.keys(schema.modules)) {
      const rows = await getModule(mod, { search: query, limit: searchLimit });
      rows.forEach(r => r.type = mod.toLowerCase());
      results.push(...rows);
    }

    results.sort((a, b) => new Date(b.modifiedtime) - new Date(a.modifiedtime));
    res.json({ success: true, query, data: results.slice(0, searchLimit), count: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Niestandardowe SELECT
app.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim().toLowerCase().startsWith('select')) {
      return res.status(400).json({ success: false, error: 'Only SELECT queries are allowed' });
    }
    const rows = await executeSelect(query);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.MCP_PORT || 3000;
testConnection().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YetiForce MCP HTTP API działa na porcie ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });
});
