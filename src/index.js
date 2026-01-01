import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
      c.firstname,
      c.lastname,
      c.email,
      c.phone,
      c.mobile,
      c.title,
      e.crmid,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_contactdetails c
    JOIN vtiger_crmentity e ON c.contactid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR c.email LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(args.limit || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function getAccounts(args = {}) {
  let query = `
    SELECT 
      a.accountid,
      a.accountname,
      a.website,
      a.phone,
      a.email1,
      a.bill_city,
      a.bill_country,
      e.createdtime,
      e.modifiedtime,
      e.description
    FROM vtiger_account a
    JOIN vtiger_crmentity e ON a.accountid = e.crmid
    WHERE e.deleted = 0
  `;
  
  const params = [];
  
  if (args.search) {
    query += ` AND a.accountname LIKE ?`;
    params.push(`%${args.search}%`);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(args.limit || 50);
  
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
  
  if (args.status) {
    query += ` AND p.sales_stage = ?`;
    params.push(args.status);
  }
  
  query += ` ORDER BY e.modifiedtime DESC LIMIT ?`;
  params.push(args.limit || 50);
  
  const [rows] = await pool.execute(query, params);
  return rows;
}

async function executeCustomQuery(query) {
  // Bezpieczeństwo: tylko SELECT
  if (!query.trim().toLowerCase().startsWith('select')) {
    throw new Error('Tylko zapytania SELECT są dozwolone');
  }
  
  const [rows] = await pool.execute(query);
  return rows;
}

// Jeśli HTTP_MODE jest włączony, uruchom Express API
if (process.env.HTTP_MODE === 'true') {
  const app = express();
  app.use(express.json());
  
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
          parameters: ['limit', 'search']
        },
        {
          name: 'get_accounts',
          description: 'Pobiera listę kontrahentów',
          parameters: ['limit', 'search']
        },
        {
          name: 'get_opportunities',
          description: 'Pobiera szanse sprzedaży',
          parameters: ['limit', 'status']
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
  
} else {
  // Tryb MCP (STDIO) dla Claude Desktop
  const server = new Server(
    {
      name: 'yetiforce-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler('tools/list', async () => {
    return {
      tools: [
        {
          name: 'get_contacts',
          description: 'Pobiera listę kontaktów z YetiForce CRM',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maksymalna liczba wyników (domyślnie 50)',
                default: 50
              },
              search: {
                type: 'string',
                description: 'Wyszukaj po nazwisku, imieniu lub e-mailu'
              }
            }
          }
        },
        {
          name: 'get_accounts',
          description: 'Pobiera listę kontrahentów (firm) z YetiForce',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maksymalna liczba wyników',
                default: 50
              },
              search: {
                type: 'string',
                description: 'Wyszukaj po nazwie firmy'
              }
            }
          }
        },
        {
          name: 'get_opportunities',
          description: 'Pobiera szanse sprzedaży z YetiForce',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filtruj po statusie (np. "Prospecting", "Closed Won")'
              },
              limit: {
                type: 'number',
                default: 50
              }
            }
          }
        },
        {
          name: 'execute_custom_query',
          description: 'Wykonaj niestandardowe zapytanie SQL (tylko SELECT)',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Zapytanie SQL (tylko SELECT)'
              }
            },
            required: ['query']
          }
        }
      ]
    };
  });

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;
      
      switch (name) {
        case 'get_contacts':
          result = await getContacts(args);
          break;
        case 'get_accounts':
          result = await getAccounts(args);
          break;
        case 'get_opportunities':
          result = await getOpportunities(args);
          break;
        case 'execute_custom_query':
          result = await executeCustomQuery(args.query);
          break;
        default:
          throw new Error(`Nieznane narzędzie: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Błąd: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });

  async function main() {
    await testConnection();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('✅ YetiForce MCP Server uruchomiony (STDIO mode)');
  }

  main().catch(console.error);
}
