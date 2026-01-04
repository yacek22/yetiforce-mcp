import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

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

// --- FUNKCJA STATYSTYK (NAPRAWIONE FILTROWANIE) ---
async function getStats(args = {}) {
  const moduleMap = {
    'leads': { table: 'vtiger_leaddetails', pk: 'leadid', amount: null },
    'contacts': { table: 'vtiger_contactdetails', pk: 'contactid', amount: null },
    'accounts': { table: 'vtiger_account', pk: 'accountid', amount: 'annualrevenue' }, 
    'opportunities': { table: 'u_yf_ssalesprocesses', pk: 'ssalesprocessesid', amount: 'estimated' },
    'invoices': { table: 'u_yf_finvoice', pk: 'finvoiceid', amount: 'sum_gross' }
  };

  const mod = moduleMap[args.module];
  if (!mod) {
    throw new Error(`Nieznany moduł: ${args.module}`);
  }

  let selectClause = `COUNT(*) as count`;
  if (mod.amount) {
    selectClause += `, SUM(t.${mod.amount}) as total_amount`;
  }

  let query = `
    SELECT ${selectClause}
    FROM ${mod.table} t
    JOIN vtiger_crmentity e ON t.${mod.pk} = e.crmid
    WHERE e.deleted = 0
  `;

  const params = [];

  // 1. DATA
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }

  // 2. STATUS vs STAGE (AUTOMATYCZNA DETEKCJA)
  // Jeśli user pyta o SQL/MQL, to ZAWSZE jest to lead_stage, nawet jak agent nazwie to 'status'
  const isStageValue = (val) => ['SQL', 'MQL', 'IQL', 'SAL', 'Hot', 'Cold', 'Warm'].includes(val);
  
  // Pobieramy wartość z różnych możliwych parametrów
  const statusValue = args.status;
  const stageValue = args.stage || args.lead_stage;

  if (args.module === 'leads') {
    // Specjalna logika dla Leadów: Stage vs Status
    if (stageValue) {
        query += ` AND t.lead_stage = ?`;
        params.push(stageValue);
    } else if (statusValue) {
        // Jeśli agent wysłał status=SQL, naprawiamy to w locie
        if (isStageValue(statusValue)) {
            query += ` AND t.lead_stage = ?`;
            params.push(statusValue);
        } else {
            query += ` AND t.leadstatus = ?`;
            params.push(statusValue);
        }
    }
  } else {
    // Inne moduły (standardowy status)
    if (statusValue) {
        let statusCol = '';
        if (args.module === 'contacts') statusCol = 'contactstatus';
        if (args.module === 'accounts') statusCol = 'accounts_status';
        if (args.module === 'opportunities') statusCol = 'ssalesprocesses_status';
        if (args.module === 'invoices') statusCol = 'finvoice_status';
        
        if (statusCol) {
            query += ` AND t.${statusCol} = ?`;
            params.push(statusValue);
        }
    }
  }

  // 3. RELACJE
  if (args.account_id || args.lead_account || args.opportunity_company) {
    const accId = args.account_id || args.lead_account || args.opportunity_company;
    let accCol = '';
    if (args.module === 'leads') accCol = 'lead_account';
    if (args.module === 'contacts') accCol = 'contact_account';
    if (args.module === 'opportunities') accCol = 'opportunity_company';
    if (args.module === 'invoices') accCol = 'invoices_account';
    if (accCol) { query += ` AND t.${accCol} = ?`; params.push(accId); }
  }

  const [rows] = await pool.execute(query, params);
  return rows[0];
}

// --- FUNKCJE LISTUJĄCE ---

