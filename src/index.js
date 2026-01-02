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

// --- FUNKCJE POMOCNICZE (Z OBSŁUGĄ DAT) ---

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
      a.accountname as account_name,
      a.account_short_name,
      a.website as account_website,
      a.industry as account_industry,
      a.vat_id as account_vat_id,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_contactdetails c
    JOIN vtiger_crmentity e ON c.contactid = e.crmid
    LEFT JOIN vtiger_account a ON c.contact_account = a.accountid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR a.accountname LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  
  // Filtrowanie po dacie utworzenia
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }

  if (args.status) {
    query += ` AND c.contactstatus = ?`;
    params.push(args.status);
  }
  
  if (args.account) {
    query += ` AND c.contact_account = ?`;
    params.push(args.account);
  }
  
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
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

  // Filtrowanie po dacie utworzenia
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }
  
  if (args.status) {
    query += ` AND a.accounts_status = ?`;
    params.push(args.status);
  }
  
  if (args.type) {
    query += ` AND a.account_type = ?`;
    params.push(args.type);
  }
  
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
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
      l.company as lead_company_name,
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
      a.accountname as account_name,
      a.account_short_name,
      c.firstname as contact_firstname,
      c.lastname as contact_lastname,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_leaddetails l
    JOIN vtiger_crmentity e ON l.leadid = e.crmid
    LEFT JOIN vtiger_account a ON l.lead_account = a.accountid
    LEFT JOIN vtiger_contactdetails c ON l.lead_contact = c.contactid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR a.accountname LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }

  // Filtrowanie po dacie utworzenia (KLUCZOWE dla analityki)
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
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
  
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

