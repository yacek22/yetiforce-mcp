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
  if (args.date_to) { query += ` AND e.createdtime <= ?`; par
