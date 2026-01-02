import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';
import schema from './schema.json' assert { type: 'json' };

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Połączono z bazą YetiForce');
    conn.release();
  } catch (err) {
    console.error('❌ Błąd połączenia:', err.message);
    process.exit(1);
  }
}

async function executeSelect(query, params = []) {
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getModule(moduleName, args = {}) {
  const mod = schema[moduleName];
  if (!mod) throw new Error(`Module ${moduleName} nie istnieje`);

  const table = mod.table;
  const pk = mod.pk;
  let query = `SELECT t.*, e.modifiedtime FROM ${table} t JOIN vtiger_crmentity e ON t.${pk} = e.crmid WHERE e.deleted = 0`;
  const params = [];

  if (args.search && mod.searchFields.length) {
    const conditions = mod.searchFields.map(f => `${table}.${f} LIKE ?`).join(' OR ');
    query += ' AND (' + conditions + ')';
    mod.searchFields.forEach(() => params.push(`%${args.search}%`));
  }

  query += ' ORDER BY e.modifiedtime DESC LIMIT ?';
  params.push(parseInt(args.limit || 50));

  return executeSelect(query, params);
}

const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.API_TOKEN;
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/schema') return next();
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });
  const [type, token] = auth.split(' ');
  if (type !== 'Bearer' || token !== AUTH_TOKEN) return res.status(403).json({ error: 'Invalid token' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/schema', (req, res) => res.json({ success: true, schema }));

app.get('/relations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await executeSelect(
      `SELECT crmid,