// --- POPRAWIONA FUNKCJA SZANS SPRZEDAŻY (z DATAMI) ---
async function getOpportunities(args = {}) {
  // Używamy tabeli u_yf_ssalesprocesses zgodnie z Yetiforce schema
  let query = `
    SELECT 
      p.ssalesprocessesid as id,
      p.ssalesprocesses_no as number,
      p.subject,
      p.estimated as amount,
      p.ssalesprocesses_status as status,
      p.estimated_date as closingdate,
      p.probability,
      p.opportunity_company as account_id,
      a.accountname as account_name,
      a.account_short_name,
      a.vat_id as account_vat_id,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM u_yf_ssalesprocesses p
    JOIN vtiger_crmentity e ON p.ssalesprocessesid = e.crmid
    LEFT JOIN vtiger_account a ON p.opportunity_company = a.accountid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (p.subject LIKE ? OR a.accountname LIKE ? OR p.ssalesprocesses_no LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }

  // Filtrowanie po dacie utworzenia
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }
  
  // Status
  if (args.status) {
    query += ` AND p.ssalesprocesses_status = ?`;
    params.push(args.status);
  }
  
  // Kwota
  if (args.min_amount) {
    query += ` AND p.estimated >= ?`;
    params.push(parseFloat(args.min_amount));
  }

  // Firma
  if (args.opportunity_company) {
    query += ` AND p.opportunity_company = ?`;
    params.push(args.opportunity_company);
  }
  
  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 100);
  
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

// --- KONFIGURACJA API EXPRESS ---
const app = express();
app.use(express.json());

// Auth token
const AUTH_TOKEN = process.env.API_TOKEN;

app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || token !== AUTH_TOKEN) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  next();
});

// Strona główna
app.get('/', (req, res) => {
  res.json({
    name: 'YetiForce MCP API',
    version: '1.0.2 (Fixed Tables & Dates)',
    endpoints: {
      health: '/health',
      tools: '/tools',
      search: '/search?query=Bondecki',
      contacts: '/contacts?limit=10&search=Jan',
      accounts: '/accounts?limit=10&search=Firma',
      leads: '/leads?limit=10&stage=SQL&date_from=2025-01-01',
      opportunities: '/opportunities?limit=10&status=Prospecting',
      ssalesprocesses: '/ssalesprocesses',
      customQuery: 'POST /query with body: {"query": "SELECT ..."}'
    },
    authentication: 'Bearer token required',
    documentation: 'https://github.com/yacek22/yetiforce-mcp'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lista dostępnych narzędzi (Zaktualizowana o daty)
app.get('/tools', (req, res) => {
  res.json({
    tools: [
      {
        name: 'search',
        description: 'Globalne wyszukiwanie po wszystkich modułach',
        parameters: ['query', 'limit']
      },
      {
        name: 'get_contacts',
        description: 'Pobiera listę kontaktów (Osoby)',
        parameters: ['limit', 'search', 'status', 'account', 'date_from', 'date_to']
      },
      {
        name: 'get_accounts',
        description: 'Pobiera listę kontrahentów (Firmy)',
        parameters: ['limit', 'search', 'status', 'type', 'date_from', 'date_to']
      },
      {
        name: 'get_leads',
        description: 'Pobiera listę leadów (Potencjalni Klienci)',
        parameters: ['limit', 'search', 'status', 'stage', 'converted', 'date_from', 'date_to']
      },
      {
        name: 'get_opportunities',
        description: 'Pobiera szanse sprzedaży (Szanse/Okazje)',
        parameters: ['limit', 'search', 'status', 'min_amount', 'opportunity_company', 'date_from', 'date_to']
      },
      {
        name: 'execute_query',
        description: 'Wykonaj niestandardowe zapytanie SQL (tylko SELECT)',
        parameters: ['query']
      }
    ]
  });
});

// Globalny endpoint wyszukiwania (Aktualizacja SQL szans)
app.get('/search', async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    const searchQuery = query || '';
    const searchLimit = parseInt(limit);
    
    const [contacts] = await pool.execute(`
      SELECT 
        'contact' as type,
        c.contactid as id,
        CONCAT(COALESCE(c.firstname, ''), ' ', COALESCE(c.lastname, '')) as name,
        c.email,
        c.phone,
        c.mobile,
        c.jobtitle as position,
        a.accountname as company,
        a.account_short_name as company_short,
        c.contactstatus as status,
        e.modifiedtime
      FROM vtiger_contactdetails c
      JOIN vtiger_crmentity e ON c.contactid = e.crmid
      LEFT JOIN vtiger_account a ON c.contact_account = a.accountid
      WHERE e.deleted = 0 
        AND (c.firstname LIKE ? OR c.lastname LIKE ? OR c.email LIKE ? OR a.accountname LIKE ?)
      ORDER BY e.modifiedtime DESC
      LIMIT ?
    `, [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, searchLimit]);
    
    const [accounts] = await pool.execute(`
      SELECT 
        'account' as type,
        a.accountid as id,
        a.accountname as name,
        a.email1 as email,
        a.phone,
        NULL as mobile,
        a.industry as position,
        a.website as company,
        a.account_short_name as company_short,
        a.accounts_status as status,
        e.modifiedtime
      FROM vtiger_account a
      JOIN vtiger_crmentity e ON a.accountid = e.crmid
      WHERE e.deleted = 0 
        AND (a.accountname LIKE ? OR a.account_short_name LIKE ? OR a.email1 LIKE ?)
      ORDER BY e.modifiedtime DESC
      LIMIT ?
    `, [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, searchLimit]);
    
    const [leads] = await pool.execute(`
      SELECT 
        'lead' as type,
        l.leadid as id,
        CONCAT(COALESCE(l.lead_firstname, ''), ' ', COALESCE(l.lead_lastname, '')) as name,
        l.email,
        NULL as phone,
        NULL as mobile,
        l.lead_position as position,
        COALESCE(a.accountname, l.company) as company,
        a.account_short_name as company_short,
        l.leadstatus as status,
        e.modifiedtime
      FROM vtiger_leaddetails l
      JOIN vtiger_crmentity e ON l.leadid = e.crmid
      LEFT JOIN vtiger_account a ON l.lead_account = a.accountid
      WHERE e.deleted = 0 
        AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR a.accountname LIKE ?)
      ORDER BY e.modifiedtime DESC
      LIMIT ?
    `, [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, searchLimit]);
    
    // POPRAWIONE ZAPYTANIE SEARCH DLA SZANS
    const [opportunities] = await pool.execute(`
      SELECT 
        'opportunity' as type,
        p.ssalesprocessesid as id,
        p.subject as name,
        NULL as email,
        NULL as phone,
        NULL as mobile,
        CONCAT(p.estimated, ' PLN') as position,
        a.accountname as company,
        a.account_short_name as company_short,
        p.ssalesprocesses_status as status,
        e.modifiedtime
      FROM u_yf_ssalesprocesses p
      JOIN vtiger_crmentity e ON p.ssalesprocessesid = e.crmid
      LEFT JOIN vtiger_account a ON p.opportunity_company = a.accountid
      WHERE e.deleted = 0 
        AND (p.subject LIKE ? OR a.accountname LIKE ?)
      ORDER BY e.modifiedtime DESC
      LIMIT ?
    `, [`%${searchQuery}%`, `%${searchQuery}%`, searchLimit]);
    
    const results = [...contacts, ...accounts, ...leads, ...opportunities];
    results.sort((a, b) => new Date(b.modifiedtime) - new Date(a.modifiedtime));
    
    res.json({ 
      success: true, 
      query: searchQuery,
      data: results.slice(0, searchLimit), 
      count: results.length,
      types: {
        contacts: contacts.length,
        accounts: accounts.length,
        leads: leads.length,
        opportunities: opportunities.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpointy modułowe
app.get('/contacts', async (req, res) => {
  try {
    const results = await getContacts(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/accounts', async (req, res) => {
  try {
    const results = await getAccounts(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/leads', async (req, res) => {
  try {
    const results = await getLeads(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/opportunities', async (req, res) => {
  try {
    const results = await getOpportunities(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Aliasy dla szans (case-insensitive handling)
app.get('/ssalesprocesses', async (req, res) => {
  try {
    const results = await getOpportunities(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/SSalesProcesses', async (req, res) => {
  try {
    const results = await getOpportunities(req.query);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
