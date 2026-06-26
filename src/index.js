import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

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

// --- FUNKCJA STATYSTYK (bez zmian względem oryginału) ---
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

  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }

  const isStageValue = (val) => ['SQL', 'MQL', 'IQL', 'SAL', 'Hot', 'Cold', 'Warm'].includes(val);

  const statusValue = args.status;
  const stageValue = args.stage || args.lead_stage;

  if (args.module === 'leads') {
    if (stageValue) {
      query += ` AND t.lead_stage = ?`;
      params.push(stageValue);
    } else if (statusValue) {
      if (isStageValue(statusValue)) {
        query += ` AND t.lead_stage = ?`;
        params.push(statusValue);
      } else {
        query += ` AND t.leadstatus = ?`;
        params.push(statusValue);
      }
    }
  } else {
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

// --- FUNKCJE LISTUJĄCE (bez zmian względem oryginału) ---

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

  if (args.status) { query += ` AND l.leadstatus = ?`; params.push(args.status); }
  if (args.stage) { query += ` AND l.lead_stage = ?`; params.push(args.stage); }

  if (args.lead_account) { query += ` AND l.lead_account = ?`; params.push(args.lead_account); }
  if (args.lead_contact) { query += ` AND l.lead_contact = ?`; params.push(args.lead_contact); }

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

// --- DEFINICJE NARZĘDZI MCP ---

const TOOLS = [
  {
    name: 'get_stats',
    description: 'Zwraca zagregowane statystyki (liczba rekordów, suma kwot) dla modułu YetiForce: leads, contacts, accounts, opportunities lub invoices. Pozwala filtrować po dacie, statusie/etapie i powiązanym kontrahencie.',
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', enum: ['leads', 'contacts', 'accounts', 'opportunities', 'invoices'], description: 'Moduł CRM' },
        date_from: { type: 'string', description: 'Data od (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'Data do (YYYY-MM-DD)' },
        status: { type: 'string', description: 'Status rekordu (lub etap leada, np. SQL/MQL - zostanie wykryty automatycznie)' },
        stage: { type: 'string', description: 'Etap leada (SQL, MQL, IQL, SAL, Hot, Cold, Warm)' },
        account_id: { type: 'string', description: 'ID powiązanego kontrahenta' }
      },
      required: ['module']
    }
  },
  {
    name: 'get_leads',
    description: 'Lista leadów z YetiForce z możliwością filtrowania.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maks. liczba wyników (domyślnie 100)' },
        search: { type: 'string', description: 'Szukaj w imieniu, nazwisku, firmie' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        status: { type: 'string' },
        stage: { type: 'string' },
        lead_account: { type: 'string', description: 'ID powiązanego kontrahenta' },
        lead_contact: { type: 'string', description: 'ID powiązanego kontaktu' }
      }
    }
  },
  {
    name: 'get_contacts',
    description: 'Lista kontaktów z YetiForce z możliwością filtrowania.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string', description: 'Szukaj w imieniu, nazwisku, nazwie firmy' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        account: { type: 'string', description: 'ID kontrahenta' }
      }
    }
  },
  {
    name: 'get_accounts',
    description: 'Lista kontrahentów (firm) z YetiForce z możliwością filtrowania.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string', description: 'Szukaj w nazwie firmy lub NIP' },
        date_from: { type: 'string' },
        date_to: { type: 'string' }
      }
    }
  },
  {
    name: 'get_opportunities',
    description: 'Lista szans sprzedaży (opportunities) z YetiForce z możliwością filtrowania.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        status: { type: 'string' },
        min_amount: { type: 'number', description: 'Minimalna wartość szansy' },
        opportunity_company: { type: 'string', description: 'ID powiązanego kontrahenta' }
      }
    }
  },
  {
    name: 'get_invoices',
    description: 'Lista faktur sprzedażowych z YetiForce z możliwością filtrowania.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        status: { type: 'string' }
      }
    }
  }
];

const TOOL_HANDLERS = {
  get_stats: getStats,
  get_leads: getLeads,
  get_contacts: getContacts,
  get_accounts: getAccounts,
  get_opportunities: getOpportunities,
  get_invoices: getInvoices
};

// --- SERWER MCP ---

function createMcpServer() {
  const server = new Server(
    { name: 'yetiforce-mcp', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      throw new Error(`Nieznane narzędzie: ${name}`);
    }
    try {
      const result = await handler(args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Błąd: ${error.message}` }],
        isError: true
      };
    }
  });

  return server;
}

// --- HTTP / SSE TRANSPORT ---

const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.API_TOKEN;

function checkAuth(req, res) {
  // Akceptujemy token przez nagłówek Authorization: Bearer <token>
  // ALBO przez parametr query ?token=<token> - przydatne dla klientów MCP
  // (np. Claude Desktop), których UI nie pozwala ustawić własnych nagłówków.
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader ? authHeader.split(' ')[1] : null;
  const queryToken = req.query.token;

  if (headerToken !== AUTH_TOKEN && queryToken !== AUTH_TOKEN) {
    res.status(403).json({ error: 'Invalid token' });
    return false;
  }
  return true;
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const transports = {};

// Klient MCP łączy się tutaj (Server-Sent Events) - wymaga nagłówka Authorization: Bearer <token>
app.get('/sse', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const server = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on('close', () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

// Klient MCP wysyła tu wywołania narzędzi (JSON-RPC)
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(400).send('Brak sesji dla podanego sessionId - połącz się najpierw z /sse');
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

const PORT = process.env.MCP_PORT || 3000;
testConnection().then(() =>
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 YetiForce MCP Server (SSE) running on ${PORT}`))
);
