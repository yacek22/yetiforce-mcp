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

// --- ENDPOINT ANALITYCZNY /STATS ---
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
    throw new Error(`Nieznany moduł do statystyk: ${args.module}`);
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

  // 1. Filtrowanie Dat
  if (args.date_from) {
    query += ` AND e.createdtime >= ?`;
    params.push(args.date_from + ' 00:00:00');
  }
  if (args.date_to) {
    query += ` AND e.createdtime <= ?`;
    params.push(args.date_to + ' 23:59:59');
  }

  // 2. Filtrowanie Statusów (Istniejące)
  if (args.status) {
    let statusCol = '';
    if (args.module === 'leads') statusCol = 'leadstatus';
    if (args.module === 'contacts') statusCol = 'contactstatus';
    if (args.module === 'accounts') statusCol = 'accounts_status';
    if (args.module === 'opportunities') statusCol = 'ssalesprocesses_status';
    if (args.module === 'invoices') statusCol = 'finvoice_status';
    
    if (statusCol) {
      query += ` AND t.${statusCol} = ?`;
      params.push(args.status);
    }
  }

  // 3. Filtrowanie Etapów (NOWOŚĆ - dla Leadów SQL/MQL)
  if (args.stage && args.module === 'leads') {
    query += ` AND t.lead_stage = ?`;
    params.push(args.stage);
  }

  // 4. Relacje
  if (args.account_id) {
    let accCol = '';
    if (args.module === 'leads') accCol = 'lead_account';
    if (args.module === 'contacts') accCol = 'contact_account';
    if (args.module === 'opportunities') accCol = 'opportunity_company';
    if (args.module === 'invoices') accCol = 'invoices_account';
    
    if (accCol) {
      query += ` AND t.${accCol} = ?`;
      params.push(args.account_id);
    }
  }

  if (args.contact_id) {
    let conCol = '';
    if (args.module === 'leads') conCol = 'lead_contact';
    if (args.module === 'opportunities') conCol = 'opportunity_contact';
    
    if (conCol) {
      query += ` AND t.${conCol} = ?`;
      params.push(args.contact_id);
    }
  }

  const [rows] = await pool.execute(query, params);
  return rows[0];
}

// --- FUNKCJE LISTUJĄCE ---

async function getContacts(args = {}) {
  let query = `
    SELECT 
      c.contactid, c.firstname, c.lastname, c.email, c.phone, 
      c.contactstatus, c.jobtitle,
      a.accountname as connected_account_name,
      e.createdtime
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
    SELECT a.accountid, a.accountname, a.email1, a.phone, a.vat_id, 
           a.accounts_status, a.account_short_name, a.industry,
           e.createdtime
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
    SELECT 
      l.leadid, l.lead_firstname, l.lead_lastname, l.email, l.company, 
      l.leadstatus, l.lead_stage,
      e.createdtime,
      a.accountname as connected_account_name,
      CONCAT(c.firstname, ' ', c.lastname) as connected_contact_name
    FROM vtiger_leaddetails l
    JOIN vtiger_crmentity e ON l.leadid = e.crmid
    LEFT JOIN vtiger_account a ON l.lead_account = a.accountid
    LEFT JOIN vtiger_contactdetails c ON l.lead_contact = c.contactid
    WHERE e.deleted = 0
  `;
  const params = [];

  if (args.search) {
    query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.company LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }
  
  // Filtr STATUS (np. New, Contacted)
  if (args.status) { query += ` AND l.leadstatus = ?`; params.push(args.status); }
  
  // Filtr ETAP (np. SQL, MQL) - NOWOŚĆ
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
    SELECT 
      p.ssalesprocessesid as id, p.subject, p.estimated as amount, 
      p.ssalesprocesses_status as status, p.probability,
      e.createdtime,
      a.accountname as connected_account_name,
      CONCAT(c.firstname, ' ', c.la
