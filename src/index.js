import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest
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
  if (args.search) {
    // CUSTOM (Averica, 2026-06-26): dodano dopasowanie po "imię nazwisko" jako całości -
    // model często przekazuje pełne imię+nazwisko w jednym ciągu, a osobne kolumny
    // firstname/lastname nie zawierają tego jako podciągu, więc wynik wychodził pusty.
    query += ` AND (c.lastname LIKE ? OR c.firstname LIKE ? OR a.accountname LIKE ? OR CONCAT(c.firstname, ' ', c.lastname) LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
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
  // CUSTOM (Averica, 2026-06-26): zamiast osobnego, wąskiego SQL - delegujemy do
  // queryModule() z wbudowanymi polami adresu/typu, żeby model nie musiał sam
  // domyślać się że trzeba dodatkowo wywołać describe_module/query_module
  // (modele tańsze niż Sonnet nie zawsze trzymały się tej wieloetapowej instrukcji
  // i błędnie odpowiadały że "nie ma danych o mieście" mimo że dane istniały).
  return queryModule({
    module: 'Accounts',
    fields: ['accountname', 'email1', 'phone', 'vat_id', 'account_type', 'forma_prawna', 'addresslevel5a', 'addresslevel2a'],
    search: args.search,
    date_from: args.date_from,
    date_to: args.date_to,
    limit: args.limit
  });
}

async function getPartners(args = {}) {
  // CUSTOM (Averica, 2026-06-26): nowe narzędzie - moduł Partnerzy nie miał wcześniej
  // żadnej dedykowanej funkcji, model musiał ręcznie składać query_module, co często
  // zawodziło (pomijał adres/miejscowość). Ten sam wzorzec co getAccounts.
  return queryModule({
    module: 'Partners',
    fields: ['subject', 'mail_podstawowy_partner', 'tel_podstawowy_partner', 'vat_id', 'rodzaj_partner', 'forma_prawna', 'addresslevel5a', 'addresslevel2a'],
    search: args.search,
    date_from: args.date_from,
    date_to: args.date_to,
    limit: args.limit
  });
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
  if (args.search) {
    query += ` AND (l.lead_firstname LIKE ? OR l.lead_lastname LIKE ? OR l.company LIKE ? OR CONCAT(l.lead_firstname, ' ', l.lead_lastname) LIKE ?)`;
    params.push(`%${args.search}%`, `%${args.search}%`, `%${args.search}%`, `%${args.search}%`);
  }
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

// --- NARZĘDZIA "ŻYWEJ" STRUKTURY CRM ---
// Czytają metadane bezpośrednio z tabel YetiForce (vtiger_tab, vtiger_field,
// vtiger_entityname), więc zawsze odpowiadają aktualnej strukturze CRM -
// nie trzeba niczego ręcznie aktualizować po dodaniu/zmianie pól lub modułów.

async function listModules() {
  const [rows] = await pool.execute(`
    SELECT tabid, name, tablabel
    FROM vtiger_tab
    WHERE presence = 0
    ORDER BY name
  `);
  return rows;
}

// --- Webservice REST (CUSTOM, Averica 2026-06-29) ---
// Wartości list (picklist) nie są zapisane w metadanych vtiger_field (które czytamy
// bezpośrednio z bazy) - YetiForce trzyma je w osobnych tabelach + tłumaczeniach
// językowych. Najprościej i najbezpieczniej pobrać je z oficjalnego webservice REST
// (ten sam mechanizm, który już znamy z n8n) - jedno wywołanie Fields() zwraca
// wszystkie pola modułu razem z ich aktualnymi, przetłumaczonymi wartościami list.
// CUSTOM (Averica, 2026-06-29): dane logowania PRZENIESIONE do zmiennych środowiskowych
// po wycieku poprzedniego hasła wykrytym przez GitGuardian (nie wpisywać tu sekretów
// na stałe - ustaw je w panelu Coolify, Environment Variables).
const YF_API_URL = process.env.YF_API_URL || 'https://yeti.averica.ai';
const YF_API_AUTH_BASIC = process.env.YF_API_AUTH_BASIC;
const YF_API_KEY = process.env.YF_API_KEY;
const YF_API_USERNAME = process.env.YF_API_USERNAME;
const YF_API_PASSWORD = process.env.YF_API_PASSWORD;

async function yfLogin() {
  if (!YF_API_AUTH_BASIC || !YF_API_KEY || !YF_API_USERNAME || !YF_API_PASSWORD) {
    throw new Error('Brak zmiennych środowiskowych YF_API_AUTH_BASIC/YF_API_KEY/YF_API_USERNAME/YF_API_PASSWORD - ustaw je w Coolify.');
  }
  const res = await fetch(`${YF_API_URL}/webservice/WebserviceStandard/Users/Login`, {
    method: 'POST',
    headers: {
      Authorization: YF_API_AUTH_BASIC,
      'X-API-KEY': YF_API_KEY,
      ENCRYPTED: '0',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userName: YF_API_USERNAME, password: YF_API_PASSWORD, code: '', params: { language: '' } })
  });
  const data = await res.json();
  return data?.result?.token || null;
}

async function yfGetFieldsMeta(moduleName) {
  const token = await yfLogin();
  if (!token) return null;
  const res = await fetch(`${YF_API_URL}/webservice/WebserviceStandard/${moduleName}/Fields`, {
    method: 'GET',
    headers: {
      Authorization: YF_API_AUTH_BASIC,
      'X-API-KEY': YF_API_KEY,
      ENCRYPTED: '0',
      'X-TOKEN': token
    }
  });
  const data = await res.json();
  return data?.result?.fields || null;
}

async function describeModule(args = {}) {
  const moduleName = args.module;
  if (!moduleName) throw new Error('Parametr "module" jest wymagany.');

  const [tabRows] = await pool.execute(`SELECT tabid FROM vtiger_tab WHERE name = ?`, [moduleName]);
  if (!tabRows.length) throw new Error(`Nie znaleziono modułu: ${moduleName}. Użyj list_modules, żeby zobaczyć dostępne nazwy.`);
  const tabid = tabRows[0].tabid;

  const [fieldRows] = await pool.execute(
    `SELECT fieldname, fieldlabel, tablename, columnname, uitype, typeofdata
     FROM vtiger_field
     WHERE tabid = ? AND presence IN (0, 2)
     ORDER BY block, sequence`,
    [tabid]
  );

  // Dociągamy NA ŻYWO prawdziwe, aktualne wartości list (picklist) z webservice -
  // jeśli się nie uda (np. webservice padnie), zwracamy strukturę bazową bez tego,
  // żeby describe_module nigdy nie wywaliło się całkowicie z powodu tego dodatku.
  let webserviceFields = null;
  try {
    webserviceFields = await yfGetFieldsMeta(moduleName);
  } catch (e) {
    webserviceFields = null;
  }

  const fieldsWithPicklists = fieldRows.map((f) => {
    const wsField = webserviceFields?.[f.fieldname];
    if (wsField?.picklistvalues) {
      return { ...f, picklistvalues: wsField.picklistvalues };
    }
    return f;
  });

  const [entityRows] = await pool.execute(
    `SELECT tablename, entityidfield, entityidcolumn, fieldname AS label_field
     FROM vtiger_entityname
     WHERE tabid = ?`,
    [tabid]
  );

  return {
    module: moduleName,
    tabid,
    primary_entity: entityRows[0] || null,
    fields: fieldsWithPicklists,
    picklist_values_uwaga: webserviceFields
      ? 'Pole "picklistvalues" (jeśli obecne) zawiera AKTUALNE wartości listy pobrane na żywo z CRM - zawsze ufaj tym wartościom, nie zgaduj.'
      : 'Nie udało się pobrać aktualnych wartości list z webservice - jeśli pole jest typu lista (picklist), zapytaj użytkownika o dokładne wartości albo sprawdź ręcznie, nie zgaduj.'
  };
}

async function queryModule(args = {}) {
  const moduleName = args.module;
  if (!moduleName) throw new Error('Parametr "module" jest wymagany.');

  const [tabRows] = await pool.execute(`SELECT tabid FROM vtiger_tab WHERE name = ?`, [moduleName]);
  if (!tabRows.length) throw new Error(`Nie znaleziono modułu: ${moduleName}. Użyj list_modules, żeby zobaczyć dostępne nazwy.`);
  const tabid = tabRows[0].tabid;

  const [entityRows] = await pool.execute(
    `SELECT tablename, entityidcolumn FROM vtiger_entityname WHERE tabid = ?`,
    [tabid]
  );
  if (!entityRows.length) throw new Error(`Brak danych o tabeli głównej dla modułu: ${moduleName}`);
  const primaryTable = entityRows[0].tablename;

  // entityidcolumn z vtiger_entityname bywa nieaktualne/błędne w niektórych instalacjach -
  // sprawdzamy prawdziwy klucz główny tabeli w information_schema (źródło prawdy).
  const [pkRows] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'`,
    [primaryTable]
  );
  const idColumn = pkRows.length ? pkRows[0].COLUMN_NAME : entityRows[0].entityidcolumn;

  // WAŻNE: pola modułu bywają rozsiane po WIELU tabelach (np. dla Accounts adres jest
  // w osobnej tabeli vtiger_accountaddress, nie w głównej vtiger_account). Pobieramy
  // wszystkie tabele/kolumny związane z tym modułem z metadanych CRM i dołączamy
  // (LEFT JOIN) każdą dodatkową tabelę po jej własnym kluczu głównym - dzięki temu
  // żadne pole (adres, branża, typ kontrahenta itd.) nie jest niewidoczne.
  const [allFieldRows] = await pool.execute(
    `SELECT DISTINCT tablename, columnname FROM vtiger_field WHERE tabid = ?`,
    [tabid]
  );

  const colMap = new Map(); // columnname -> { alias, tablename }
  const extraTables = new Map(); // tablename -> alias

  for (const row of allFieldRows) {
    if (row.tablename === primaryTable) {
      colMap.set(row.columnname, { alias: 't', tablename: primaryTable });
    } else if (row.tablename === 'vtiger_crmentity') {
      colMap.set(row.columnname, { alias: 'e', tablename: 'vtiger_crmentity' });
    } else {
      if (!extraTables.has(row.tablename)) {
        extraTables.set(row.tablename, `x${extraTables.size + 1}`);
      }
      colMap.set(row.columnname, { alias: extraTables.get(row.tablename), tablename: row.tablename });
    }
  }

  let joinClauses = '';
  for (const [tableName, alias] of extraTables) {
    const [extraPkRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'`,
      [tableName]
    );
    if (extraPkRows.length) {
      joinClauses += ` LEFT JOIN ${tableName} ${alias} ON ${alias}.${extraPkRows[0].COLUMN_NAME} = t.${idColumn}`;
    } else {
      // brak wykrytego klucza głównego - usuwamy tę tabelę z dostępnych (nie da się bezpiecznie połączyć)
      extraTables.delete(tableName);
      for (const [col, info] of colMap) {
        if (info.tablename === tableName) colMap.delete(col);
      }
    }
  }

  const aliasFor = (col) => (col === idColumn ? 't' : (colMap.get(col)?.alias || 't'));

  let fieldsToSelect = Array.isArray(args.fields) ? args.fields.filter(f => f === idColumn || colMap.has(f)) : [];
  if (!fieldsToSelect.length) {
    // domyślnie tylko pola głównej tabeli (krótka, czytelna odpowiedź) - resztę (adresy,
    // pola z tabel dodatkowych) trzeba wskazać explicite w "fields" po sprawdzeniu describe_module
    fieldsToSelect = Array.from(colMap.entries())
      .filter(([, info]) => info.alias === 't')
      .map(([col]) => col)
      .slice(0, 15);
  }
  if (!fieldsToSelect.includes(idColumn)) fieldsToSelect.unshift(idColumn);

  const selectClause = fieldsToSelect.map(f => `${aliasFor(f)}.${f} AS ${f}`).join(', ');

  let query = `
    SELECT ${selectClause}, e.createdtime
    FROM ${primaryTable} t
    JOIN vtiger_crmentity e ON t.${idColumn} = e.crmid
    ${joinClauses}
    WHERE e.deleted = 0
  `;
  const params = [];

  if (args.search) {
    const textCols = fieldsToSelect.filter(f => f !== idColumn);
    if (textCols.length) {
      query += ` AND (${textCols.map(f => `${aliasFor(f)}.${f} LIKE ?`).join(' OR ')})`;
      textCols.forEach(() => params.push(`%${args.search}%`));
    }
  }
  if (args.date_from) { query += ` AND e.createdtime >= ?`; params.push(args.date_from + ' 00:00:00'); }
  if (args.date_to) { query += ` AND e.createdtime <= ?`; params.push(args.date_to + ' 23:59:59'); }

  query += ` ORDER BY e.createdtime DESC LIMIT ?`;
  params.push(parseInt(args.limit) || 50);

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
    description: 'Lista kontrahentów (firm) z YetiForce - zwraca nazwę, e-mail, telefon, NIP, rodzaj kontrahenta, formę prawną ORAZ adres (pole "addresslevel5a" = miejscowość/miasto, "addresslevel2a" = województwo - te pola mają nieczytelne wewnętrzne nazwy, ale ZAWSZE pokazuj ich wartość, nigdy nie mów że danych nie ma bez sprawdzenia tego pola). Jeśli potrzebujesz jeszcze innych pól (branża, opis, social media) - użyj describe_module(module="Accounts") + query_module.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string', description: 'Szukaj w nazwie firmy, NIP lub miejscowości' },
        date_from: { type: 'string' },
        date_to: { type: 'string' }
      }
    }
  },
  {
    name: 'get_partners',
    description: 'Lista partnerów/dostawców (NIE klientów) z YetiForce - zwraca nazwę, e-mail, telefon, NIP, rodzaj partnera, formę prawną ORAZ adres (pole "addresslevel5a" = miejscowość/miasto, "addresslevel2a" = województwo - zawsze pokazuj ich wartość, nigdy nie mów że danych nie ma bez sprawdzenia). Użyj tego narzędzia (nie get_accounts) gdy pytanie dotyczy partnerów/dostawców/podwykonawców.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        search: { type: 'string', description: 'Szukaj w nazwie, NIP lub miejscowości' },
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
  },
  {
    name: 'list_modules',
    description: 'Zwraca listę WSZYSTKICH aktywnych modułów w tej instalacji YetiForce (czytane na żywo z bazy, więc obejmuje też moduły dodane/usunięte/zmienione później, niezależnie od pozostałych narzędzi w tym serwerze). Użyj tego, gdy potrzebujesz danych z modułu innego niż leads/contacts/accounts/opportunities/invoices.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'describe_module',
    description: 'Zwraca KOMPLETNĄ strukturę pól danego modułu YetiForce (nazwy kolumn, etykiety z UI, tabelę, typ danych) - czytane na żywo z metadanych CRM, włącznie z polami leżącymi w dodatkowych tabelach (np. adresy są w osobnej tabeli niż dane podstawowe firmy/kontaktu - to jest normalne i te pola SĄ dostępne przez query_module). Pola typu lista (picklist, np. status, etap, typ) mają dodatkowo klucz "picklistvalues" z AKTUALNYMI, prawdziwymi wartościami tej listy pobranymi na żywo z CRM (NIGDY nie zgaduj/nie pamiętaj wartości list samodzielnie - mogą się różnić między instalacjami i zmieniać w czasie - zawsze sprawdzaj przez to pole). ZAWSZE wywołaj to narzędzie zanim powiesz użytkownikowi że jakiegoś pola/informacji/wartości listy nie ma w CRM - dedykowane narzędzia (get_accounts, get_contacts itd.) pokazują tylko wąski podzbiór pól.',
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', description: 'Techniczna nazwa modułu (z list_modules), np. "Products", "HelpDesk"' }
      },
      required: ['module']
    }
  },
  {
    name: 'query_module',
    description: 'Generyczne pobieranie rekordów z DOWOLNEGO modułu i DOWOLNYCH pól YetiForce (nie tylko tych z dedykowanych narzędzi) - automatycznie łączy (JOIN) wszystkie tabele, w których fizycznie leżą pola tego modułu (np. adres firmy jest w innej tabeli niż jej nazwa/NIP - to narzędzie i tak je pobierze, podaj tylko nazwę kolumny z describe_module). Struktura jest odczytywana na żywo z metadanych CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        module: { type: 'string', description: 'Techniczna nazwa modułu (z list_modules)' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Lista kolumn do pobrania (nazwy "columnname" z describe_module - mogą pochodzić z różnych tabel tego modułu, np. pola adresowe). Jeśli puste - pobiera pierwsze ~15 kolumn z głównej tabeli modułu (bez adresów/pól dodatkowych).' },
        search: { type: 'string', description: 'Szukaj tekstowo w wybranych kolumnach' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number', description: 'Domyślnie 50' }
      },
      required: ['module']
    }
  }
];

