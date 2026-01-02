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
      p.related_to,
      a.accountname as account_name,
      a.account_short_name,
      a.vat_id as account_vat_id,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_potential p
    JOIN vtiger_crmentity e ON p.potentialid = e.crmid
    LEFT JOIN vtiger_account a ON p.related_to = a.accountid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (p.potentialname LIKE ? OR a.accountname LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`);
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

// Auth token
const AUTH_TOKEN = process.env.API_TOKEN;

app.use((req, res, next) => {
  // health zostawiamy publiczny
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
    version: '1.0.0',
    endpoints: {
      health: '/health',
      tools: '/tools',
      search: '/search?query=Bondecki',
      contacts: '/contacts?limit=10&search=Jan',
      accounts: '/accounts?limit=10&search=Firma',
      leads: '/leads?limit=10&stage=SQL',
      opportunities: '/opportunities?limit=10&status=Prospecting',
      customQuery: 'POST /query with body: {"query": "SELECT ..."}'
    },
    authentication: 'Bearer token required (except /health)',
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
        name: 'search',
        description: 'Globalne wyszukiwanie po wszystkich modułach',
        parameters: ['query', 'limit']
      },
      {
        name: 'get_contacts',
        description: 'Pobiera listę kontaktów z YetiForce CRM (z nazwami firm)',
        parameters: ['limit', 'search', 'status', 'account']
      },
      {
        name: 'get_accounts',
        description: 'Pobiera listę kontrahentów',
        parameters: ['limit', 'search', 'status', 'type']
      },
      {
        name: 'get_leads',
        description: 'Pobiera listę leadów (z nazwami firm i kontaktów)',
        parameters: ['limit', 'search', 'status', 'stage', 'converted']
      },
      {
        name: 'get_opportunities',
        description: 'Pobiera szanse sprzedaży (z nazwami firm)',
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

// Globalny endpoint wyszukiwania
app.get('/search', async (req, res) => {
  try {
    const { query, limit = 20 } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query parameter is required' 
      });
    }
    
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
    `, [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, searchLimit]);
    
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
    `, [`%${query}%`, `%${query}%`, `%${query}%`, searchLimit]);
    
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
    `, [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, searchLimit]);
    
    const [opportunities] = await pool.execute(`
      SELECT 
        'opportunity' as type,
        p.potentialid as id,
        p.potentialname as name,
        NULL as email,
        NULL as phone,
        NULL as mobile,
        CONCAT(p.amount, ' PLN') as position,
        a.accountname as company,
        a.account_short_name as company_short,
        p.sales_stage as status,
        e.modifiedtime
      FROM vtiger_potential p
      JOIN vtiger_crmentity e ON p.potentialid = e.crmid
      LEFT JOIN vtiger_account a ON p.related_to = a.accountid
      WHERE e.deleted = 0 
        AND (p.potentialname LIKE ? OR a.accountname LIKE ?)
      ORDER BY e.modifiedtime DESC
      LIMIT ?
    `, [`%${query}%`, `%${query}%`, searchLimit]);
    
    const results = [...contacts, ...accounts, ...leads, ...opportunities];
    
    // Sortuj po dacie modyfikacji
    results.sort((a, b) => new Date(b.modifiedtime) - new Date(a.modifiedtime));
    
    res.json({ 
      success: true, 
      query: query,
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