async function getContacts(args = {}) {
  let query = `
    SELECT c.contactid, c.firstname, c.lastname, c.email, c.phone, a.accountname, e.createdtime
    FROM vtiger_contactdetails c
    JOIN vtiger_crmentity e ON c.contactid = e.crmid
    LEFT JOIN vtiger_account a ON c.contact_account = a.accountid
    WHERE e.deleted = 0
  `;
  const params = [];
  if (args.search) { query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR a.accountname LIKE ?)`; params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`); }
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
    SELECT a.accountid, a.accountname, a.email1, a.phone, a.vat_id, e.createdtime, a.accounts_status
    FROM vtiger_account a
    JOIN vtiger_crmentity e ON a.accountid = e.crmid
    WHERE e.deleted = 0
  `;
  const params = [];
  if (args.search) { query += ` AND (a.accountname LIKE ? OR a.vat_id LIKE ?)`; params.push(`%${args.search}%`, `%${args.search}%`); }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getLeads(args = {}) {
  let query = `
    SELECT l.leadid, l.lead_firstname, l.lead_lastname, l.email, l.company, l.leadstatus, l.lead_stage, e.createdtime,
           a.accountname as connected_account_name
    FROM vtiger_leaddetails l
    JOIN vtiger_crmentity e ON l.leadid = e.crmid
    LEFT JOIN vtiger_account a ON l.lead_account = a.accountid
    WHERE e.deleted = 0
  `;
  const params = [];
  if (args.search) { query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.company LIKE ?)`; params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`); }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  
  // FIX: Status vs Stage również w listach
  if (args.status) query += ` AND l.leadstatus = ?`, params.push(args.status);
  if (args.stage) query += ` AND l.lead_stage = ?`, params.push(args.stage);
  
  if (args.lead_account) query += ` AND l.lead_account = ?`, params.push(args.lead_account);
  if (args.lead_contact) query += ` AND l.lead_contact = ?`, params.push(args.lead_contact);

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getOpportunities(args = {}) {
  let query = `
    SELECT p.ssalesprocessesid as id, p.subject, p.estimated, p.ssalesprocesses_status, a.accountname, e.createdtime
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

async function getInvoices(args = {}) {
  let query = `
    SELECT i.finvoiceid, i.subject, i.sum_gross, i.finvoice_status, a.accountname, e.createdtime
    FROM u_yf_finvoice i
    JOIN vtiger_crmentity e ON i.finvoiceid = e.crmid
    LEFT JOIN vtiger_account a ON i.invoices_account = a.accountid
    WHERE e.deleted = 0
  `;
  const params = [];
  if (args.search) { query += ` AND (i.subject LIKE ? OR a.accountname LIKE ?)`; params.push(`%${args.search}%`, `%${args.search}%`); }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  if (args.status) { query += ` AND i.finvoice_status = ?`; params.push(args.status); }
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  const [rows] = await pool.execute(query, params);
  return rows;
}

// --- API ---
const app = express();
app.use(express.json());
const AUTH_TOKEN = process.env.API_TOKEN;

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader.split(' ')[1] !== AUTH_TOKEN) return res.status(403).json({ error: 'Invalid token' });
  next();
});

app.get('/tools', (req, res) => {
  res.json({
    tools: [
      { name: 'get_stats', description: 'Statystyki liczbowe', parameters: ['module', 'date_from', 'date_to', 'status', 'stage', 'account_id'] },
      { name: 'get_leads', parameters: ['limit', 'search', 'date_from', 'date_to', 'stage', 'status', 'lead_account'] },
      { name: 'get_opportunities', parameters: ['limit', 'search', 'date_from', 'date_to', 'status', 'opportunity_company'] },
      { name: 'get_accounts', parameters: ['limit', 'search'] },
      { name: 'get_contacts', parameters: ['limit', 'search', 'account'] }
    ]
  });
});

app.get('/stats', async (req, res) => { try { res.json({ success: true, data: await getStats(req.query) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/contacts', async (req, res) => res.json({ success: true, data: await getContacts(req.query) }));
app.get('/accounts', async (req, res) => res.json({ success: true, data: await getAccounts(req.query) }));
app.get('/leads', async (req, res) => res.json({ success: true, data: await getLeads(req.query) }));
app.get('/opportunities', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) }));
app.get('/invoices', async (req, res) => res.json({ success: true, data: await getInvoices(req.query) }));
app.get('/ssalesprocesses', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) }));
app.get('/SSalesProcesses', async (req, res) => res.json({ success: true, data: await getOpportunities(req.query) }));

const PORT = process.env.MCP_PORT || 3000;
testConnection().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`🚀 YetiForce Stats API running on ${PORT}`)));