const TOOL_HANDLERS = {
  get_stats: getStats,
  get_leads: getLeads,
  get_contacts: getContacts,
  get_accounts: getAccounts,
  get_partners: getPartners,
  get_opportunities: getOpportunities,
  get_invoices: getInvoices,
  list_modules: listModules,
  describe_module: describeModule,
  query_module: queryModule
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

// --- HTTP TRANSPORT (Streamable HTTP - jedyny obsługiwany transport) ---

const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.API_TOKEN;

function checkAuth(req, res) {
  // Akceptujemy token przez nagłówek Authorization: Bearer <token>
  // ALBO przez parametr query ?token=<token> - przydatne dla klientów MCP,
  // których UI nie pozwala ustawić własnych nagłówków.
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

// --- SSE (starszy transport - wymagany np. przez węzeł "MCP Client Tool" w n8n) ---

const sseTransports = {};

app.get('/sse', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const server = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);
  sseTransports[transport.sessionId] = transport;

  res.on('close', () => {
    delete sseTransports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports[sessionId];
  if (!transport) {
    res.status(400).send('Brak sesji dla podanego sessionId - połącz się najpierw z /sse');
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// --- STREAMABLE HTTP (nowszy transport - wymagany np. przez Claude/Mattermost) ---

const streamableTransports = {};

app.post('/mcp', async (req, res) => {
  if (!checkAuth(req, res)) return;

  const sessionId = req.headers['mcp-session-id'];
  let transport;

  if (sessionId && streamableTransports[sessionId]) {
    transport = streamableTransports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableTransports[sid] = transport;
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) delete streamableTransports[transport.sessionId];
    };

    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Brak prawidłowej sesji (mcp-session-id) lub żądanie nie jest poprawnym initialize.' },
      id: null
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const sessionId = req.headers['mcp-session-id'];
  const transport = streamableTransports[sessionId];
  if (!transport) {
    res.status(400).send('Nieprawidłowa lub brakująca sesja (mcp-session-id)');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const sessionId = req.headers['mcp-session-id'];
  const transport = streamableTransports[sessionId];
  if (!transport) {
    res.status(400).send('Nieprawidłowa lub brakująca sesja (mcp-session-id)');
    return;
  }
  await transport.handleRequest(req, res);
});

const PORT = process.env.MCP_PORT || 3000;
testConnection().then(() =>
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 YetiForce MCP Server (SSE + Streamable HTTP) running on ${PORT}`))
);
