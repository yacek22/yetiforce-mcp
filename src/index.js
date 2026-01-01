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

// Test połączenia z bazą
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

// Funkcje pomocnicze do zapytań
async function getContacts(args = {}) {
  let query = `
    SELECT 
      c.contactid,
      c.contact_no,
      c.salutation,
      c.firstname,
      c.lastname,
      c.email,
      c.phone,
      c.mobile,
      c.jobtitle,
      c.contactstatus,
      c.decision_maker,
      c.secondary_email,
      c.contact_linkedin,
      c.contact_account,
      c.gender,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_contactdetails c
    JOIN vtiger_crmentity e ON c.contactid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  
  if (args.status) {
    query += ` AND c.contactstatus = ?`;
    params.push(args.status);
  }
  
  if (args.account) {
    query += ` AND c.contact_account = ?`;
    params.push(args.account);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getAccounts(args = {}) {
  let query = `
    SELECT 
      a.accountid,
      a.account_no,
      a.accountname,
      a.account_short_name,
      a.account_type,
      a.industry,
      a.phone,
      a.email1,
      a.email2,
      a.website,
      a.employees,
      a.annualrevenue,
      a.vat_id,
      a.accounts_status,
      a.legal_form,
      a.balance,
      a.payment_balance,
      a.creditlimit,
      a.account_linkedin,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_account a
    JOIN vtiger_crmentity e ON a.accountid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (a.accountname LIKE ? OR a.account_short_name LIKE ? OR a.email1 LIKE ? OR a.vat_id LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  
  if (args.status) {
    query += ` AND a.accounts_status = ?`;
    params.push(args.status);
  }
  
  if (args.type) {
    query += ` AND a.account_type = ?`;
    params.push(args.type);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getLeads(args = {}) {
  let query = `
    SELECT 
      l.leadid,
      l.lead_no,
      l.lead_firstname,
      l.lead_lastname,
      l.email,
      l.company,
      l.leadstatus,
      l.lead_stage,
      l.leadsource,
      l.converted,
      l.industry,
      l.annualrevenue,
      l.vat_id,
      l.lead_account,
      l.lead_contact,
      l.lead_campaign,
      l.lead_position,
      l.lead_decisionmaker,
      l.lead_linkedin,
      l.lead_zainteresowanie,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_leaddetails l
    JOIN vtiger_crmentity e ON l.leadid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.email LIKE ? OR l.company LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  
  if (args.status) {
    query += ` AND l.leadstatus = ?`;
    params.push(args.status);
  }
  
  if (args.stage) {
    query += ` AND l.lead_stage = ?`;
    params.push(args.stage);
  }
  
  if (args.converted !== undefined) {
    query += ` AND l.converted = ?`;
    params.push(args.converted === 'true' || args.converted === true ? 1 : 0);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getOpportunities(args = {}) {
  let query = `
    SELECT 
      p.potentialid,
      p.potentialname,
      p.amount,
      p.sales_stage,
      p.closingdate,
      p.probability,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_potential p
    JOIN vtiger_crmentity e ON p.potentialid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND p.potentialname LIKE ?`;
    params.push(`%${args.search}%`);
  }
  
  if (args.status) {
    query += ` AND p.sales_stage = ?`;
    params.push(args.status);
  }
  
  if (args.min_amount) {
    query += ` AND p.amount >= ?`;
    params.push(parseFloat(args.min_amount));
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function executeCustomQuery(query) {
  if (!query.trim().toLowerCase().startsWith('select')) {
    throw new Error('Tylko zapytania SELECT są dozwolone');
  }
  
  const [rows] = await pool.execute(query);
  return rows;
}

// Express HTTP API
const app = express();
app.use(express.json());

// Strona główna
app.get('/', (req, res) => {
  res.json({
    name: 'YetiForce MCP API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      tools: '/tools',
      contacts: '/contacts?limit=10&search=Jan',
      accounts: '/accounts?limit=10&search=Firma',
      leads: '/leads?limit=10&stage=SQL',
      opportunities: '/opportunities?limit=10&status=Prospecting',
      customQuery: 'POST /query with body: {"query": "SELECT ..."}'
    },
    documentation: 'https://github.com/yacek22/yetiforce-mcp'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lista dostępnych narzędzi
app.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: 'get_contacts',
        description: 'Pobiera listę kontaktów z YetiForce CRM',
        parameters: ['limit', 'search', 'status', 'account']
      },
      {
        name: 'get_accounts',
        description: 'Pobiera listę kontrahentów',
        parameters: ['limit', 'search', 'status', 'type']
      },
      {
        name: 'get_leads',
        description: 'Pobiera listę leadów',
        parameters: ['limit', 'search', 'status', 'stage', 'converted']
      },
      {
        name: 'get_opportunities',
        description: 'Pobiera szanse sprzedaży',
        parameters: ['limit', 'search', 'status', 'min_amount']
      },
      {
        name: 'execute_query',
        description: 'Wykonaj niestandardowe zapytanie SQL (tylko SELECT)',
        parameters: ['query']
      }
    ]
  });
});

// Endpoint dla kontaktów
app.get('/contacts', async (req, res) => {
  try {
    const results = await getContacts(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint dla kontrahentów
app.get('/accounts', async (req, res) => {
  try {
    const results = await getAccounts(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint dla leadów
app.get('/leads', async (req, res) => {
  try {
    const results = await getLeads(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint dla szans sprzedaży
app.get('/opportunities', async (req, res) => {
  try {
    const results = await getOpportunities(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint dla niestandardowych zapytań
app.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }
    const results = await executeCustomQuery(query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.MCP_PORT || 3000;

testConnection().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 YetiForce MCP HTTP API działa na porcie ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });
});
