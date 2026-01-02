import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';

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

// --- NOWY ENDPOINT ANALITYCZNY (SQL ROBI MATEMATYKĘ) ---
async function getStats(args = {}) {
  const moduleMap = {
    'leads': { table: 'vtiger_leaddetails', pk: 'leadid', amount: null },
    'contacts': { table: 'vtiger_contactdetails', pk: 'contactid', amount: null },
    'accounts': { table: 'vtiger_account', pk: 'accountid', amount: 'annualrevenue' }, // Przykładowo revenue
    'opportunities': { table: 'u_yf_ssalesprocesses', pk: 'ssalesprocessesid', amount: 'estimated' }
  };

  const mod = moduleMap[args.module];
  if (!mod) {
    throw new Error(`Nieznany moduł do statystyk: ${args.module}. Dostępne: leads, contacts, accounts, opportunities`);
  }

  let selectClause = `COUNT(*) as count`;
  if (mod.amount) {
    selectClause += `, SUM(t.${mod.amount}) as total_amount, AVG(t.${mod.amount}) as avg_amount`;
  }

  let query = `
    SELECT ${selectClause}
    FROM ${mod.table} t
    JOIN vtiger_crmentity e ON t.${mod.pk} = e.crmid
    WHERE e.deleted = 0
  `;

  const params = [];

  // Filtrowanie dat
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }

  // Filtrowanie statusów (uniwersalne)
  if (args.status) {
    // Mapowanie nazw kolumn statusów
    let statusCol = '';
    if (args.module === 'leads') statusCol = 'leadstatus';
    if (args.module === 'contacts') statusCol = 'contactstatus';
    if (args.module === 'accounts') statusCol = 'accounts_status';
    if (args.module === 'opportunities') statusCol = 'ssalesprocesses_status';
    
    if (statusCol) {
      query += ` AND t.${statusCol} = ?`;
      params.push(args.status);
    }
  }

  const [rows] = await pool.execute(query, params);
  return rows[0]; // Zwraca { count: 123, total_amount: 50000 }
}

// --- STANDARDOWE FUNKCJE POBIERANIA LISTY ---

async function getContacts(args = {}) {
  let query = `
    SELECT c.contactid, c.firstname, c.lastname, c.email, c.phone, a.accountname as account_name, e.createdtime
    FROM vtiger_contactdetails c
    JOIN vtiger_crmentity e ON c.contactid = e.crmid
    LEFT JOIN vtiger_account a ON c.contact_account = a.accountid
    WHERE e.deleted = 0
  `;
  const params = [];
  
  if (args.search) {
    query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR a.accountname LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  if (args.account) { query += ` AND c.contact_account = ?`; params.push(args.account); }

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getAccounts(args = {}) {
  let query = `
    SELECT a.accountid, a.accountname, a.email1, a.phone, a.vat_id, e.createdtime, website, industry, account_type, smownerid, accounts_status, account_short_name
    FROM vtiger_account a
    JOIN vtiger_crmentity e ON a.accountid = e.crmid
    WHERE e.deleted = 0
  `;
  const params = [];

  if (args.search) {
    query += ` AND (a.accountname LIKE ? OR a.vat_id LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`);
  }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getLeads(args = {}) {
  let query = `
    SELECT l.leadid, l.lead_firstname, l.lead_lastname, l.email, l.company, l.leadstatus, e.createdtime, smownerid, lead_stage, lead_account, lead_contact, lead_campaign, lead_zainteresowanie, lead_note
    FROM vtiger_leaddetails l
    JOIN vtiger_crmentity e ON l.leadid = e.crmid
    WHERE e.deleted = 0
  `;
  const params = [];

  if (args.search) {
    query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.company LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  if (args.status) { query += ` AND l.leadstatus = ?`; params.push(args.status); }

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getOpportunities(args = {}) {
  let query = `
    SELECT p.ssalesprocessesid as id, p.subject, p.estimated as amount, p.ssalesprocesses_status as status, 
           a.accountname as account_name, e.createdtime
    FROM u_yf_ssalesprocesses p
    JOIN vtiger_crmentity e ON p.ssalesprocessesid = e.crmid
    LEFT JOIN vtiger_account a ON p.opportunity_company = a.accountid
    WHERE e.deleted = 0
  `;
  const params = [];

  if (args.search) { query += ` AND (p.subject LIKE ? OR a.accountname LIKE ?)`; params.push(`%${args.search}%`, `%${args.search}%`); }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  if (args.status) { query += ` AND p.ssalesprocesses_status = ?`; params.push(args.status); }
  if (args.min_amount) { query += ` AND p.estimated >= ?`; params.push(parseFloat(args.min_amount)); }
  if (args.opportunity_company) { query += ` AND p.opportunity_company = ?`; params.push(args.opportunity_company); }

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

// --- API EXPRESS ---
const app = express();
app.use(express.json());
const AUTH_TOKEN = process.env.API_TOKEN;

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader.split(' ')[1] !== AUTH_TOKEN) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
});

app.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: 'get_stats',
        description: 'ZWRACA DOKŁADNE LICZBY I SUMY. Używaj zawsze do pytań "ile", "suma", "wartość".',
        parameters: ['module (leads, opportunities, accounts)', 'date_from', 'date_to', 'status']
      },
      { name: 'get_leads', parameters: ['limit', 'search', 'date_from', 'date_to'] },
      { name: 'get_opportunities', parameters: ['limit', 'search', 'date_from', 'date_to', 'status'] },
      { name: 'get_accounts', parameters: ['limit', 'search'] },
      { name: 'get_contacts', parameters: ['limit', 'search', 'account'] }
    ]
  });
});

app.get('/stats', async (req, res) => {
  try {
    const result = await getStats(req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/contacts', async (req, res) => res.json({ success: true, data: await getContacts(req.query) }));
app.get('/accounts', async (req, res) => res.json({ success: true, data: await getAccounts(req.query) }));
app.get('/leads', async (req, res) => res.json({ success: true, data: await getLeads(req.query) }));
app.get('/opportunities', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) }));
app.get('/ssalesprocesses', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) })); // Alias
app.get('/SSalesProcesses', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) })); // Alias

// Dodaj funkcję search jeśli potrzebna (uproszczona)
app.get('/search', async (req, res) => {
    // ... (możesz zostawić starą implementację search lub pominąć, stats jest kluczowe)
    res.json({ success: false, error: "Use specific modules or /stats" }); 
});


const PORT = process.env.MCP_PORT || 3000;
testConnection().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 YetiForce Stats API running on ${PORT}`));
});
