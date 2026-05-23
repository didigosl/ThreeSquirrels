import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { query } from './db.js';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import convertHeic from 'heic-convert';

// Storage for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // If not running in docker, fallback to local uploads folder
    cb(null, process.env.UPLOAD_DIR || '/app/uploads');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

function isHeicBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buffer.toString('ascii', 8, 12).toLowerCase());
}

async function normalizeUploadedImage(file) {
  if (!file?.path) return file;
  const originalMime = String(file.mimetype || '').toLowerCase();
  const shouldProbeHeic =
    originalMime.includes('image') ||
    /\.(jpe?g|png|heic|heif)$/i.test(String(file.originalname || '')) ||
    /\.(jpe?g|png|heic|heif)$/i.test(String(file.filename || ''));
  if (!shouldProbeHeic) return file;

  const inputBuffer = await fs.readFile(file.path);
  if (!isHeicBuffer(inputBuffer)) return file;

  const converted = await convertHeic({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 0.92
  });
  const parsed = path.parse(file.filename);
  const nextFilename = `${parsed.name}.jpg`;
  const nextPath = path.join(path.dirname(file.path), nextFilename);
  await fs.writeFile(nextPath, converted);
  if (nextPath !== file.path) {
    await fs.unlink(file.path).catch(() => {});
  }
  return {
    ...file,
    filename: nextFilename,
    path: nextPath,
    mimetype: 'image/jpeg'
  };
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) req.url = '/api' + req.url;
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Schema bootstrap (idempotent)
async function ensureSchema() {
  await query(`
    create table if not exists payables (
      id serial primary key,
      type text not null,
      partner text not null,
      doc text not null,
      amount numeric not null default 0,
      paid numeric not null default 0,
      settled boolean not null default false,
      trust_days int,
      notes text,
      invoice_no text,
      invoice_date text,
      invoice_amount numeric default 0,
      sales text,
      date text,
      created_at bigint,
      batch_at bigint,
      batch_order int,
      source text,
      history jsonb default '[]'::jsonb
    );
    create unique index if not exists uniq_payables_type_doc on payables(type, doc);
    create table if not exists ledger (
      id serial primary key,
      type text not null,
      category text,
      doc text,
      client text,
      amount numeric not null default 0,
      method text,
      file text,
      notes text,
      date text,
      date_time text,
      created_at bigint,
      created_by text
    );
    create table if not exists contacts (
      id serial primary key,
      name text not null,
      contact text,
      phone text,
      city text,
      remark text,
      owner text not null, -- '客户' | '商家' | '其它'
      created text,
      company text,
      code text,
      country text,
      address text,
      zip text,
      sales text
    );
    create table if not exists accounts (
      id serial primary key,
      name text not null unique,
      balance numeric not null default 0,
      description text,
      created text,
      initial_set boolean not null default false
    );
    create table if not exists categories (
      name text primary key,
      children jsonb not null default '[]'::jsonb
    );
    create table if not exists sales (
      id serial primary key,
      name text not null unique,
      region text,
      phone text,
      base numeric default 0,
      rate numeric default 0,
      commission numeric default 0,
      created text
    );
    create table if not exists roles (
      id serial primary key,
      name text not null unique,
      description text,
      created text,
      immutable boolean not null default false,
      perms jsonb not null default '{}'::jsonb
    );
    create table if not exists users (
      id serial primary key,
      name text not null unique,
      role text,
      created text,
      enabled boolean not null default true,
      password text
    );
    create table if not exists invoices (
      id serial primary key,
      invoice_no text not null unique,
      customer text,
      date text,
      items jsonb default '[]'::jsonb,
      total_amount numeric default 0,
      notes text,
      created_at bigint,
      created_by text
    );
    create table if not exists products (
      id serial primary key,
      sku text unique,
      barcode text,
      name text,
      name_cn text,
      image text,
      description text,
      price1 numeric default 0,
      price2 numeric default 0,
      price3 numeric default 0,
      price4 numeric default 0,
      tax_rate numeric default 0,
      cost_price numeric default 0,
      dividend_enabled boolean default false,
      dividend_users jsonb default '[]'::jsonb,
      spec text,
      stock numeric default 0,
      notes text,
      created_at bigint,
      created_by text
    );
    create table if not exists contact_notes (
      id serial primary key,
      contact_id int not null,
      note text not null,
      created_at bigint,
      created_by text
    );
    create index if not exists idx_contact_notes_contact_id on contact_notes(contact_id);
  `);
  await query('alter table invoices add column if not exists customer text', []);
  await query('alter table invoices add column if not exists date text', []);
  await query("alter table invoices add column if not exists items jsonb default '[]'::jsonb", []);
  await query('alter table invoices add column if not exists total_amount numeric default 0', []);
  await query('alter table invoices add column if not exists notes text', []);
  await query('alter table invoices add column if not exists sales text', []);
  await query('alter table invoices add column if not exists created_at bigint', []);
  await query('alter table invoices add column if not exists created_by text', []);
  await query('alter table invoices add column if not exists shipping_printed boolean default false', []);

  // Products migrations
  await query('alter table products add column if not exists sku text unique', []);
  await query('alter table products add column if not exists barcode text', []);
  await query('alter table products add column if not exists name text', []);
  await query('alter table products add column if not exists name_cn text', []);
  await query('alter table products add column if not exists image text', []);
  await query('alter table products add column if not exists description text', []);
  await query('alter table products add column if not exists price1 numeric default 0', []);
  await query('alter table products add column if not exists price2 numeric default 0', []);
  await query('alter table products add column if not exists price3 numeric default 0', []);
  await query('alter table products add column if not exists price4 numeric default 0', []);
  await query('alter table products add column if not exists tax_rate numeric default 0', []);
  await query('alter table products add column if not exists cost_price numeric default 0', []);
  await query('alter table products add column if not exists dividend_enabled boolean default false', []);
  await query("alter table products add column if not exists dividend_users jsonb default '[]'::jsonb", []);
  await query("update products set dividend_users='[]'::jsonb where dividend_users is null", []);
  await query('alter table products add column if not exists spec text', []);
  await query('alter table products add column if not exists stock numeric default 0', []);
  await query('alter table products add column if not exists remind_stock numeric default 0', []);
  await query('alter table products add column if not exists notes text', []);
  await query('alter table products add column if not exists created_at bigint', []);
  await query('alter table products add column if not exists created_by text', []);
  await query('update products set remind_stock=0 where remind_stock is null', []);

  await query('alter table users add column if not exists created text', []);
  await query('alter table users add column if not exists enabled boolean default true', []);
  await query('alter table users add column if not exists password text', []);
  await query('alter table users add column if not exists password_hash text', []);
  await query('alter table users alter column password_hash drop not null', []);
  await query('alter table roles add column if not exists description text', []);
  await query('alter table roles add column if not exists created text', []);
  await query('alter table roles add column if not exists immutable boolean default false', []);
  await query("alter table roles add column if not exists perms jsonb default '{}'::jsonb", []);
  await query("update roles set perms='{}'::jsonb where perms is null", []);
  await query('update roles set immutable=false where immutable is null', []);
  await query('alter table accounts add column if not exists description text', []);
  await query('alter table accounts add column if not exists created text', []);
  await query('alter table accounts add column if not exists initial_set boolean default false', []);
  await query('update accounts set initial_set=false where initial_set is null', []);
  await query("alter table categories add column if not exists children jsonb default '[]'::jsonb", []);
  await query("update categories set children='[]'::jsonb where children is null", []);
  await query('alter table sales add column if not exists region text', []);
  await query('alter table sales add column if not exists phone text', []);
  await query('alter table sales add column if not exists base numeric default 0', []);
  await query('alter table sales add column if not exists rate numeric default 0', []);
  await query('alter table sales add column if not exists commission numeric default 0', []);
  await query('alter table sales add column if not exists created text', []);
  await query('alter table ledger add column if not exists category text', []);
  await query('alter table ledger add column if not exists doc text', []);
  await query('alter table ledger add column if not exists client text', []);
  await query('alter table ledger add column if not exists method text', []);
  await query('alter table ledger add column if not exists file text', []);
  await query('alter table ledger add column if not exists notes text', []);
  await query('alter table ledger add column if not exists date text', []);
  await query('alter table ledger add column if not exists date_time text', []);
  await query('alter table ledger add column if not exists created_at bigint', []);
  await query('alter table ledger add column if not exists created_by text', []);
  await query('alter table ledger add column if not exists confirmed_by text', []);
  await query('alter table ledger add column if not exists confirmed boolean default true', []);
  await query('update ledger set confirmed=true where confirmed is null', []);
  await query('alter table contacts add column if not exists owner text', []);
  await query('alter table contacts add column if not exists type text', []);
  await query('alter table contacts add column if not exists remark text', []);
  await query('alter table contacts add column if not exists zip text', []);
  await query('alter table contacts add column if not exists company text', []);
  await query('alter table contacts add column if not exists code text', []);
  await query('alter table contacts add column if not exists country text', []);
  await query('alter table contacts add column if not exists address text', []);
  await query('alter table contacts add column if not exists sales text', []);
  await query('alter table contacts add column if not exists use_price text', []);
  await query('alter table contacts add column if not exists is_iva boolean default true', []);
  await query('alter table contacts add column if not exists invoice_nota text', []);
  await query('alter table contacts add column if not exists email text', []);
  await query('alter table contacts add column if not exists province text', []);
  await query('alter table contacts add column if not exists ship_address text', []);
  await query('alter table contacts add column if not exists ship_zip text', []);
  await query('alter table contacts add column if not exists ship_city text', []);
  await query('alter table contacts add column if not exists ship_province text', []);
  await query('alter table contacts add column if not exists ship_country text', []);
  await query('alter table contacts add column if not exists ship_phone text', []);
  await query('alter table contacts add column if not exists ship_contact text', []);
  await query("update contacts set owner='客户' where owner is null or owner=''", []);
  await query("update contacts set type=owner where type is null or type=''", []);
  await query("alter table contacts alter column type set default '客户'", []);
  await query('alter table contacts alter column type drop not null', []);
  await query('create unique index if not exists uniq_contacts_owner_name on contacts(owner, name)', []);
  await query('alter table payables add column if not exists paid numeric default 0', []);
  await query('alter table payables add column if not exists settled boolean default false', []);
  await query('alter table payables add column if not exists trust_days int default 30', []);
  await query('alter table payables add column if not exists notes text', []);
  await query('alter table payables add column if not exists invoice_no text', []);
  await query('alter table payables add column if not exists invoice_date text', []);
  await query('alter table payables add column if not exists invoice_amount numeric', []);
  await query('alter table payables add column if not exists sales text', []);
  await query('alter table payables add column if not exists date text', []);
  await query('alter table payables add column if not exists created_at bigint', []);
  await query('alter table payables add column if not exists batch_at bigint', []);
  await query('alter table payables add column if not exists batch_order int', []);
  await query('alter table payables add column if not exists source text', []);
  await query('alter table payables add column if not exists history jsonb default \'[]\'::jsonb', []);
  await query('alter table payables add column if not exists confirmed boolean default true', []);
  await query('update payables set confirmed=true where confirmed is null', []);
  await query('update payables set paid=0 where paid is null', []);
  await query('update payables set settled=false where settled is null', []);
  await query('update payables set trust_days=30 where trust_days is null', []);
  await query('update payables set created_at=extract(epoch from now())*1000 where created_at is null', []);
  await query('update payables set batch_at=created_at where batch_at is null', []);
  await query('update payables set batch_order=0 where batch_order is null', []);
  await query('update payables set source=\'import\' where source is null or source=\'\'', []);
  
  await query(`
    create table if not exists company_info (
      id serial primary key,
      name text,
      tax_id text,
      phone text,
      email text,
      street text,
      zip text,
      city text,
      country text,
      bank_name text,
      iban text,
      swift text
    );
    create table if not exists tasks (
      id serial primary key,
      title text,
      description text,
      created_by text,
      created_at bigint,
      assigned_to text,
      status text default 'pending',
      completed_by text,
      completed_at bigint
    );
    create table if not exists auto_tasks (
      id serial primary key,
      title text,
      description text,
      created_by text,
      created_at bigint,
      start_at bigint,
      assigned_to text,
      time_limit int default 0,
      interval_months int default 1,
      active boolean default true,
      last_generated_at bigint,
      next_generate_at bigint
    );
    create table if not exists daily_orders (
      id serial primary key,
      customer text,
      sales text,
      items jsonb default '[]'::jsonb,
      status text default 'new', -- new, allocated, shipped
      created_by text,
      created_at bigint,
      invoice_id int,
      date text,
      notes text,
      allocated_by text,
      shipped_by text
    );
    alter table daily_orders add column if not exists notes text;
    alter table daily_orders add column if not exists allocated_by text;
    alter table daily_orders add column if not exists shipped_by text;
    alter table daily_orders add column if not exists logistics_company_id int;
    alter table daily_orders add column if not exists logistics_status text;
    alter table daily_orders add column if not exists logistics_updated_at bigint;
    alter table daily_orders add column if not exists logistics_from text;
    alter table daily_orders add column if not exists logistics_to text;
    alter table daily_orders add column if not exists logistics_ship_date text;
    alter table daily_orders add column if not exists logistics_pallet_count text;
    alter table daily_orders add column if not exists logistics_box_count text;
    alter table daily_orders add column if not exists logistics_total_weight text;
    alter table daily_orders add column if not exists logistics_arrival_date text;
    alter table daily_orders add column if not exists logistics_completed_by text;
    alter table daily_orders add column if not exists logistics_reviewed_by text;
    alter table daily_orders add column if not exists is_manual_logistics boolean default false;

    create table if not exists logistics_companies (
      id serial primary key,
      name text not null unique,
      phone text,
      contact text,
      enabled boolean not null default true,
      created_at bigint,
      created_by text
    );
    alter table logistics_companies add column if not exists phone text;
    alter table logistics_companies add column if not exists contact text;
    alter table logistics_companies add column if not exists enabled boolean default true;
    alter table logistics_companies add column if not exists created_at bigint;
    alter table logistics_companies add column if not exists created_by text;
    create table if not exists inventory_batches (
      id serial primary key,
      product_id int,
      quantity numeric default 0,
      expiration_date text,
      created_at bigint
    );
    alter table inventory_batches add column if not exists lote text;
    create table if not exists inventory_logs (
      id serial primary key,
      product_id int,
      quantity numeric,
      type text, -- 'in', 'out'
      created_at bigint,
      created_by text,
      notes text,
      lote text
    );
    alter table inventory_logs add column if not exists lote text;
    create table if not exists materials (
      id serial primary key,
      name text,
      image text,
      stock numeric default 0
    );
    create table if not exists material_batches (
      id serial primary key,
      material_id int,
      quantity numeric default 0,
      expiration_date text,
      created_at bigint
    );
    alter table material_batches add column if not exists lote text;
    create table if not exists material_logs (
      id serial primary key,
      material_id int,
      quantity numeric,
      type text,
      created_at bigint,
      created_by text,
      notes text,
      expiration_date text
    );
    alter table material_logs add column if not exists lote text;
    create table if not exists event_records (
      id serial primary key,
      name text,
      record_date text,
      due_date text,
      notes text,
      status text default 'ongoing',
      created_by text,
      created_at bigint,
      completed_at bigint
    );
    alter table event_records add column if not exists confirmed_by text;
    create table if not exists knowledge_base_entries (
      id serial primary key,
      title text,
      content text,
      category text default 'internal',
      created_by text,
      created_at bigint
    );
    create table if not exists production_entries (
      id serial primary key,
      product_id int,
      product_name text,
      product_name_cn text,
      product_image text,
      lote text,
      expiration_date text,
      box_count numeric default 0,
      photo_url text,
      status text default 'pending',
      created_at bigint,
      created_by text,
      approved_at bigint,
      approved_by text,
      rejected_at bigint,
      rejected_by text,
      reject_reason text
    );
  `);
  // Migrations
  try { await query('alter table tasks add column completion_image text'); } catch {}
  try { await query('alter table tasks add column completion_desc text'); } catch {}
  try { await query('alter table tasks add column time_limit int default 0'); } catch {}
  try { await query('alter table tasks add column auto_task_id int'); } catch {}
  try { await query('alter table tasks add column auto_task_cycle_at bigint'); } catch {}
  try { await query('alter table auto_tasks add column time_limit int default 0'); } catch {}
  try { await query('alter table auto_tasks add column interval_months int default 1'); } catch {}
  try { await query('alter table auto_tasks add column active boolean default true'); } catch {}
  try { await query('alter table auto_tasks add column start_at bigint'); } catch {}
  try { await query('alter table auto_tasks add column last_generated_at bigint'); } catch {}
  try { await query('alter table auto_tasks add column next_generate_at bigint'); } catch {}
  try { await query('create index if not exists idx_auto_tasks_active_next on auto_tasks(active, next_generate_at)'); } catch {}
  try { await query('create unique index if not exists uniq_tasks_auto_cycle on tasks(auto_task_id, auto_task_cycle_at)'); } catch {}
  try { await query('update auto_tasks set start_at=created_at where start_at is null'); } catch {}
}
function formatLote(loteDate) {
  if (!loteDate) return '';
  const parts = loteDate.split('-');
  if (parts.length === 3) return parts[2] + parts[1];
  return loteDate;
}

function addMonthsTs(baseTs, months) {
  const base = new Date(Number(baseTs || Date.now()));
  const day = base.getDate();
  const d = new Date(base.getTime());
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.max(1, Number(months || 1)));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}

let autoTaskGenerationRunning = false;
async function ensureAutoTasksGenerated() {
  if (autoTaskGenerationRunning) return;
  autoTaskGenerationRunning = true;
  try {
    const now = Date.now();
    const r = await query(
      `select * from auto_tasks
       where coalesce(active, true)=true
       order by coalesce(next_generate_at, created_at) asc, id asc`
    );
    for (const row of r.rows || []) {
      const intervalMonths = Math.max(1, parseInt(row.interval_months, 10) || 1);
      const startAt = Number(row.start_at || row.created_at || now);
      let nextTs = Number(row.next_generate_at || 0);
      if (!nextTs) nextTs = startAt;
      let lastGeneratedAt = Number(row.last_generated_at || 0);
      while (nextTs > 0 && nextTs <= now) {
        await query(
          `insert into tasks(title, description, created_by, created_at, assigned_to, time_limit, status, auto_task_id, auto_task_cycle_at)
           values($1,$2,$3,$4,$5,$6,'pending',$7,$8)
           on conflict (auto_task_id, auto_task_cycle_at) do nothing`,
          [
            row.title || '',
            row.description || '',
            row.created_by || 'system',
            Date.now(),
            row.assigned_to || '',
            Number(row.time_limit || 0),
            Number(row.id || 0),
            nextTs
          ]
        );
        lastGeneratedAt = nextTs;
        nextTs = addMonthsTs(nextTs, intervalMonths);
      }
      if (Number(row.next_generate_at || 0) !== nextTs || Number(row.last_generated_at || 0) !== lastGeneratedAt) {
        await query(
          'update auto_tasks set last_generated_at=$1, next_generate_at=$2 where id=$3',
          [lastGeneratedAt || null, nextTs || null, row.id]
        );
      }
    }
  } finally {
    autoTaskGenerationRunning = false;
  }
}

function extractExplicitLote(item) {
  const text = String(item?.description || '').trim();
  if (!text) return '';
  const m = text.match(/lote\s*[:：]\s*([^\s,;]+)/i);
  return m ? String(m[1] || '').trim() : '';
}

function sameInvoiceItemIdentity(a, b) {
  const aPid = String(a?.productId || '').trim();
  const bPid = String(b?.productId || '').trim();
  if (aPid && bPid) return aPid === bPid;
  const aSku = String(a?.sku || '').trim();
  const bSku = String(b?.sku || '').trim();
  if (aSku && bSku) return aSku === bSku;
  return String(a?.name || '').trim() === String(b?.name || '').trim();
}

async function resolveProductIdFromItem(item) {
  const rawPid = Number(item?.productId || 0);
  if (rawPid > 0) return rawPid;

  const sku = String(item?.sku || '').trim();
  if (sku) {
    const p = await query('select id from products where trim(sku)=trim($1) order by id desc limit 1', [sku]);
    if (p.rows[0]) return Number(p.rows[0].id);
  }

  const name = String(item?.name || '').trim();
  if (name) {
    const p = await query('select id from products where trim(name)=trim($1) order by id desc limit 1', [name]);
    if (p.rows[0]) return Number(p.rows[0].id);
  }

  return 0;
}

async function attachInvoiceItemSnapshots(items, oldItems = []) {
  const list = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
  const previous = Array.isArray(oldItems) ? oldItems : [];
  const usedOld = new Array(previous.length).fill(false);

  for (const item of list) {
    const rawCost = item?.cost_price;
    if (rawCost !== undefined && rawCost !== null && rawCost !== '') {
      item.cost_price = Number(rawCost || 0);
      continue;
    }
    let matchedOld = null;
    for (let i = 0; i < previous.length; i++) {
      if (usedOld[i]) continue;
      if (!sameInvoiceItemIdentity(item, previous[i])) continue;
      matchedOld = previous[i];
      usedOld[i] = true;
      break;
    }
    if (matchedOld && matchedOld.cost_price !== undefined && matchedOld.cost_price !== null && matchedOld.cost_price !== '') {
      item.cost_price = Number(matchedOld.cost_price || 0);
    }
  }

  const needFill = list.filter(item => item.cost_price === undefined || item.cost_price === null || item.cost_price === '');
  if (!needFill.length) return list;

  const ids = [...new Set(needFill.map(item => Number(item?.productId || 0)).filter(Boolean))];
  const skus = [...new Set(needFill.map(item => String(item?.sku || '').trim()).filter(Boolean))];
  const names = [...new Set(needFill.map(item => String(item?.name || '').trim()).filter(Boolean))];

  const clauses = [];
  const params = [];
  if (ids.length) {
    params.push(ids);
    clauses.push(`id = any($${params.length}::int[])`);
  }
  if (skus.length) {
    params.push(skus);
    clauses.push(`sku = any($${params.length}::text[])`);
  }
  if (names.length) {
    params.push(names);
    clauses.push(`name = any($${params.length}::text[])`);
  }

  const productMapById = new Map();
  const productMapBySku = new Map();
  const productMapByName = new Map();

  if (clauses.length) {
    const r = await query(`
      select id, trim(coalesce(sku, '')) as sku, trim(coalesce(name, '')) as name, coalesce(cost_price, 0) as cost_price
      from products
      where ${clauses.join(' or ')}
      order by id desc
    `, params);
    for (const row of r.rows) {
      productMapById.set(Number(row.id), row);
      if (row.sku && !productMapBySku.has(row.sku)) productMapBySku.set(row.sku, row);
      if (row.name && !productMapByName.has(row.name)) productMapByName.set(row.name, row);
    }
  }

  for (const item of list) {
    if (!(item.cost_price === undefined || item.cost_price === null || item.cost_price === '')) continue;
    const rawPid = Number(item?.productId || 0);
    const sku = String(item?.sku || '').trim();
    const name = String(item?.name || '').trim();
    const product = (rawPid && productMapById.get(rawPid)) || (sku && productMapBySku.get(sku)) || (name && productMapByName.get(name)) || null;
    item.cost_price = Number(product?.cost_price || 0);
  }

  return list;
}

async function restoreInventoryForInvoiceItem(item, qtyOverride = null) {
  const qty = Number(qtyOverride != null ? qtyOverride : item?.qty || 0);
  if (qty <= 0) return;

  const pid = await resolveProductIdFromItem(item);
  if (!pid) return;

  await query('update products set stock = stock + $1 where id=$2', [qty, pid]);

  const explicitLote = extractExplicitLote(item);
  const deductions = Array.isArray(item?.deductions) ? item.deductions : [];

  // If the invoice line has no visible lote, return stock to unlotted inventory only.
  if (!explicitLote) return;

  let remaining = qty;
  for (const d of deductions) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(d?.qty || 0));
    if (take <= 0) continue;

    if (d?.batch_id) {
      const b = await query('select id from inventory_batches where id=$1', [d.batch_id]);
      if (b.rows[0]) {
        await query('update inventory_batches set quantity = quantity + $1 where id=$2', [take, d.batch_id]);
      } else {
        await query(
          'insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)',
          [pid, take, d?.expiry || '', d?.lote || explicitLote, Date.now()]
        );
      }
    } else {
      await query(
        'insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)',
        [pid, take, d?.expiry || '', d?.lote || explicitLote, Date.now()]
      );
    }
    remaining -= take;
  }

  if (remaining > 0) {
    await query(
      'insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)',
      [pid, remaining, '', explicitLote, Date.now()]
    );
  }
}

async function simulateSplitStock(items) {
  let finalItems = [];
  for (const item of items) {
    const allocQty = Number(item.allocated_qty || 0);
    const originalQty = Number(item.qty || 0);
    if (allocQty <= 0) {
      finalItems.push(item);
      continue;
    }
    
    let pid = item.productId;
    if (!pid) {
       if (item.sku) {
          const p = await query('select id from products where sku=$1', [item.sku]);
          if (p.rows[0]) pid = p.rows[0].id;
       } else if (item.name) {
          const p = await query('select id from products where name=$1', [item.name]);
          if (p.rows[0]) pid = p.rows[0].id;
       }
    }

    if (pid) {
      let remainingAlloc = allocQty;
      let remainingOrig = originalQty;
      const batches = await query('select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc', [pid]);
      
      let hasSplit = false;
      for (const b of batches.rows) {
        if (remainingAlloc <= 0) break;
        const take = Math.min(Number(b.quantity), remainingAlloc);
        
        let splitItem = { ...item };
        splitItem.allocated_qty = take;
        splitItem.qty = take; 
        
        if (!/lote/i.test(splitItem.description || '')) {
          let spec = (splitItem.description || '').trim();
          let loteStr = formatLote(b.lote);
          if (loteStr) spec = `${spec} Lote:${loteStr}`.trim();
          splitItem.description = spec;
        }
        
        finalItems.push(splitItem);
        remainingAlloc -= take;
        remainingOrig -= take;
        hasSplit = true;
      }
      
      if (remainingAlloc > 0 || remainingOrig > 0) {
         let splitItem = { ...item };
         splitItem.allocated_qty = remainingAlloc;
         splitItem.qty = remainingOrig;
         if (!/lote/i.test(splitItem.description || '')) {
            splitItem.description = (splitItem.description || '').trim();
         }
         finalItems.push(splitItem);
      }
    } else {
      finalItems.push(item);
    }
  }
  return finalItems;
}

async function deductAndSplitStock(items) {
  let finalItems = [];
  for (const item of items) {
    const qty = Number(item.qty || 0);
    if (qty <= 0) {
      finalItems.push(item);
      continue;
    }

    const pid = await resolveProductIdFromItem(item);
    if (pid) {
      const stockR = await query(`
        select
          coalesce(p.stock, 0) as total_stock,
          coalesce((
            select sum(case when quantity > 0 then quantity else 0 end)
            from inventory_batches
            where product_id = p.id
          ), 0) as batch_stock
        from products p
        where p.id = $1
      `, [pid]);
      const totalStock = Number(stockR.rows[0]?.total_stock || 0);
      const batchStock = Number(stockR.rows[0]?.batch_stock || 0);
      const unlottedAvailable = Math.max(0, totalStock - batchStock);

      await query('update products set stock = stock - $1 where id=$2', [qty, pid]);

      let remaining = qty;
      const unlottedTake = Math.min(remaining, unlottedAvailable);
      if (unlottedTake > 0) {
        const splitItem = { ...item };
        splitItem.qty = unlottedTake;
        splitItem.description = (splitItem.description || '').trim();
        splitItem.deductions = [];
        finalItems.push(splitItem);
        remaining -= unlottedTake;
      }

      const batches = await query('select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc, id asc', [pid]);

      for (const b of batches.rows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(b.quantity), remaining);

        if (Number(b.quantity) === take) {
          await query('update inventory_batches set quantity = 0 where id=$1', [b.id]);
        } else {
          await query('update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
        }

        const splitItem = { ...item };
        splitItem.qty = take;

        if (!/lote/i.test(splitItem.description || '')) {
          let spec = (splitItem.description || '').trim();
          let loteStr = formatLote(b.lote);
          if (loteStr) spec = `${spec} Lote:${loteStr}`.trim();
          splitItem.description = spec;
        }

        splitItem.deductions = [{
          batch_id: b.id,
          qty: take,
          expiry: b.expiration_date,
          lote: b.lote
        }];

        finalItems.push(splitItem);
        remaining -= take;
      }

      if (remaining > 0) {
        const splitItem = { ...item };
        splitItem.qty = remaining;
        splitItem.description = (splitItem.description || '').trim();
        splitItem.deductions = [];
        finalItems.push(splitItem);
      }
    } else {
      finalItems.push(item);
    }
  }
  return finalItems;
}

// Ensure schema then defaults sequentially to avoid race
(async () => {
  try {
    if (await waitForDb()) {
      await ensureSchema();
      await ensureDefaults();
      await ensureAutoTasksGenerated();
      setInterval(() => {
        ensureAutoTasksGenerated().catch(e => console.error('auto task generator failed', e));
      }, 60 * 1000);
    } else {
      console.error('Failed to connect to database after retries');
    }
  } catch (e) {
    console.error(e);
  }
})();

// Wait for database
async function waitForDb() {
  for (let i = 0; i < 30; i++) {
    try {
      await query('select 1');
      console.log('Database connected');
      return true;
    } catch (e) {
      console.log('Waiting for database...', e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return false;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_please_change';
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function signJwt(payload, expiresInSec = 24*3600) {
  const header = { alg:'HS256', typ:'JWT' };
  const now = Math.floor(Date.now()/1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const data = h + '.' + p;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  return data + '.' + sig;
}
function verifyJwt(token) {
  try {
    const [h,p,s] = String(token||'').split('.');
    if (!h || !p || !s) return null;
    const data = h+'.'+p;
    const sig2 = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    if (sig2 !== s) return null;
    const payload = JSON.parse(Buffer.from(p.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) return null;
    return payload;
  } catch { return null; }
}
const SUPERADMIN_NAME = 'aaaaaa';
const DEFAULT_USER_PASSWORD = '111111';
const SUPERADMIN_BOOTSTRAP_PASSWORD = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD || '999000';

function getStoredPasswords(user) {
  const vals = [user?.password, user?.password_hash]
    .map(x => String(x || '').trim())
    .filter(Boolean);
  return Array.from(new Set(vals));
}

async function syncUserPasswordFields(userId, password) {
  await query('update users set password=$1, password_hash=$1 where id=$2', [String(password || ''), Number(userId || 0)]);
}

async function ensureDefaults() {
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
  
  // Ensure default roles exist individually
  const defaultRoles = [
    { name: '超级管理员', desc: '系统预置角色' },
    { name: '财务', desc: '系统预置角色' },
    { name: '股东', desc: '系统预置角色' },
    { name: '后台管理人员', desc: '系统预置角色' }
  ];

  for (const role of defaultRoles) {
    const r = await query('select count(*)::int as c from roles where name=$1', [role.name]);
    if (r.rows[0].c === 0) {
      console.log('Inserting missing role:', role.name);
      await query("insert into roles(name, description, created, immutable, perms) values($1,$2,$3,true,$4)", [role.name, role.desc, now, JSON.stringify({})]);
    }
  }

  const u = await query('select count(*)::int as c from users where name=$1', [SUPERADMIN_NAME]);
  if (u.rows[0].c === 0) {
    console.log('Inserting missing user: aaaaaa');
    await query('insert into users(name, role, created, enabled, password) values($1,$2,$3,true,$4)', [SUPERADMIN_NAME,'超级管理员', now, SUPERADMIN_BOOTSTRAP_PASSWORD]);
  }
  await query("update users set enabled=true where name=$1 and enabled is null", [SUPERADMIN_NAME]);
  await query("update users set password=$2, password_hash=$2 where name=$1 and (password is null or password='' or password=$1)", [SUPERADMIN_NAME, SUPERADMIN_BOOTSTRAP_PASSWORD]);
  await query("update users set password_hash=password where name=$1 and (password_hash is null or password_hash='')", [SUPERADMIN_NAME]);
  
  // Seed default users if missing
  const u2 = await query('select count(*)::int as c from users where name=$1', ['shuangqun']);
  if (u2.rows[0].c === 0) {
    console.log('Inserting missing user: shuangqun');
    await query('insert into users(name, role, created, enabled, password) values($1,$2,$3,true,$4)', ['shuangqun','股东', now, '111111']);
  }
  await query("update users set enabled=true where name=$1 and enabled is null", ['shuangqun']);
  await query("update users set password_hash=password where name=$1 and (password_hash is null or password_hash='')", ['shuangqun']);
  
  const u3 = await query('select count(*)::int as c from users where name=$1', ['caiwu']);
  if (u3.rows[0].c === 0) {
    console.log('Inserting missing user: caiwu');
    await query('insert into users(name, role, created, enabled, password) values($1,$2,$3,true,$4)', ['caiwu','财务', now, '111111']);
  }
  await query("update users set enabled=true where name=$1 and enabled is null", ['caiwu']);
  await query("update users set password_hash=password where name=$1 and (password_hash is null or password_hash='')", ['caiwu']);
  
  const c1 = await query('select count(*)::int as c from categories', []);
  if (c1.rows[0].c === 0) {
    const incomeChildren = ['服务收入(现金)','服务收入(银行)','银行储蓄','现金借贷','订单收入','其它收入'];
    const expenseChildren = ['现金开支','员工工资','出差补贴','人工开支','其它开支'];
    await query('insert into categories(name, children) values($1,$2)', ['收入', JSON.stringify(incomeChildren)]);
    await query('insert into categories(name, children) values($1,$2)', ['开支', JSON.stringify(expenseChildren)]);
  }
  const a1 = await query('select count(*)::int as c from accounts', []);
  if (a1.rows[0].c === 0) {
    const now = new Date().toISOString().slice(0,19).replace('T',' ');
    await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', ['现金账户', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', ['银行账户 BBVA', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', ['银行账户 Santander', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', ['人民币账号1', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', ['人民币账户 中智', 0, '系统预置账户', now, false]);
  }
  // Ensure named preset accounts exist even if table not empty
  const presetNames = ['现金账户','银行账户 BBVA','银行账户 Santander','人民币账号1','人民币账户 中智'];
  for (const nm of presetNames) {
    const r = await query('select count(*)::int as c from accounts where name=$1', [nm]);
    if (r.rows[0].c === 0) {
      const now2 = new Date().toISOString().slice(0,19).replace('T',' ');
      await query('insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5)', [nm, 0, '系统预置账户', now2, false]);
    }
  }
  // Migrate old generic names to new presets then remove old accounts
  await query('update ledger set method=$1 where method=$2', ['现金账户', '现金']);
  await query('update ledger set method=$1 where method=$2', ['银行账户 BBVA', '银行']);
  await query('delete from accounts where name = any($1::text[])', [[ '现金', '银行' ]]);
  const ct = await query('select count(*)::int as c from contacts', []);
  if (ct.rows[0].c === 0) {
    const now = new Date().toISOString().slice(0,19).replace('T',' ');
    // Check individually before insert to avoid race or unique violation if partial data exists
    const c1 = await query('select id from contacts where name=$1 and owner=$2', ['示例客户A', '客户']);
    if (!c1.rows[0]) {
        await query('insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          ['示例客户A','','','', '', '客户', now, '', '', '', '', '', '']);
    }
    const c2 = await query('select id from contacts where name=$1 and owner=$2', ['示例商家B', '商家']);
    if (!c2.rows[0]) {
        await query('insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          ['示例商家B','','','', '', '商家', now, '', '', '', '', '', '']);
    }
    const c3 = await query('select id from contacts where name=$1 and owner=$2', ['示例往来C', '其它']);
    if (!c3.rows[0]) {
        await query('insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          ['示例往来C','','','', '', '其它', now, '', '', '', '', '', '']);
    }
  }
}

async function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error:'unauthorized' });
  req.user = { name: payload.name, role: payload.role };
  next();
}

const rolePermsCache = new Map();

async function getRolePerms(roleName) {
  if (!roleName) return {};
  let perms = rolePermsCache.get(roleName);
  if (!perms) {
    const r = await query('select perms from roles where name=$1', [roleName]);
    perms = (r.rows[0]?.perms) || {};
    rolePermsCache.set(roleName, perms);
  }
  return perms;
}

function normalizeNameList(val) {
  if (Array.isArray(val)) return [...new Set(val.map(v => String(v || '').trim()).filter(Boolean))];
  if (typeof val === 'string') {
    const text = val.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return [...new Set(parsed.map(v => String(v || '').trim()).filter(Boolean))];
    } catch {}
    return [...new Set(text.split(',').map(v => String(v || '').trim()).filter(Boolean))];
  }
  return [];
}

function ensureAllow(module, action) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error:'unauthorized' });
    const roleName = req.user.role || '';
    if (roleName === '超级管理员') return next();
    
    const perms = await getRolePerms(roleName);
    const modPerms = perms[module] || {};
    if (action === 'view') {
      if (modPerms.view) return next();
    } else if (action === 'assigned_only') {
      if (modPerms.assigned_only) return next();
    } else {
      if (modPerms.edit || modPerms[action]) return next();
    }
    return res.status(403).json({ error:'forbidden' });
  };
}
function ensureAdmin(req, res, next) {
  if ((req.user?.role || '') !== '超级管理员') return res.status(403).json({ error:'forbidden' });
  next();
}

// Auth endpoints
app.get('/api/auth/users', async (req, res) => {
  try {
    const r = await query('select name, role from users where enabled=true order by id asc');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});
app.post('/api/auth/login', async (req, res) => {
  const { name='', password='' } = req.body || {};
  const r = await query('select name, role, enabled, password, password_hash from users where name=$1', [name]);
  const u = r.rows[0];
  const inputPassword = String(password || '');
  const storedPasswords = getStoredPasswords(u);
  if (!u || !u.enabled || !storedPasswords.includes(inputPassword)) return res.status(401).json({ error:'bad_credentials' });
  if (storedPasswords.length > 1 || String(u?.password || '') !== inputPassword || String(u?.password_hash || '') !== inputPassword) {
    await syncUserPasswordFields(u.id, inputPassword);
  }
  const token = signJwt({ name: u.name, role: u.role||'' }, 24*3600);
  res.json({ token, user: { name: u.name, role: u.role||'' } });
});
app.post('/api/users/change-password', authRequired, async (req, res) => {
  const { oldPassword='', newPassword='' } = req.body || {};
  const name = req.user?.name || '';
  if (!name || !oldPassword || !newPassword) return res.status(400).json({ error:'bad_request' });
  const r = await query('select id, password, password_hash from users where name=$1', [name]);
  const u = r.rows[0];
  if (!u) return res.status(404).json({ error:'not_found' });
  if (!getStoredPasswords(u).includes(String(oldPassword))) return res.status(401).json({ error:'bad_credentials' });
  await syncUserPasswordFields(u.id, newPassword);
  res.json({ ok: true });
});
app.get('/api/auth/me', authRequired, async (req, res) => {
  res.json({ user: req.user });
});

function roundMoneyValue(val) {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

function moneyGte(a, b) {
  return roundMoneyValue(a) >= roundMoneyValue(b);
}

function normalizePayable(rec) {
  const now = Date.now();
  const amount = roundMoneyValue(rec.amount || 0);
  const paid = Math.min(roundMoneyValue(rec.paid || 0), amount);
  const settled = amount > 0 && moneyGte(paid, amount);
  const history = Array.isArray(rec.history) ? rec.history : [];
  return {
    type: String(rec.type || ''),
    partner: String(rec.partner || ''),
    doc: String(rec.doc || ''),
    amount,
    paid,
    settled,
    trust_days: rec.trustDays ?? null,
    notes: String(rec.notes || ''),
    invoice_no: String(rec.invoiceNo || ''),
    invoice_date: String(rec.invoiceDate || ''),
    invoice_amount: roundMoneyValue(rec.invoiceAmount || 0),
    sales: String(rec.sales || ''),
    date: String(rec.date || ''),
    created_at: Number(rec.createdAt || now),
    batch_at: Number(rec.batchAt || now),
    batch_order: rec.batchOrder ?? 0,
    source: String(rec.source || 'import'),
    history,
    confirmed: rec.confirmed === false ? false : true
  };
}

app.get('/api/payables', authRequired, ensureAllow('payables','view'), async (req, res) => {
  const { q, type } = req.query;
  const params = [];
  let sql = 'select * from payables';
  const conds = [];
  if (type && (type === '应收账款' || type === '应付账款')) { params.push(type); conds.push(`type=$${params.length}`); }
  if (q) { params.push(`%${q}%`); conds.push(`(partner ilike $${params.length} or doc ilike $${params.length})`); }
  if (conds.length) sql += ' where ' + conds.join(' and ');
  sql += ' order by batch_at desc nulls last, batch_order asc nulls last, created_at desc';
  const r = await query(sql, params);
  res.json(r.rows);
});

app.post('/api/payables', authRequired, ensureAllow('payables','create'), async (req, res) => {
  const p = normalizePayable({ ...req.body, source: req.body.source || 'manual' });
  if (!p.type || !p.partner || !p.doc || !p.amount) return res.status(400).json({ error: 'bad_request' });
  // upsert by (type, doc)
  const r = await query(`
    insert into payables(type,partner,doc,amount,paid,settled,trust_days,notes,invoice_no,invoice_date,invoice_amount,sales,date,created_at,batch_at,batch_order,source,history,confirmed)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    on conflict (type, doc) do update set
      partner=excluded.partner,
      amount=excluded.amount,
      paid=excluded.paid,
      settled=excluded.settled,
      trust_days=excluded.trust_days,
      notes=excluded.notes,
      invoice_no=excluded.invoice_no,
      invoice_date=excluded.invoice_date,
      invoice_amount=excluded.invoice_amount,
      sales=excluded.sales,
      date=excluded.date,
      created_at=excluded.created_at,
      batch_at=excluded.batch_at,
      batch_order=excluded.batch_order,
      source=excluded.source,
      history=excluded.history,
      confirmed=excluded.confirmed
    returning *;
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed]);
  res.json({ id: r.rows[0].id });
});

app.post('/api/payables/import', authRequired, ensureAllow('payables','import'), async (req, res) => {
  const list = Array.isArray(req.body.records) ? req.body.records : [];
  let inserted = 0, updated = 0;
  for (const rec of list) {
    const p = normalizePayable(rec);
    if (!p.type || !p.partner || !p.doc || !p.amount) continue;
    const r = await query(`
      insert into payables(type,partner,doc,amount,paid,settled,trust_days,notes,invoice_no,invoice_date,invoice_amount,sales,date,created_at,batch_at,batch_order,source,history,confirmed)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      on conflict (type, doc) do update set
        partner=excluded.partner,
        amount=excluded.amount,
        paid=excluded.paid,
        settled=excluded.settled,
        trust_days=excluded.trust_days,
        notes=excluded.notes,
        invoice_no=excluded.invoice_no,
        invoice_date=excluded.invoice_date,
        invoice_amount=excluded.invoice_amount,
        sales=excluded.sales,
        date=excluded.date,
        created_at=excluded.created_at,
        batch_at=excluded.batch_at,
        batch_order=excluded.batch_order,
        source=excluded.source,
        history=excluded.history,
        confirmed=excluded.confirmed
      returning xmax = 0 as inserted;
    `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed]);
    if (r.rows[0]?.inserted) inserted++; else updated++;
  }
  res.json({ inserted, updated });
});
app.put('/api/payables/:id', authRequired, ensureAllow('payables','create'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const p = normalizePayable({ ...req.body, confirmed: false });
  const r = await query(`
    update payables set
      type=$1, partner=$2, doc=$3, amount=$4, paid=$5, settled=$6, trust_days=$7,
      notes=$8, invoice_no=$9, invoice_date=$10, invoice_amount=$11, sales=$12,
      date=$13, created_at=$14, batch_at=$15, batch_order=$16, source=$17, history=$18, confirmed=$19
    where id=$20 and confirmed=false
    returning id
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed,id]);
  if (!r.rows[0]) return res.status(400).json({ error:'not_editable' });
  res.json({ ok: true });
});
app.put('/api/payables/:id/refund', authRequired, ensureAllow('payables','create'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const p = normalizePayable(req.body || {});
  const r = await query(`
    update payables set
      type=$1, partner=$2, doc=$3, amount=$4, paid=$5, settled=$6, trust_days=$7,
      notes=$8, invoice_no=$9, invoice_date=$10, invoice_amount=$11, sales=$12,
      date=$13, created_at=$14, batch_at=$15, batch_order=$16, source=$17, history=$18, confirmed=$19
    where id=$20
    returning id
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed,id]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true });
});
app.put('/api/payables/:id/confirm', authRequired, ensureAllow('payables','create'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('update payables set confirmed=true where id=$1 and confirmed=false returning id', [id]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true });
});
app.delete('/api/payables', authRequired, ensureAdmin, async (req, res) => {
  await query('delete from payables');
  res.json({ ok: true });
});

app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const normalizedFile = await normalizeUploadedImage(req.file);
    const fileUrl = `/uploads/${normalizedFile.filename}`;
    res.json({ url: fileUrl, filename: req.file.originalname });
  } catch (err) {
    console.error('upload normalize failed', err);
    res.status(500).json({ error: 'upload_normalize_failed' });
  }
});
app.post('/api/public/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const normalizedFile = await normalizeUploadedImage(req.file);
    const fileUrl = `/uploads/${normalizedFile.filename}`;
    res.json({ url: fileUrl, filename: req.file.originalname });
  } catch (err) {
    console.error('public upload normalize failed', err);
    res.status(500).json({ error: 'upload_normalize_failed' });
  }
});
app.get('/api/public/products', async (req, res) => {
  const { page = '1', size = '50', q = '' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(size, 10) || 20));
  let sql = 'select id, sku, name, name_cn, image, stock from products';
  let countSql = 'select count(*)::int as c from products';
  const vals = [];
  if (String(q || '').trim()) {
    vals.push(`%${String(q).trim()}%`);
    const cond = ' where (name ilike $1 or name_cn ilike $1 or sku ilike $1 or barcode ilike $1)';
    sql += cond;
    countSql += cond;
  }
  const count = await query(countSql, vals);
  sql += ` order by length(sku) asc, sku asc limit $${vals.length + 1} offset $${vals.length + 2}`;
  vals.push(pageSize, (pageNum - 1) * pageSize);
  const list = await query(sql, vals);
  res.json({ list: list.rows, total: Number(count.rows[0]?.c || 0) });
});
app.get('/api/public/products/:id/batch-stock', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  if (!id) return res.status(400).json({ error: 'bad_request' });
  const r = await query(`
    select
      p.id,
      p.name,
      p.name_cn,
      p.stock,
      (
        select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc, id asc)
        from inventory_batches
        where product_id = p.id and quantity > 0
      ) as batches
    from products p
    where p.id=$1
  `, [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(r.rows[0]);
});
app.get('/api/public/production-entries', async (req, res) => {
  const status = String(req.query.status || 'pending').trim();
  const size = Math.max(1, Math.min(50, parseInt(req.query.size, 10) || 10));
  const q = String(req.query.q || '').trim();
  const params = [status];
  let where = ` where status=$1 and created_by='warehouse-device'`;
  if (q) {
    params.push(`%${q}%`);
    where += ` and (
      coalesce(product_name,'') ilike $${params.length}
      or coalesce(product_name_cn,'') ilike $${params.length}
      or coalesce(lote,'') ilike $${params.length}
    )`;
  }
  params.push(size);
  const r = await query(
    `select id, product_id, product_name, product_name_cn, product_image, lote, expiration_date, box_count, photo_url, created_at
     from production_entries${where}
     order by created_at desc, id desc
     limit $${params.length}`,
    params
  );
  res.json(r.rows);
});
app.post('/api/public/production-entries', async (req, res) => {
  const x = req.body || {};
  const productId = Number(x.product_id || 0);
  const boxCount = Number(x.box_count || 0);
  const photoUrl = String(x.photo_url || '').trim();
  if (!productId || !Number.isFinite(boxCount) || boxCount <= 0 || !photoUrl) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const prod = await query('select id, name, name_cn, image from products where id=$1', [productId]);
  if (!prod.rows[0]) return res.status(404).json({ error: 'product_not_found' });
  const p = prod.rows[0];
  const now = Date.now();
  const r = await query(
    `insert into production_entries(
      product_id, product_name, product_name_cn, product_image, lote, expiration_date, box_count, photo_url, status, created_at, created_by
    ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10) returning id`,
    [
      productId,
      p.name || '',
      p.name_cn || '',
      p.image || '',
      String(x.lote || '').trim(),
      String(x.expiration_date || '').trim(),
      boxCount,
      photoUrl,
      now,
      'warehouse-device'
    ]
  );
  res.json({ id: r.rows[0].id });
});
app.put('/api/public/production-entries/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const productId = Number(x.product_id || 0);
  const boxCount = Number(x.box_count || 0);
  const photoUrl = String(x.photo_url || '').trim();
  if (!id || !productId || !Number.isFinite(boxCount) || boxCount <= 0 || !photoUrl) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const current = await query(
    `select id, status, created_by from production_entries where id=$1`,
    [id]
  );
  const entry = current.rows[0];
  if (!entry || String(entry.created_by || '') !== 'warehouse-device') {
    return res.status(404).json({ error: 'not_found' });
  }
  if (String(entry.status || '') !== 'pending') {
    return res.status(400).json({ error: 'already_reviewed' });
  }
  const prod = await query('select id, name, name_cn, image from products where id=$1', [productId]);
  if (!prod.rows[0]) return res.status(404).json({ error: 'product_not_found' });
  const p = prod.rows[0];
  await query(
    `update production_entries set
      product_id=$1,
      product_name=$2,
      product_name_cn=$3,
      product_image=$4,
      lote=$5,
      expiration_date=$6,
      box_count=$7,
      photo_url=$8
     where id=$9`,
    [
      productId,
      p.name || '',
      p.name_cn || '',
      p.image || '',
      String(x.lote || '').trim(),
      String(x.expiration_date || '').trim(),
      boxCount,
      photoUrl,
      id
    ]
  );
  res.json({ ok: true });
});

app.get('/api/ledger', authRequired, ensureAllow('ledger','view'), async (req, res) => {
  const r = await query('select * from ledger order by created_at desc nulls last, id desc');
  res.json(r.rows);
});
async function applyLedgerEffects(x) {
  const method = (x.method || '').trim();
  const amount = roundMoneyValue(x.amount || 0);
  if (x.doc && x.type) {
    if (x.type === '收入') {
      await query(`update payables set paid = least(round(coalesce(paid,0) + $1, 2), round(amount, 2)), settled = (least(round(coalesce(paid,0) + $1, 2), round(amount, 2)) >= round(amount, 2)),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where doc=$7 and type='应收账款'`, [amount, x.date_time||x.date||'', x.created_by||'', '收款', x.notes||'', method, x.doc]);
    } else if (x.type === '支出' || x.type === '开支') {
      await query(`update payables set paid = least(round(coalesce(paid,0) + $1, 2), round(amount, 2)), settled = (least(round(coalesce(paid,0) + $1, 2), round(amount, 2)) >= round(amount, 2)),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where doc=$7 and type='应付账款'`, [amount, x.date_time||x.date||'', x.created_by||'', '付款', x.notes||'', method, x.doc]);
    }
  }
  
  if (method && x.type) {
    if (x.type === '收入') {
      await query(`update accounts set balance = coalesce(balance,0) + $1 where trim(name) = $2`, [amount, method]);
    } else if (x.type === '支出' || x.type === '开支') {
      await query(`update accounts set balance = coalesce(balance,0) - $1 where trim(name) = $2`, [amount, method]);
    }
  }
}
app.post('/api/ledger', authRequired, ensureAllow('ledger','create'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const createdAt = Number(x.createdAt);
  const confirmed = x.confirmed === false ? false : true;
  const r = await query(`
    insert into ledger(type,category,doc,client,amount,method,file,notes,date,date_time,created_at,created_by,confirmed)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    returning id
  `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', (Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now), x.createdBy||'', confirmed]);
  if (confirmed) await applyLedgerEffects({ type:x.type, doc:x.doc, amount:x.amount, method:x.method, date_time:x.dateTime, date:x.date, created_by:x.createdBy, notes:x.notes });
  res.json({ id: r.rows[0].id });
});
app.put('/api/ledger/:id', authRequired, ensureAllow('ledger','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const r = await query(`
    update ledger set
      type=$1, category=$2, doc=$3, client=$4, amount=$5, method=$6, file=$7, notes=$8,
      date=$9, date_time=$10
    where id=$11 and confirmed=false
    returning id
  `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', id]);
  if (!r.rows[0]) return res.status(400).json({ error:'not_editable' });
  res.json({ ok: true });
});
app.put('/api/ledger/:id/file', authRequired, ensureAllow('ledger','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const { file = '' } = req.body || {};
  const r = await query(`
    update ledger set file=$1
    where id=$2
    returning id
  `, [file || '', id]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true });
});
app.put('/api/ledger/:id/confirm', authRequired, ensureAllow('ledger','create'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r0 = await query('select * from ledger where id=$1 and confirmed=false', [id]);
  const row = r0.rows[0];
  if (!row) return res.status(404).json({ error:'not_found' });
  await applyLedgerEffects(row);
  await query('update ledger set confirmed=true, confirmed_by=$2 where id=$1', [id, req.user?.name || '']);
  res.json({ ok: true });
});
app.delete('/api/ledger/:id', authRequired, ensureAllow('ledger','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('delete from ledger where id=$1 and confirmed=false returning id', [id]);
  if (!r.rows[0]) return res.status(400).json({ error: 'not_deletable_or_not_found' });
  res.json({ ok: true });
});
app.delete('/api/ledger', authRequired, ensureAdmin, async (req, res) => {
  const nets = await query(`select method, sum(case when type='收入' then amount when type in ('支出','开支') then -amount else 0 end) as net from ledger group by method`);
  for (const row of nets.rows) {
    if (!row.method) continue;
    const net = Number(row.net || 0);
    if (!net) continue;
    await query('update accounts set balance = coalesce(balance,0) - $1 where name=$2', [net, row.method]);
  }
  await query(`update payables set paid=0, settled=false,
    history=coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(history,'[]'::jsonb)) x where coalesce(x->>'kind','') <> '银行付款'),'[]'::jsonb)`);
  await query('delete from ledger');
  res.json({ ok: true });
});

// Contacts endpoints
app.get('/api/contacts', authRequired, ensureAllow('contacts','view'), async (req, res) => {
  const { tab = 'customers', q = '', page = '1', size = '100' } = req.query;
  const owner = tab === 'merchants' ? '商家' : (tab === 'others' ? '其它' : '客户');
  const p = [];
  let sql = 'select * from contacts where owner=$1';
  p.push(owner);
  if (q && String(q).trim()) {
    p.push('%' + q.trim() + '%');
    sql += ` and (name ilike $${p.length} or company ilike $${p.length} or code ilike $${p.length} or contact ilike $${p.length} or phone ilike $${p.length} or sales ilike $${p.length})`;
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(5000, parseInt(size, 10) || 100));
  sql += ' order by id desc';
  sql += ` limit ${pageSize} offset ${(pageNum-1)*pageSize}`;
  const r = await query(sql, p);
  res.json(r.rows);
});

app.post('/api/contacts', authRequired, ensureAllow('contacts','create'), async (req, res) => {
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  try {
    const r = await query(`
      insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales, use_price, is_iva, invoice_nota, email, province, ship_address, ship_zip, ship_city, ship_province, ship_country, ship_phone, ship_contact)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning id
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', owner, x.created||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva, x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'']);
    res.json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'duplicate_name' });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.put('/api/contacts/:id', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  try {
    const r = await query(`
      update contacts set name=$1, contact=$2, phone=$3, city=$4, remark=$5, company=$6, code=$7, country=$8, address=$9, zip=$10, sales=$11, use_price=$12, is_iva=$13,
      invoice_nota=$14, email=$15, province=$16, ship_address=$17, ship_zip=$18, ship_city=$19, ship_province=$20, ship_country=$21, ship_phone=$22, ship_contact=$23, owner=$24
      where id=$25
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
        x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'', owner,
        id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.put('/api/contacts/by-name', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  await query(`
    update contacts set contact=$1, phone=$2, city=$3, remark=$4, company=$5, code=$6, country=$7, address=$8, zip=$9, sales=$10, use_price=$11, is_iva=$12,
    invoice_nota=$13, email=$14, province=$15, ship_address=$16, ship_zip=$17, ship_city=$18, ship_province=$19, ship_country=$20, ship_phone=$21, ship_contact=$22
    where owner=$23 and name=$24
  `, [x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
      x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
      owner, x.name||'']);
  res.json({ ok: true });
});

app.put('/api/contacts/by-company', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  
  const exist = await query('select id from contacts where owner=$1 and company=$2 limit 1', [owner, x.company]);
  if (!exist.rows[0]) return res.status(404).json({ error: 'not_found' });
  
  await query(`
    update contacts set name=$1, contact=$2, phone=$3, city=$4, remark=$5, code=$6, country=$7, address=$8, zip=$9, sales=$10, use_price=$11, is_iva=$12,
    invoice_nota=$13, email=$14, province=$15, ship_address=$16, ship_zip=$17, ship_city=$18, ship_province=$19, ship_country=$20, ship_phone=$21, ship_contact=$22
    where id=$23
  `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
      x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
      exist.rows[0].id]);
  res.json({ ok: true });
});

app.delete('/api/contacts/by-name', authRequired, ensureAllow('contacts','delete'), async (req, res) => {
  const { owner = '客户', name = '' } = req.query;
  const p1 = await query('select count(*)::int as c from payables where partner=$1', [name]);
  const p2 = await query('select count(*)::int as c from ledger where client=$1', [name]);
  const inUse = (p1.rows[0].c > 0) || (p2.rows[0].c > 0);
  if (inUse) return res.status(400).json({ error: 'in_use' });
  await query('delete from contacts where owner=$1 and name=$2', [owner, name]);
  res.json({ ok: true });
});

// Contact Notes endpoints
app.get('/api/contacts/:id/notes', authRequired, ensureAllow('contacts','view'), async (req, res) => {
  const contactId = parseInt(req.params.id, 10) || 0;
  const r = await query('select * from contact_notes where contact_id=$1 order by id desc', [contactId]);
  res.json(r.rows);
});

app.post('/api/contacts/:id/notes', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const contactId = parseInt(req.params.id, 10) || 0;
  const { note='' } = req.body || {};
  if (!note.trim()) return res.status(400).json({ error: 'empty_note' });
  const now = Date.now();
  const r = await query('insert into contact_notes(contact_id, note, created_at, created_by) values($1, $2, $3, $4) returning id',
    [contactId, note, now, req.user.name||'']);
  res.json({ id: r.rows[0].id });
});

app.put('/api/contacts/notes/:id', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const { note='' } = req.body || {};
  if (!note.trim()) return res.status(400).json({ error: 'empty_note' });
  const r = await query('update contact_notes set note=$1 where id=$2 returning id', [note, id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

app.delete('/api/contacts/notes/:id', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  await query('delete from contact_notes where id=$1', [id]);
  res.json({ ok: true });
});

// Accounts endpoints
app.get('/api/accounts', authRequired, ensureAllow('accounts','view'), async (req, res) => {
  const r = await query('select name,balance,description as desc,created,initial_set from accounts order by id desc');
  res.json(r.rows);
});
app.post('/api/accounts', authRequired, ensureAllow('accounts','create_account'), async (req, res) => {
  const x = req.body || {};
  const r = await query(`insert into accounts(name, balance, description, created, initial_set) values($1,$2,$3,$4,$5) returning id`,
    [x.name||'', Number(x.balance||0), x.desc||'', x.created||'', !!x.initialSet]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/accounts/by-name', authRequired, ensureAllow('accounts','edit_account'), async (req, res) => {
  const x = req.body || {};
  await query(`update accounts set name=$1, description=$2 where name=$3`, [x.newName||x.name||'', x.desc||'', x.name||'']);
  res.json({ ok: true });
});
app.put('/api/accounts/init', authRequired, ensureAllow('accounts','init_account'), async (req, res) => {
  const { name = '', amount = 0 } = req.body || {};
  await query(`update accounts set balance=$1, initial_set=true where name=$2`, [Number(amount||0), name]);
  res.json({ ok: true });
});
app.delete('/api/accounts/by-name', authRequired, ensureAllow('accounts','delete_account'), async (req, res) => {
  const { name = '' } = req.query;
  const used = await query('select count(*)::int as c from ledger where method=$1', [name]);
  if (used.rows[0].c > 0) return res.status(400).json({ error: 'in_use' });
  await query('delete from accounts where name=$1', [name]);
  res.json({ ok: true });
});
// Categories endpoints
app.get('/api/categories', authRequired, ensureAllow('categories','view'), async (req, res) => {
  const r = await query('select * from categories order by name');
  res.json(r.rows.map(x => ({ name: x.name, children: x.children || [] })));
});
app.put('/api/categories', authRequired, ensureAllow('categories','manage'), async (req, res) => {
  const list = Array.isArray(req.body?.list) ? req.body.list : [];
  await query('delete from categories', []);
  for (const c of list) {
    await query('insert into categories(name, children) values($1,$2)', [String(c.name||''), JSON.stringify(Array.isArray(c.children)?c.children:[])]);
  }
  res.json({ ok: true, count: list.length });
});
// Sales endpoints
app.get('/api/sales', authRequired, ensureAllow('sales_accounts','view'), async (req, res) => {
  const { q='' } = req.query;
  let sql = 'select * from sales';
  const p = [];
  if (q && q.trim()) { sql += ' where (name ilike $1 or region ilike $1 or phone ilike $1)'; p.push('%'+q.trim()+'%'); }
  sql += ' order by id desc';
  const r = await query(sql, p);
  res.json(r.rows);
});
app.post('/api/sales', authRequired, ensureAllow('sales_accounts','create_sales'), async (req, res) => {
  const x = req.body || {};
  const r = await query(`insert into sales(name, region, phone, base, rate, commission, created) values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [x.name||'', x.region||'', x.phone||'', Number(x.base||0), Number(x.rate||0), Number(x.commission||0), x.created||'']);
  res.json({ id: r.rows[0].id });
});
app.put('/api/sales/:id', authRequired, ensureAllow('sales_accounts','edit_sales'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  await query(`update sales set name=$1, region=$2, phone=$3, base=$4, rate=$5, commission=$6 where id=$7`,
    [x.name||'', x.region||'', x.phone||'', Number(x.base||0), Number(x.rate||0), Number(x.commission||0), id]);
  res.json({ ok: true });
});
app.delete('/api/sales/:id', authRequired, ensureAllow('sales_accounts','delete_sales'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('select name from sales where id=$1', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  const name = r.rows[0].name;
  const used = await query('select count(*)::int as c from payables where sales=$1', [name]);
  if (used.rows[0].c > 0) return res.status(400).json({ error: 'in_use' });
  await query('delete from sales where id=$1', [id]);
  res.json({ ok: true });
});
// Roles endpoints
app.get('/api/roles', authRequired, async (req, res) => {
  const r = await query('select id,name,description as desc,created,immutable,perms from roles order by id');
  res.json(r.rows);
});
app.get('/api/roles/me', authRequired, async (req, res) => {
  const roleName = req.user?.role || '';
  if (!roleName) return res.json({ name:'', perms:{} });
  const r = await query('select name, perms from roles where name=$1', [roleName]);
  const row = r.rows[0];
  res.json({ name: row?.name || roleName, perms: row?.perms || {} });
});
app.post('/api/roles', authRequired, ensureAllow('role_accounts','create_role'), async (req, res) => {
  const x = req.body || {};
  const r = await query('insert into roles(name, description, created, immutable, perms) values($1,$2,$3,false,$4) returning id',
    [x.name||'', x.desc||'', x.created||'', JSON.stringify(x.perms||{})]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/roles/:id', authRequired, ensureAllow('role_accounts','edit_role'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const r0 = await query('select immutable from roles where id=$1', [id]);
  if (!r0.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (r0.rows[0].immutable) return res.status(400).json({ error: 'immutable' });
  await query('update roles set name=$1, description=$2 where id=$3', [x.name||'', x.desc||'', id]);
  rolePermsCache.clear();
  res.json({ ok: true });
});
app.put('/api/roles/:id/perms', authRequired, ensureAllow('role_accounts','edit_role'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const r0 = await query('select name, immutable from roles where id=$1', [id]);
  if (!r0.rows[0]) return res.status(404).json({ error: 'not_found' });
  if ((r0.rows[0].name || '') === '超级管理员') return res.status(400).json({ error: 'immutable' });
  await query('update roles set perms=$1 where id=$2', [JSON.stringify(x.perms||{}), id]);
  rolePermsCache.clear();
  res.json({ ok: true });
});
app.delete('/api/roles/:id', authRequired, ensureAllow('role_accounts','delete_role'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r0 = await query('select name, immutable from roles where id=$1', [id]);
  if (!r0.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (r0.rows[0].immutable) return res.status(400).json({ error: 'immutable' });
  const used = await query('select count(*)::int as c from users where role=$1', [r0.rows[0].name]);
  if (used.rows[0].c > 0) return res.status(400).json({ error: 'in_use' });
  await query('delete from roles where id=$1', [id]);
  rolePermsCache.clear();
  res.json({ ok: true });
});
// Users endpoints
app.get('/api/users', authRequired, ensureAllow('user_accounts','view'), async (req, res) => {
  const r = await query('select * from users order by id desc');
  res.json(r.rows);
});
app.post('/api/users', authRequired, ensureAllow('user_accounts','create_user'), async (req, res) => {
  const x = req.body || {};
  const pwd = x.password || '';
  const r = await query('insert into users(name, role, created, enabled, password, password_hash) values($1,$2,$3,true,$4,$5) returning id',
    [x.name||'', x.role||'', x.created||'', pwd, pwd]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/users/:id', authRequired, ensureAllow('user_accounts','enable_user'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const userR = await query('select id, name, enabled from users where id=$1', [id]);
  const user = userR.rows[0];
  if (!user) return res.status(404).json({ error: 'not_found' });
  const name = String(x.name ?? user.name ?? '').trim();
  const role = String(x.role ?? '').trim();
  const enabled = typeof x.enabled === 'boolean' ? x.enabled : !!user.enabled;
  if (!name) return res.status(400).json({ error: 'bad_request' });
  const duplicate = await query('select id from users where lower(name)=lower($1) and id<>$2 limit 1', [name, id]);
  if (duplicate.rows[0]) return res.status(400).json({ error: 'duplicate' });
  await query('update users set name=$1, role=$2, enabled=$3 where id=$4', [name, role, enabled, id]);
  res.json({ ok: true, name, role, enabled });
});
app.post('/api/users/:id/reset-password', authRequired, ensureAllow('user_accounts','reset_password'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('select id, name from users where id=$1', [id]);
  const u = r.rows[0];
  if (!u) return res.status(404).json({ error:'not_found' });
  if (u.name === SUPERADMIN_NAME) return res.status(403).json({ error:'protected_account' });
  const { password = DEFAULT_USER_PASSWORD } = req.body || {};
  await syncUserPasswordFields(u.id, password);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authRequired, ensureAllow('user_accounts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === 1) return res.status(403).json({ error: 'cannot_delete_superadmin' });
  await query('delete from users where id=$1', [id]);
  res.json({ ok: true });
});

app.get('/api/analytics/ledger-summary', authRequired, ensureAllow('ledger','view'), async (req, res) => {
  const { period='month', range='12', baseDate } = req.query;
  const n = Math.max(1, Math.min(365, parseInt(range, 10) || 12));
  let now = new Date();
  if (baseDate) {
    if (period === 'year' && /^\d{4}$/.test(baseDate)) {
      now = new Date(parseInt(baseDate), 11, 31);
    } else if (period === 'month' && /^\d{4}-\d{2}$/.test(baseDate)) {
      const parts = baseDate.split('-');
      now = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 15);
    }
  }
  const out = [];
  function fmtYMD(d) {
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`;
  }
  for (let i=n-1;i>=0;i--) {
    let label = '';
    let start = '', end = '';
    if (period === 'year') {
      const y = now.getFullYear() - i;
      label = String(y);
      start = `${y}-01-01`; end = `${y}-12-31`;
    } else if (period === 'day') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()-i);
      label = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      start = fmtYMD(d); end = fmtYMD(d);
    } else {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0');
      label = `${y}-${m}`;
      start = `${y}-${m}-01`;
      const d2 = new Date(d.getFullYear(), d.getMonth()+1, 0);
      end = fmtYMD(d2);
    }
    const r = await query(`
      select type, sum(amount)::numeric(12,2) as total
      from ledger
      where date >= $1 and date <= $2
      group by type
    `, [start, end]);
    const income = r.rows.filter(x => x.type === '收入').reduce((sum, x) => sum + Number(x.total), 0);
    const expense = r.rows.filter(x => x.type === '开支' || x.type === '支出').reduce((sum, x) => sum + Number(x.total), 0);
    out.push({ label, income, expense });
  }
  res.json(out);
});

app.get('/api/analytics/sales-summary', authRequired, async (req, res) => {
  const { period='month', range='12', baseDate } = req.query;
  const n = Math.max(1, Math.min(365, parseInt(range, 10) || 12));
  let now = new Date();
  if (baseDate) {
    if (period === 'year' && /^\d{4}$/.test(baseDate)) {
      now = new Date(parseInt(baseDate), 11, 31);
    } else if (period === 'month' && /^\d{4}-\d{2}$/.test(baseDate)) {
      const parts = baseDate.split('-');
      now = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 15);
    }
  }
  const out = [];
  function fmtYMD(d) {
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`;
  }
  for (let i=n-1;i>=0;i--) {
    let label = '';
    let start = '', end = '';
    if (period === 'year') {
      const y = now.getFullYear() - i;
      label = String(y);
      start = `${y}-01-01`; end = `${y}-12-31`;
    } else if (period === 'day') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()-i);
      label = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      start = fmtYMD(d); end = fmtYMD(d);
    } else {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0');
      label = `${y}-${m}`;
      start = `${y}-${m}-01`;
      const d2 = new Date(d.getFullYear(), d.getMonth()+1, 0);
      end = fmtYMD(d2);
    }
    const r = await query(`
      select sum(total_amount)::numeric(12,2) as total
      from invoices
      where date >= $1 and date <= $2
    `, [start, end]);
    const amount = Number(r.rows[0]?.total || 0);
    out.push({ label, amount });
  }
  res.json(out);
});

// Products endpoints
app.post('/api/products/batch-stock', authRequired, async (req, res) => {
  const { names = [], ids = [] } = req.body;
  const validNames = names.filter(n => n);
  const validIds = ids.map(i => parseInt(i, 10)).filter(i => !isNaN(i));
  
  if (validNames.length === 0 && validIds.length === 0) return res.json([]);
  
  let sql = `
    select
      p.id,
      p.name,
      p.name_cn,
      p.stock,
      p.image,
      p.spec,
      p.description,
      p.tax_rate,
      p.price1,
      p.price2,
      p.price3,
      p.price4,
      p.sku,
      (
        select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc, id asc)
        from inventory_batches
        where product_id = p.id and quantity > 0
      ) as batches
    from products p
    where 1=0
  `;
  const params = [];
  
  if (validNames.length > 0) {
    const pNames = validNames.map((_, i) => '$' + (params.length + i + 1)).join(',');
    sql += ` or name in (${pNames})`;
    params.push(...validNames);
  }
  
  if (validIds.length > 0) {
    const pIds = validIds.map((_, i) => '$' + (params.length + i + 1)).join(',');
    sql += ` or id in (${pIds})`;
    params.push(...validIds);
  }
  
  const r = await query(sql, params);
  res.json(r.rows);
});

app.get('/api/products', authRequired, ensureAllow('sales_products','view'), async (req, res) => {
  const { q='', page='1', size='50' } = req.query;
  const p = [];
  let sql = `select *,
    (coalesce(dividend_enabled, false) or coalesce(jsonb_array_length(coalesce(dividend_users, '[]'::jsonb)), 0) > 0) as dividend_enabled
    from products`;
  if (q && q.trim()) {
    sql += ' where (name ilike $1 or name_cn ilike $1 or sku ilike $1 or barcode ilike $1)';
    p.push('%' + q.trim() + '%');
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 50));
  sql += ' order by length(sku) asc, sku asc';
  sql += ` limit ${pageSize} offset ${(pageNum-1)*pageSize}`;
  const r = await query(sql, p);
  const count = await query('select count(*)::int as c from products ' + (q.trim() ? 'where (name ilike $1 or name_cn ilike $1 or sku ilike $1 or barcode ilike $1)' : ''), q.trim() ? ['%'+q.trim()+'%'] : []);
  res.json({ list: r.rows, total: count.rows[0].c });
});

app.post('/api/products', authRequired, ensureAllow('sales_products','create'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const dividendUsers = normalizeNameList(x.dividend_users);
  const dividendEnabled = dividendUsers.length > 0;
  try {
    const r = await query(`
      insert into products(sku, barcode, name, name_cn, image, description, price1, price2, price3, price4, tax_rate, cost_price, dividend_enabled, dividend_users, spec, stock, remind_stock, notes, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id
    `, [x.sku||'', x.barcode||'', x.name||'', x.name_cn||'', x.image||'', x.description||'', 
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0), 
        Number(x.cost_price||0), dividendEnabled, JSON.stringify(dividendUsers), x.spec||'', Number(x.stock||0), Math.max(0, Number(x.remind_stock||0)), x.notes||'', now, req.user.name||'']);
    res.json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'duplicate_sku' });
    throw e;
  }
});
app.put('/api/products-remind-stock-all', authRequired, ensureAllow('sales_products','edit'), async (req, res) => {
  const remindStock = Math.max(0, Number(req.body?.remind_stock || 0));
  await query('update products set remind_stock=$1', [remindStock]);
  res.json({ ok: true, remind_stock: remindStock });
});

app.put('/api/products/:id', authRequired, ensureAllow('sales_products','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const dividendUsers = normalizeNameList(x.dividend_users);
  const dividendEnabled = dividendUsers.length > 0;
  try {
    const r = await query(`
      update products set sku=$1, barcode=$2, name=$3, name_cn=$4, image=$5, description=$6, 
      price1=$7, price2=$8, price3=$9, price4=$10, tax_rate=$11, cost_price=$12, dividend_enabled=$13, dividend_users=$14, spec=$15, stock=$16, remind_stock=$17, notes=$18
      where id=$19 returning id
    `, [x.sku||'', x.barcode||'', x.name||'', x.name_cn||'', x.image||'', x.description||'', 
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0), 
        Number(x.cost_price||0), dividendEnabled, JSON.stringify(dividendUsers), x.spec||'', Number(x.stock||0), Math.max(0, Number(x.remind_stock||0)), x.notes||'', id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'duplicate_sku' });
    throw e;
  }
});
app.put('/api/products/:id/remind-stock', authRequired, ensureAllow('sales_products','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const remindStock = Math.max(0, Number(req.body?.remind_stock || 0));
  const r = await query('update products set remind_stock=$1 where id=$2 returning id, remind_stock', [remindStock, id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, remind_stock: Number(r.rows[0].remind_stock || 0) });
});

app.delete('/api/products/:id', authRequired, ensureAllow('sales_products','delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  await query('delete from products where id=$1', [id]);
  res.json({ ok: true });
});

app.get('/api/sales-stats/dividend-users', authRequired, ensureAllow('sales_stats','view'), async (req, res) => {
  const currentRole = req.user?.role || '';
  const currentUser = String(req.user?.name || '').trim();
  const currentPerms = currentRole === '超级管理员' ? {} : await getRolePerms(currentRole);
  const params = [];
  const conds = [`coalesce(jsonb_array_length(coalesce(dividend_users, '[]'::jsonb)), 0) > 0`];
  if (currentRole !== '超级管理员' && currentPerms?.sales_stats?.assigned_only && currentUser) {
    params.push(currentUser);
    conds.push(`coalesce(dividend_users, '[]'::jsonb) ? $${params.length}`);
  }
  const r = await query(`
    select distinct trim(u.name) as name
    from products p
    cross join lateral jsonb_array_elements_text(coalesce(p.dividend_users, '[]'::jsonb)) as u(name)
    where ${conds.join(' and ')}
    order by trim(u.name) asc
  `, params);
  res.json({ list: r.rows.map(row => String(row.name || '').trim()).filter(Boolean) });
});

app.get('/api/sales-stats/products', authRequired, ensureAllow('sales_stats','view'), async (req, res) => {
  const { start = '', end = '', q = '', dividend_user = '' } = req.query;
  const currentRole = req.user?.role || '';
  const currentUser = String(req.user?.name || '').trim();
  const currentPerms = currentRole === '超级管理员' ? {} : await getRolePerms(currentRole);
  const params = [];
  const invoiceConds = [];
  if (String(start || '').trim()) {
    params.push(String(start).trim());
    invoiceConds.push(`i.date >= $${params.length}`);
  }
  if (String(end || '').trim()) {
    params.push(String(end).trim());
    invoiceConds.push(`i.date <= $${params.length}`);
  }
  const rowConds = ['qty > 0'];
  if (String(q || '').trim()) {
    params.push(`%${String(q).trim()}%`);
    const qp = `$${params.length}`;
    rowConds.push(`(
      coalesce(sku, '') ilike ${qp}
      or coalesce(product_name, '') ilike ${qp}
      or coalesce(product_name_cn, '') ilike ${qp}
      or coalesce(spec, '') ilike ${qp}
    )`);
  }
  if (String(dividend_user || '').trim()) {
    params.push(String(dividend_user).trim());
    rowConds.push(`coalesce(dividend_users, '[]'::jsonb) ? $${params.length}`);
  }
  if (currentRole !== '超级管理员' && currentPerms?.sales_stats?.assigned_only && currentUser) {
    params.push(currentUser);
    rowConds.push(`coalesce(dividend_users, '[]'::jsonb) ? $${params.length}`);
  }
  const sql = `
    with expanded as (
      select
        i.id as invoice_id,
        i.invoice_no,
        i.date as invoice_date,
        item,
        nullif(trim(item->>'productId'), '') as pid_text,
        trim(coalesce(item->>'sku', '')) as sku_text,
        trim(coalesce(item->>'name', '')) as name_text
      from invoices i
      cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) item
      ${invoiceConds.length ? 'where ' + invoiceConds.join(' and ') : ''}
    ),
    rows as (
      select
        coalesce(prod.id, case when e.pid_text ~ '^[0-9]+$' then e.pid_text::int else null end) as product_id,
        coalesce(prod.sku, e.sku_text) as sku,
        coalesce(prod.name, e.name_text) as product_name,
        coalesce(prod.name_cn, trim(coalesce(e.item->>'cn_name', e.item->>'name_cn', ''))) as product_name_cn,
        coalesce(prod.spec, '') as spec,
        coalesce(nullif(e.item->>'cost_price', '')::numeric, 0) as item_cost_price,
        (coalesce(prod.dividend_enabled, false) or coalesce(jsonb_array_length(coalesce(prod.dividend_users, '[]'::jsonb)), 0) > 0) as dividend_enabled,
        coalesce(prod.dividend_users, '[]'::jsonb) as dividend_users,
        coalesce(nullif(e.item->>'qty', '')::numeric, 0) as qty,
        coalesce(nullif(e.item->>'price', '')::numeric, 0) as unit_price,
        case
          when coalesce(nullif(e.item->>'tax_rate', '')::numeric, 0) >= 1 then coalesce(nullif(e.item->>'tax_rate', '')::numeric, 0) / 100.0
          else coalesce(nullif(e.item->>'tax_rate', '')::numeric, 0)
        end as tax_rate,
        e.invoice_id
      from expanded e
      left join lateral (
        select p.id, p.sku, p.name, p.name_cn, p.spec, p.cost_price,
          (coalesce(p.dividend_enabled, false) or coalesce(jsonb_array_length(coalesce(p.dividend_users, '[]'::jsonb)), 0) > 0) as dividend_enabled,
          p.dividend_users
        from products p
        where
          (e.pid_text ~ '^[0-9]+$' and p.id = e.pid_text::int)
          or (not (e.pid_text ~ '^[0-9]+$') and e.sku_text <> '' and p.sku = e.sku_text)
          or (not (e.pid_text ~ '^[0-9]+$') and e.sku_text = '' and e.name_text <> '' and p.name = e.name_text)
        order by
          case
            when e.pid_text ~ '^[0-9]+$' and p.id = e.pid_text::int then 0
            when e.sku_text <> '' and p.sku = e.sku_text then 1
            else 2
          end
        limit 1
      ) prod on true
    ),
    agg as (
      select
        product_id,
        sku,
        product_name as name,
        product_name_cn as name_cn,
        spec,
        dividend_enabled,
        count(distinct invoice_id)::int as invoice_count,
        coalesce(sum(qty), 0) as sales_qty,
        coalesce(sum(qty * unit_price), 0) as sales_amount,
        coalesce(sum(qty * unit_price * tax_rate), 0) as tax_amount,
        coalesce(sum(qty * unit_price * (1 + tax_rate)), 0) as gross_amount,
        case
          when coalesce(sum(qty), 0) = 0 then 0
          else coalesce(sum(qty * item_cost_price), 0) / nullif(sum(qty), 0)
        end as cost_price,
        coalesce(sum(qty * item_cost_price), 0) as cost_amount,
        coalesce(sum(qty * (unit_price - item_cost_price)), 0) as profit_amount
      from rows
      where ${rowConds.join(' and ')}
      group by product_id, sku, product_name, product_name_cn, spec, dividend_enabled
    )
    select
      coalesce(json_agg(agg order by dividend_enabled desc, sales_qty desc, name asc), '[]'::json) as list,
      coalesce(sum(sales_qty), 0) as total_qty,
      coalesce(sum(sales_amount), 0) as total_sales_amount,
      coalesce(sum(tax_amount), 0) as total_tax_amount,
      coalesce(sum(gross_amount), 0) as total_gross_amount,
      coalesce(sum(cost_amount), 0) as total_cost_amount,
      coalesce(sum(profit_amount), 0) as total_profit_amount,
      count(*)::int as total
    from agg
  `;
  const r = await query(sql, params);
  const row = r.rows[0] || {};
  res.json({
    list: row.list || [],
    total: Number(row.total || 0),
    summary: {
      qty: Number(row.total_qty || 0),
      sales_amount: Number(row.total_sales_amount || 0),
      tax_amount: Number(row.total_tax_amount || 0),
      gross_amount: Number(row.total_gross_amount || 0),
      cost_amount: Number(row.total_cost_amount || 0),
      profit_amount: Number(row.total_profit_amount || 0)
    }
  });
});

// Invoices endpoints
app.get('/api/invoices', authRequired, ensureAllow('sales_invoice','view'), async (req, res) => {
  const { q='', page='1', size='100' } = req.query;
  const p = [];
  let sql = `
    select i.*, 
    (select coalesce(sum(paid),0) from payables where doc=i.invoice_no and type='应收账款') as paid_amount,
    (select c.company from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as company_name,
    (select c.code from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as customer_code,
    (select c.address from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as customer_address,
    (select c.zip from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as customer_zip,
    (select c.city from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as customer_city,
    (select c.country from contacts c where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer) order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc limit 1) as customer_country
    from invoices i
  `;
  const conds = [];
  if (q && q.trim()) {
    conds.push(`(
      i.invoice_no ilike $${p.length+1}
      or i.customer ilike $${p.length+1}
      or coalesce((
        select c.company
        from contacts c
        where trim(c.name)=trim(i.customer) or trim(c.company)=trim(i.customer)
        order by case when trim(c.name)=trim(i.customer) then 0 else 1 end, c.id desc
        limit 1
      ), '') ilike $${p.length+1}
      or cast(coalesce(i.total_amount, 0) as text) ilike $${p.length+1}
    )`);
    p.push('%' + q.trim() + '%');
  }
  if (conds.length > 0) sql += ' where ' + conds.join(' and ');
  
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 100));
  
  let countSql = 'select count(*)::int as c from invoices i';
  if (conds.length > 0) countSql += ' where ' + conds.join(' and ');
  const rCount = await query(countSql, p);
  
  sql += ' order by i.id desc';
  sql += ` limit ${pageSize} offset ${(pageNum-1)*pageSize}`;
  const r = await query(sql, p);
  res.json({ list: r.rows, total: rCount.rows[0].c });
});

app.get('/api/invoices/next-no', authRequired, ensureAllow('sales_order','view'), async (req, res) => {
  const rMax = await query("select invoice_no from invoices where invoice_no like 'Factura- %' order by invoice_no desc limit 1");
  let nextSeq = 231;
  if (rMax.rows[0]) {
    const lastNo = rMax.rows[0].invoice_no;
    const match = lastNo.match(/Factura- (\d{6})-\d{2}/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }
  const year2 = String(new Date().getFullYear()).slice(-2);
  const nextNo = `Factura- ${String(nextSeq).padStart(6, '0')}-${year2}`;
  
  // Since frontend expects just the number part (or adds 'Factura：' prefix itself)
  // Wait, let's check frontend: soInvoiceNo.textContent = `Factura：${data.nextNo}`;
  // If we send `Factura- 000231-26`, it will show `Factura：Factura- 000231-26`.
  // Wait! We should check how it's used.
  // We can just send the full string and modify frontend.
  res.json({ nextNo });
});

app.post('/api/invoices', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  // Use provided invoice_no or generate new one
  let invoiceNo = x.invoice_no;
  if (!invoiceNo) {
    const rMax = await query("select invoice_no from invoices where invoice_no like 'Factura- %' order by invoice_no desc limit 1");
    let nextSeq = 231; // Default starting sequence as requested
    if (rMax.rows[0]) {
      const lastNo = rMax.rows[0].invoice_no;
      const match = lastNo.match(/Factura- (\d{6})-\d{2}/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }
    const year2 = String(new Date().getFullYear()).slice(-2);
    invoiceNo = `Factura- ${String(nextSeq).padStart(6, '0')}-${year2}`;
  }

  const items = await attachInvoiceItemSnapshots(Array.isArray(x.items) ? x.items : []);
  // Recalculate total amount from items to ensure accuracy (including taxes)
  // Logic: each item has price, qty, tax_rate (0.1, 0.21, etc). Default 0.
  // total = sum(price * qty * (1 + tax_rate))
  const total = items.reduce((sum, item) => {
    const qty = Number(item.qty||0);
    const price = Number(item.price||0);
    // Use item.tax_rate if available (0.1, 0.21 etc).
    // If undefined/null/empty, default to 0.10 (10%) based on user requirement
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate) || item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '') {
      taxRate = 0.10;
    }
    if (taxRate >= 1) taxRate = taxRate / 100;
    const rowVal = qty * price;
    const rowTax = rowVal * taxRate;
    return sum + rowVal + rowTax;
  }, 0);

  // Update Stock and Split Items
  const finalItems = await deductAndSplitStock(items);

  const r = await query(`
    insert into invoices(invoice_no, customer, date, items, total_amount, notes, sales, created_at, created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, invoice_no
  `, [invoiceNo, x.customer||'', x.date||'', JSON.stringify(finalItems), total, x.notes||'', x.sales||'', now, req.user.name||'']);

  // Create payable (receivable)
  const trustDays = parseInt(x.trust_days, 10) || 30;
  await query(`
    insert into payables(type, partner, doc, amount, paid, settled, trust_days, notes, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
    values($1,$2,$3,$4,0,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sales_order')
  `, ['应收账款', x.customer||'', invoiceNo, total, trustDays, x.notes||'', invoiceNo, x.date||'', total, x.sales||'', x.date||'', now, now]);

  res.json({ id: r.rows[0].id, invoice_no: r.rows[0].invoice_no });
});

app.delete('/api/invoices/:id', authRequired, ensureAllow('sales_invoice','delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  
  // Get invoice details to restore stock
  const r = await query('select * from invoices where id=$1', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  const inv = r.rows[0];
  
  // Check if paid
  const p = await query("select sum(paid) as paid from payables where doc=$1 and type='应收账款'", [inv.invoice_no]);
  const paid = Number(p.rows[0]?.paid || 0);
  if (paid > 0) return res.status(400).json({ error: 'cannot_delete_paid_invoice' });

  // Restore stock for full invoice items.
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  for (const item of items) {
    await restoreInventoryForInvoiceItem(item);
  }

  // Delete Payable
  await query("delete from payables where doc=$1 and type='应收账款'", [inv.invoice_no]);
  
  // Delete Invoice
  await query('delete from invoices where id=$1', [id]);
  
  res.json({ ok: true });
});

app.put('/api/invoices/:id/print-shipping', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('update invoices set shipping_printed=true where id=$1 returning id', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

app.put('/api/invoices/:id', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  
  // Check if invoice exists and payment status
  const check = await query(`
    select i.invoice_no, 
    (select coalesce(sum(paid),0) from payables where doc=i.invoice_no and type='应收账款') as paid_amount,
    i.total_amount, i.items
    from invoices i where i.id=$1
  `, [id]);
  
  if (!check.rows[0]) return res.status(404).json({ error: 'not_found' });
  const inv = check.rows[0];
  const paid = Number(inv.paid_amount || 0);
  const oldTotal = Number(inv.total_amount || 0);
  
  // If fully paid, disallow edit (double check backend side)
  if (moneyGte(paid, oldTotal) && oldTotal > 0) {
    return res.status(400).json({ error: 'cannot_edit_paid_invoice' });
  }

  const oldItems = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  const newItems = await attachInvoiceItemSnapshots(Array.isArray(x.items) ? x.items : [], oldItems);

  // Build per-item deltas (old - new): positive means return to stock; negative means extra deduction needed.
  const deltas = [];
  const usedNew = new Array(newItems.length).fill(false);
  for (const oldItem of oldItems) {
    const oldQty = Number(oldItem?.qty || 0);
    if (oldQty <= 0) continue;
    let matchIdx = -1;
    for (let i = 0; i < newItems.length; i++) {
      if (usedNew[i]) continue;
      if (sameInvoiceItemIdentity(oldItem, newItems[i])) { matchIdx = i; break; }
    }
    const newQty = matchIdx >= 0 ? Number(newItems[matchIdx]?.qty || 0) : 0;
    if (matchIdx >= 0) usedNew[matchIdx] = true;
    const delta = oldQty - Math.max(0, newQty);
    if (delta !== 0) deltas.push({ base: oldItem, delta });
  }
  for (let i = 0; i < newItems.length; i++) {
    if (usedNew[i]) continue;
    const newQty = Number(newItems[i]?.qty || 0);
    if (newQty > 0) deltas.push({ base: newItems[i], delta: -newQty });
  }

  // Apply returns (only the delta amount), and only restore lote/batches if the old line had explicit lote.
  for (const d of deltas) {
    if (d.delta > 0) await restoreInventoryForInvoiceItem(d.base, d.delta);
  }

  // Apply extra deductions (only the delta amount).
  const extraItems = deltas
    .filter(d => d.delta < 0)
    .map(d => ({ ...d.base, qty: Math.abs(d.delta) }));
  await deductAndSplitStock(extraItems);

  // Persist the user-edited invoice lines as entered.
  // Stock changes are handled by the delta logic above; we do not rebuild the whole invoice from current inventory anymore.
  const finalItems = newItems
    .filter(item => Number(item?.qty || 0) > 0)
    .map(item => ({ ...item, deductions: [] }));

  // Recalculate total
  const total = roundMoneyValue(finalItems.reduce((sum, item) => {
    const qty = Number(item.qty||0);
    const price = Number(item.price||0);
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate) || item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '') {
      taxRate = 0.10;
    }
    if (taxRate >= 1) taxRate = taxRate / 100;
    const rowVal = qty * price;
    const rowTax = rowVal * taxRate;
    return sum + rowVal + rowTax;
  }, 0));

  // Update invoice
  await query(`
    update invoices set customer=$1, date=$2, items=$3, total_amount=$4, notes=$5, sales=$6
    where id=$7
  `, [x.customer||'', x.date||'', JSON.stringify(finalItems), total, x.notes||'', x.sales||'', id]);
  
  // Update payable (receivable)
  // Only update fields that should sync. 
  const invoiceNo = inv.invoice_no;
  const trustDays = parseInt(x.trust_days, 10) || 30;
  
  await query(`
    update payables set partner=$1, amount=$2, invoice_amount=$3, date=$4, invoice_date=$4, notes=$5, trust_days=$6, sales=$7
    where doc=$8 and type='应收账款'
  `, [x.customer||'', total, total, x.date||'', x.notes||'', trustDays, x.sales||'', invoiceNo]);

  res.json({ ok: true });
});

app.get('/api/company-info', authRequired, async (req, res) => {
  const r = await query('select * from company_info limit 1');
  res.json(r.rows[0] || {});
});

app.post('/api/company-info', authRequired, ensureAllow('company_info','edit'), async (req, res) => {
  const x = req.body || {};
  // Check if exists
  const r = await query('select id from company_info limit 1');
  if (r.rows.length > 0) {
    const id = r.rows[0].id;
    await query(`
      update company_info set name=$1, tax_id=$2, phone=$3, email=$4, street=$5, zip=$6, city=$7, country=$8, bank_name=$9, iban=$10, swift=$11
      where id=$12
    `, [x.name||'', x.tax_id||'', x.phone||'', x.email||'', x.street||'', x.zip||'', x.city||'', x.country||'', x.bank_name||'', x.iban||'', x.swift||'', id]);
  } else {
    await query(`
      insert into company_info(name, tax_id, phone, email, street, zip, city, country, bank_name, iban, swift)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [x.name||'', x.tax_id||'', x.phone||'', x.email||'', x.street||'', x.zip||'', x.city||'', x.country||'', x.bank_name||'', x.iban||'', x.swift||'']);
  }
  res.json({ ok: true });
});

app.get('/api/auto-tasks', authRequired, async (req, res) => {
  await ensureAutoTasksGenerated();
  const { role, name } = req.user;
  let sql = 'select * from auto_tasks';
  const params = [];
  if (role !== '超级管理员') {
    params.push(name, name);
    sql += ' where assigned_to=$1 or created_by=$2';
  }
  sql += ' order by created_at desc, id desc';
  const r = await query(sql, params);
  res.json(r.rows || []);
});
app.post('/api/auto-tasks', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const x = req.body || {};
  const title = String(x.title || '').trim();
  const description = String(x.description || '').trim();
  const assignedTo = String(x.assigned_to || '').trim();
  const intervalMonths = Math.max(1, parseInt(x.interval_months, 10) || 1);
  const timeLimit = Math.max(0, parseInt(x.time_limit, 10) || 0);
  const startAt = Math.max(0, parseInt(x.start_at, 10) || 0) || Date.now();
  const active = x.active !== false;
  if (!title || !assignedTo) return res.status(400).json({ error: 'bad_request' });
  const createdAt = Date.now();
  const nextGenerateAt = active ? startAt : null;
  const r = await query(
    `insert into auto_tasks(title, description, created_by, created_at, start_at, assigned_to, time_limit, interval_months, active, next_generate_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [title, description, req.user.name || '', createdAt, startAt, assignedTo, timeLimit, intervalMonths, active, nextGenerateAt]
  );
  if (active) await ensureAutoTasksGenerated();
  res.json({ id: r.rows[0].id });
});
app.put('/api/auto-tasks/:id', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const current = await query('select * from auto_tasks where id=$1', [id]);
  const row = current.rows[0];
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.created_by !== req.user.name && req.user.role !== '超级管理员') return res.status(403).json({ error: 'forbidden' });
  const title = String(x.title || '').trim();
  const description = String(x.description || '').trim();
  const assignedTo = String(x.assigned_to || '').trim();
  const intervalMonths = Math.max(1, parseInt(x.interval_months, 10) || 1);
  const timeLimit = Math.max(0, parseInt(x.time_limit, 10) || 0);
  const startAt = Math.max(0, parseInt(x.start_at, 10) || 0) || Number(row.start_at || row.created_at || Date.now());
  const active = x.active !== false;
  if (!title || !assignedTo) return res.status(400).json({ error: 'bad_request' });
  let nextGenerateAt = null;
  if (active) {
    if (Number(row.last_generated_at || 0) > 0) {
      nextGenerateAt = addMonthsTs(Number(row.last_generated_at), intervalMonths);
      while (nextGenerateAt <= Date.now()) nextGenerateAt = addMonthsTs(nextGenerateAt, intervalMonths);
    } else {
      nextGenerateAt = startAt;
    }
  }
  await query(
    `update auto_tasks
     set title=$1, description=$2, assigned_to=$3, time_limit=$4, interval_months=$5, active=$6, start_at=$7, next_generate_at=$8
     where id=$9`,
    [title, description, assignedTo, timeLimit, intervalMonths, active, startAt, nextGenerateAt, id]
  );
  if (active) await ensureAutoTasksGenerated();
  res.json({ ok: true });
});
app.get('/api/tasks', authRequired, async (req, res) => {
  await ensureAutoTasksGenerated();
  const { role, name } = req.user;
  const { status, page = '1', size = '100' } = req.query;
  const limit = Math.max(1, parseInt(size));
  const offset = (Math.max(1, parseInt(page)) - 1) * limit;

  // Base condition for role access
  let baseWhere = [];
  let baseParams = [];
  if (role !== '超级管理员') {
    baseParams.push(name);
    baseWhere.push(`assigned_to=$${baseParams.length}`);
  }

  // 1. Get Stats (Counts for badges) - Apply only role filter
  let statsSql = `select 
    count(case when status='pending' or status is null then 1 end)::int as new_count,
    count(case when status='waiting_audit' then 1 end)::int as review_count
    from tasks`;
  if (baseWhere.length) statsSql += ' where ' + baseWhere.join(' and ');
  const statsRes = await query(statsSql, baseParams);

  // 2. Get List - Apply role filter AND status filter
  let listWhere = [...baseWhere];
  let listParams = [...baseParams];
  
  if (status === 'new') {
    listWhere.push(`(status='pending' or status is null)`);
  } else if (status === 'review') {
    listParams.push('waiting_audit');
    listWhere.push(`status=$${listParams.length}`);
  } else if (status === 'completed') {
    listParams.push('completed');
    listWhere.push(`status=$${listParams.length}`);
  }

  let sql = 'select * from tasks';
  let countSql = 'select count(*)::int as c from tasks';
  
  if (listWhere.length) {
    const w = ' where ' + listWhere.join(' and ');
    sql += w;
    countSql += w;
  }
  
  sql += ' order by created_at desc';
  sql += ` limit ${limit} offset ${offset}`;
  
  const r = await query(sql, listParams);
  const c = await query(countSql, listParams);
  
  res.json({
    list: r.rows,
    total: c.rows[0].c,
    stats: statsRes.rows[0]
  });
});
app.post('/api/tasks', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const x = req.body || {};
  const timeLimit = parseInt(x.timeLimit, 10) || 0;
  const r = await query(`insert into tasks(title,description,created_by,created_at,assigned_to,time_limit) values($1,$2,$3,$4,$5,$6) returning id`,
    [x.title||'', x.desc||'', req.user.name, Date.now(), x.assign||'', timeLimit]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/tasks/:id', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const timeLimit = parseInt(x.time_limit, 10) || 0;
  // Ensure only creator or admin can edit
  const t = await query('select created_by from tasks where id=$1', [id]);
  if (!t.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (t.rows[0].created_by !== req.user.name && req.user.role !== '超级管理员') return res.status(403).json({ error: 'forbidden' });
  
  await query('update tasks set title=$1, description=$2, assigned_to=$3, time_limit=$4 where id=$5',
    [x.title||'', x.description||'', x.assigned_to||'', timeLimit, id]);
  res.json({ ok: true });
});
app.put('/api/tasks/:id/complete', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { image, desc } = req.body;
  await query('update tasks set status=$1, completed_by=$2, completed_at=$3, completion_image=$4, completion_desc=$5 where id=$6', ['waiting_audit', req.user.name, Date.now(), image||'', desc||'', id]);
  res.json({ ok: true });
});
app.put('/api/tasks/:id/audit', authRequired, ensureAllow('tasks','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.role !== '超级管理员') return res.status(403).json({ error: 'forbidden' });
  await query('update tasks set status=$1 where id=$2', ['completed', id]);
  res.json({ ok: true });
});

// Daily Orders
app.get('/api/daily-orders/stats', authRequired, async (req, res) => {
  const r = await query(`
    select status, count(*)::int as c from daily_orders group by status
  `);
  const stats = { new: 0, allocated: 0, shipped: 0 };
  r.rows.forEach(x => {
    if (x.status === 'new') stats.new = x.c;
    else if (x.status === 'allocated') stats.allocated = x.c;
    else if (x.status === 'shipped') stats.shipped = x.c;
  });
  res.json(stats);
});
app.get('/api/daily-orders', authRequired, async (req, res) => {
  const { status } = req.query;
  let sql = `
    select d.*, i.created_at as shipped_at, i.invoice_no 
    from daily_orders d 
    left join invoices i on d.invoice_id = i.id
  `;
  const p = [];
  sql += ' where coalesce(d.is_manual_logistics,false)=false';
  if (status) { sql += ' and d.status=$1'; p.push(status); }
  if (String(status || '').trim() === 'shipped') {
    sql += ' order by coalesce(d.logistics_updated_at, i.created_at, 0) desc, d.id desc';
  } else {
    sql += ' order by d.created_at desc';
  }
  const r = await query(sql, p);
  res.json(r.rows);
});
app.post('/api/daily-orders', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const x = req.body || {};
  const items = Array.isArray(x.items) ? x.items : [];
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  
  const r = await query(`insert into daily_orders(customer,sales,items,created_by,created_at,date,notes) values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [x.customer||'', x.sales||'', JSON.stringify(items), req.user.name, Date.now(), dateStr, x.notes||'']);
  res.json({ id: r.rows[0].id });
});
app.put('/api/daily-orders/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const items = Array.isArray(x.items) ? x.items : [];
  
  const ord = await query('select status, items from daily_orders where id=$1', [id]);
  if (!ord.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (ord.rows[0].status === 'shipped') return res.status(400).json({ error: 'cannot_edit_shipped' });
  
  // If status is allocated, we need to preserve allocated_qty if possible, or we can just overwrite items.
  // The user says "可以修改订单中的商品或数量", if they modify an allocated order, does it reset allocated_qty?
  // Let's merge the old allocated_qty into the new items by product name if status is allocated.
  let newItems = items;
  if (ord.rows[0].status === 'allocated') {
      const oldItems = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
      const oldAllocatedMap = {};
      oldItems.forEach(i => oldAllocatedMap[i.name] = i.allocated_qty || 0);
      newItems = items.map(i => ({ ...i, allocated_qty: oldAllocatedMap[i.name] || 0 }));
  }

  await query('update daily_orders set customer=$1, notes=$2, items=$3 where id=$4', 
    [x.customer||'', x.notes||'', JSON.stringify(newItems), id]);
  res.json({ ok: true });
});
app.delete('/api/daily-orders/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Only allow deleting if not shipped or cancelled
  const ord = await query('select status from daily_orders where id=$1', [id]);
  if (!ord.rows[0] || ord.rows[0].status === 'shipped' || ord.rows[0].status === 'cancelled') {
    return res.status(400).json({ error: 'cannot_cancel_shipped_or_cancelled' });
  }
  await query("update daily_orders set status='cancelled' where id=$1", [id]);
  res.json({ ok: true });
});

app.put('/api/daily-orders/:id/allocate', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { items } = req.body; // updated items with allocated_qty
  
  // 1. Simulate FIFO split
  const finalItems = await simulateSplitStock(items);
  
  // 2. Update order
  await query('update daily_orders set items=$1, status=$2, allocated_by=$3 where id=$4', [JSON.stringify(finalItems), 'allocated', req.user.name, id]);
  
  res.json({ ok: true });
});
app.put('/api/daily-orders/:id/ship', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!from) return res.status(400).json({ error: 'logistics_from_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  if (!palletCount) return res.status(400).json({ error: 'logistics_pallet_count_required' });
  if (!boxCount) return res.status(400).json({ error: 'logistics_box_count_required' });
  if (!totalWeight) return res.status(400).json({ error: 'logistics_total_weight_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  await query(
    'update daily_orders set status=$1, shipped_by=coalesce(shipped_by,$2), logistics_company_id=$3, logistics_status=$4, logistics_updated_at=$5, logistics_from=$6, logistics_to=$7, logistics_ship_date=$8, logistics_pallet_count=$9, logistics_box_count=$10, logistics_total_weight=$11 where id=$12',
    ['shipped', req.user.name, companyId, 'ongoing', Date.now(), from, to, shipDate, palletCount, boxCount, totalWeight, id]
  );
  
  // Auto Create Invoice & Deduct Stock
  const ord = (await query('select * from daily_orders where id=$1', [id])).rows[0];
  if (!ord.invoice_id) {
    const items = typeof ord.items === 'string' ? JSON.parse(ord.items) : (ord.items || []);
    
    // Check if customer requires IVA
    const custRes = await query('select is_iva from contacts where name=$1 and owner=$2 limit 1', [ord.customer, '客户']);
    const isIva = custRes.rows[0] ? custRes.rows[0].is_iva : true;
    
    // Generate invoice logic
    const rMax = await query("select invoice_no from invoices where invoice_no like 'Factura- %' order by invoice_no desc limit 1");
    let nextSeq = 231; // Default starting sequence as requested
    if (rMax.rows[0]) {
      const lastNo = rMax.rows[0].invoice_no;
      const match = lastNo.match(/Factura- (\d{6})-\d{2}/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }
    const year2 = String(new Date().getFullYear()).slice(-2);
    const invoiceNo = `Factura- ${String(nextSeq).padStart(6, '0')}-${year2}`;
    
    // Use allocated_qty for invoice items
    const invoiceItems = await attachInvoiceItemSnapshots(items.map(item => {
      const shipQty = Number(item.allocated_qty !== undefined ? item.allocated_qty : (item.qty || 0));
      let taxRate = Number(item.tax_rate);
      if (isNaN(taxRate)) taxRate = 0.10;
      if (taxRate >= 1) taxRate = taxRate / 100;
      if (!isIva) taxRate = 0;
      return { ...item, qty: shipQty, original_qty: item.qty, tax_rate: taxRate };
    }));
    
    // Calculate total
    const total = roundMoneyValue(invoiceItems.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      const taxRate = Number(item.tax_rate) || 0;
      return sum + (qty * price * (1 + taxRate));
    }, 0));

    const now = Date.now();
    const invoiceDate = new Date().toISOString().slice(0, 10);

    // Deduct Stock and Split Items
    const finalItems = await deductAndSplitStock(invoiceItems);

    // Insert Invoice
    const inv = await query(`
      insert into invoices(invoice_no, customer, date, items, total_amount, sales, created_at, created_by, notes)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id
    `, [invoiceNo, ord.customer, invoiceDate, JSON.stringify(finalItems), total, ord.sales, now, req.user.name || '', ord.notes||'']);
    
    // Create Payable
    await query(`
      insert into payables(type, partner, doc, amount, paid, settled, trust_days, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
      values($1,$2,$3,$4,0,false,30,$5,$6,$7,$8,$9,$10,$11,'sales_order')
    `, ['应收账款', ord.customer, invoiceNo, total, invoiceNo, invoiceDate, total, ord.sales, invoiceDate, now, now]);
    
    await query('update daily_orders set invoice_id=$1 where id=$2', [inv.rows[0].id, id]);
  }

  res.json({ ok: true });
});

app.get('/api/logistics/companies', authRequired, async (req, res) => {
  const r = await query('select id, name, phone, contact, enabled, created_at, created_by from logistics_companies order by enabled desc, id asc');
  res.json(r.rows);
});
app.post('/api/logistics/companies', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const x = req.body || {};
  const name = String(x.name || '').trim();
  const phone = String(x.phone || '').trim();
  const contact = String(x.contact || '').trim();
  if (!name) return res.status(400).json({ error: 'bad_request' });
  const now = Date.now();
  const r = await query(
    'insert into logistics_companies(name, phone, contact, enabled, created_at, created_by) values($1,$2,$3,true,$4,$5) returning id',
    [name, phone, contact, now, req.user?.name || '']
  );
  res.json({ id: r.rows[0].id });
});
app.post('/api/logistics/records', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!from) return res.status(400).json({ error: 'logistics_from_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  if (!palletCount) return res.status(400).json({ error: 'logistics_pallet_count_required' });
  if (!boxCount) return res.status(400).json({ error: 'logistics_box_count_required' });
  if (!totalWeight) return res.status(400).json({ error: 'logistics_total_weight_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  const now = Date.now();
  const r = await query(
    `insert into daily_orders(
      customer, sales, items, status, created_by, created_at, date, notes, shipped_by,
      logistics_company_id, logistics_status, logistics_updated_at, logistics_from, logistics_to,
      logistics_ship_date, logistics_pallet_count, logistics_box_count, logistics_total_weight,
      is_manual_logistics
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [to, '', '[]', 'shipped', req.user?.name || '', now, shipDate, '', req.user?.name || '', companyId, 'ongoing', now, from, to, shipDate, palletCount, boxCount, totalWeight, true]
  );
  res.json({ ok: true, id: r.rows[0].id });
});
app.put('/api/logistics/companies/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  if ((req.user?.role || '') !== '超级管理员') return res.status(403).json({ error:'forbidden' });
  const id = parseInt(req.params.id, 10);
  const enabled = !!(req.body && req.body.enabled);
  await query('update logistics_companies set enabled=$1 where id=$2', [enabled, id]);
  res.json({ ok: true });
});
app.get('/api/logistics/records', authRequired, async (req, res) => {
  const statusRaw = String(req.query.status || 'ongoing').trim();
  const status = (statusRaw === 'completed' || statusRaw === 'reviewed') ? statusRaw : 'ongoing';
  const r = await query(
    `
    select 
      d.id,
      d.customer,
      d.date,
      d.notes,
      d.created_at,
      d.logistics_status,
      d.logistics_updated_at,
      d.shipped_by,
      d.logistics_company_id,
      d.logistics_from,
      d.logistics_to,
      d.logistics_ship_date,
      d.logistics_pallet_count,
      d.logistics_box_count,
      d.logistics_total_weight,
      d.logistics_arrival_date,
      d.logistics_completed_by,
      d.logistics_reviewed_by,
      c.name as logistics_company,
      c.phone as logistics_phone,
      c.contact as logistics_contact,
      i.invoice_no,
      i.created_at as shipped_at
    from daily_orders d
    left join invoices i on d.invoice_id = i.id
    left join logistics_companies c on d.logistics_company_id = c.id
    where d.status='shipped' and coalesce(d.logistics_status,'')=$1
    order by coalesce(d.logistics_updated_at, 0) desc, coalesce(i.created_at, 0) desc, d.id desc
    `,
    [status]
  );
  res.json(r.rows);
});

app.put('/api/logistics/records/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  if (!id) return res.status(400).json({ error: 'bad_request' });
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!from) return res.status(400).json({ error: 'logistics_from_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  if (!palletCount) return res.status(400).json({ error: 'logistics_pallet_count_required' });
  if (!boxCount) return res.status(400).json({ error: 'logistics_box_count_required' });
  if (!totalWeight) return res.status(400).json({ error: 'logistics_total_weight_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  const r = await query(
    `update daily_orders
     set logistics_company_id=$1, logistics_updated_at=$2, logistics_from=$3, logistics_to=$4, logistics_ship_date=$5,
         logistics_pallet_count=$6, logistics_box_count=$7, logistics_total_weight=$8
     where id=$9 and status='shipped' and coalesce(logistics_status,'')='ongoing'`,
    [companyId, Date.now(), from, to, shipDate, palletCount, boxCount, totalWeight, id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

app.put('/api/logistics/records/:id/complete', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const arrivalDate = String(x.arrival_date || '').trim();
  if (!id) return res.status(400).json({ error: 'bad_request' });
  if (!arrivalDate) return res.status(400).json({ error: 'arrival_date_required' });
  const r = await query(
    `update daily_orders
     set logistics_status=$1, logistics_updated_at=$2, logistics_arrival_date=$3, logistics_completed_by=$4
     where id=$5 and status='shipped'`,
    ['completed', Date.now(), arrivalDate, req.user?.name || '', id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

app.put('/api/logistics/records/review', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(x => parseInt(x, 10)).filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'bad_request' });
  await query(
    `update daily_orders
     set logistics_status=$1, logistics_updated_at=$2, logistics_reviewed_by=$3
     where id = any($4::int[]) and status='shipped' and coalesce(logistics_status,'')='completed'`,
    ['reviewed', Date.now(), req.user?.name || '', ids]
  );
  res.json({ ok: true });
});

app.get('/api/event-records', authRequired, ensureAllow('event_records','view'), async (req, res) => {
  const status = String(req.query.status || 'ongoing').trim() === 'completed' ? 'completed' : 'ongoing';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.max(1, Math.min(200, parseInt(req.query.size, 10) || 50));
  const q = String(req.query.q || '').trim();
  const params = [status];
  let where = ' where status=$1';
  if (q) {
    params.push(`%${q}%`);
    where += ` and (coalesce(name,'') ilike $${params.length} or coalesce(created_by,'') ilike $${params.length})`;
  }
  const totalRes = await query(`select count(*)::int as count from event_records${where}`, params);
  params.push(size, (page - 1) * size);
  const listRes = await query(
    `select * from event_records${where}
     order by coalesce(record_date,'' ) desc, created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  res.json({ list: listRes.rows, total: Number(totalRes.rows[0]?.count || 0) });
});
app.post('/api/event-records', authRequired, ensureAllow('event_records','edit'), async (req, res) => {
  const x = req.body || {};
  const r = await query(
    `insert into event_records(name, record_date, due_date, notes, status, created_by, created_at)
     values($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      String(x.name || '').trim(),
      String(x.record_date || '').trim(),
      String(x.due_date || '').trim(),
      String(x.notes || '').trim(),
      String(x.status || 'ongoing').trim() === 'completed' ? 'completed' : 'ongoing',
      req.user.name,
      Date.now()
    ]
  );
  res.json({ id: r.rows[0].id });
});
app.put('/api/event-records/:id', authRequired, ensureAllow('event_records','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const status = String(x.status || 'ongoing').trim() === 'completed' ? 'completed' : 'ongoing';
  await query(
    `update event_records
     set name=$1, record_date=$2, due_date=$3, notes=$4, status=$5, completed_at=$6, confirmed_by=$7
     where id=$8`,
    [
      String(x.name || '').trim(),
      String(x.record_date || '').trim(),
      String(x.due_date || '').trim(),
      String(x.notes || '').trim(),
      status,
      status === 'completed' ? Date.now() : null,
      status === 'completed' ? (req.user?.name || '') : '',
      id
    ]
  );
  res.json({ ok: true });
});
app.get('/api/knowledge-base', authRequired, ensureAllow('knowledge_base','view'), async (req, res) => {
  const category = String(req.query.category || 'internal').trim() === 'surrounding' ? 'surrounding' : 'internal';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.max(1, Math.min(200, parseInt(req.query.size, 10) || 50));
  const q = String(req.query.q || '').trim();
  const params = [category];
  let where = ' where category=$1';
  if (q) {
    params.push(`%${q}%`);
    where += ` and (coalesce(title,'') ilike $${params.length} or coalesce(content,'') ilike $${params.length})`;
  }
  const totalRes = await query(`select count(*)::int as count from knowledge_base_entries${where}`, params);
  params.push(size, (page - 1) * size);
  const listRes = await query(
    `select * from knowledge_base_entries${where}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  res.json({ list: listRes.rows, total: Number(totalRes.rows[0]?.count || 0) });
});
app.post('/api/knowledge-base', authRequired, ensureAllow('knowledge_base','edit'), async (req, res) => {
  const x = req.body || {};
  const r = await query(
    `insert into knowledge_base_entries(title, content, category, created_by, created_at)
     values($1,$2,$3,$4,$5) returning id`,
    [
      String(x.title || '').trim(),
      String(x.content || '').trim(),
      String(x.category || 'internal').trim() === 'surrounding' ? 'surrounding' : 'internal',
      req.user.name,
      Date.now()
    ]
  );
  res.json({ id: r.rows[0].id });
});
app.put('/api/knowledge-base/:id', authRequired, ensureAllow('knowledge_base','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  await query(
    `update knowledge_base_entries set title=$1, content=$2, category=$3 where id=$4`,
    [
      String(x.title || '').trim(),
      String(x.content || '').trim(),
      String(x.category || 'internal').trim() === 'surrounding' ? 'surrounding' : 'internal',
      id
    ]
  );
  res.json({ ok: true });
});
app.get('/api/production-entries', authRequired, ensureAllow('production_review','view'), async (req, res) => {
  const status = String(req.query.status || 'pending').trim();
  const allowedStatus = ['pending', 'approved', 'rejected'];
  const finalStatus = allowedStatus.includes(status) ? status : 'pending';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size = Math.max(1, Math.min(200, parseInt(req.query.size, 10) || 50));
  const q = String(req.query.q || '').trim();
  const params = [finalStatus];
  let where = ' where status=$1';
  if (q) {
    params.push(`%${q}%`);
    where += ` and (
      coalesce(product_name,'') ilike $${params.length}
      or coalesce(product_name_cn,'') ilike $${params.length}
      or coalesce(lote,'') ilike $${params.length}
    )`;
  }
  const totalRes = await query(`select count(*)::int as count from production_entries${where}`, params);
  params.push(size, (page - 1) * size);
  const listRes = await query(
    `select * from production_entries${where}
     order by created_at desc, id desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  res.json({ list: listRes.rows, total: Number(totalRes.rows[0]?.count || 0) });
});
app.put('/api/production-entries/:id/review', authRequired, ensureAllow('production_review','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const action = String(req.body?.action || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const entryRes = await query('select * from production_entries where id=$1', [id]);
  const entry = entryRes.rows[0];
  if (!entry) return res.status(404).json({ error: 'not_found' });
  if (entry.status !== 'pending') return res.status(400).json({ error: 'already_reviewed' });
  if (action === 'approve') {
    await addFinishedInventoryItems([
      {
        productId: Number(entry.product_id || 0),
        qty: Number(entry.box_count || 0),
        expiry: String(entry.expiration_date || '').trim(),
        lote: String(entry.lote || '').trim()
      }
    ], req.user.name || 'system', `生产审核通过 #${entry.id}`);
    await query(
      `update production_entries set status='approved', approved_at=$1, approved_by=$2 where id=$3`,
      [Date.now(), req.user.name || '', id]
    );
    const fresh = await query('select * from production_entries where id=$1', [id]);
    return res.json({ ok: true, entry: fresh.rows[0] || entry });
  }
  if (action === 'reject') {
    await query(
      `update production_entries
       set status='rejected', rejected_at=$1, rejected_by=$2, reject_reason=$3
       where id=$4`,
      [Date.now(), req.user.name || '', reason, id]
    );
    const fresh = await query('select * from production_entries where id=$1', [id]);
    return res.json({ ok: true, entry: fresh.rows[0] || entry });
  }
  return res.status(400).json({ error: 'bad_action' });
});

// Inventory (Finished)
app.get('/api/inventory/finished', authRequired, async (req, res) => {
  const { page='1', size='50', q='' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 50));
  
  let countSql = 'select count(*)::int as c from products p';
  let dataSql = `
    select p.id, p.sku, p.barcode, p.name, p.name_cn, p.image, p.spec,
    p.price1, p.price2, p.price3, p.price4, p.tax_rate, p.cost_price,
    p.description, p.notes, p.stock, p.dividend_enabled, p.dividend_users,
    p.stock as total_stock, coalesce(p.remind_stock, 0) as remind_stock,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc)
      from inventory_batches
      where product_id=p.id and quantity>0
    ) as batches
    from products p
  `;
  
  const pVals = [];
  if (q && q.trim()) {
    const cond = ' where (p.name ilike $1 or p.name_cn ilike $1 or p.sku ilike $1 or p.barcode ilike $1)';
    countSql += cond;
    dataSql += cond;
    pVals.push('%' + q.trim() + '%');
  }
  
  const countR = await query(countSql, pVals);
  const total = countR.rows[0].c;

  dataSql += ` order by length(p.sku) asc, p.sku asc limit $${pVals.length + 1} offset $${pVals.length + 2}`;
  pVals.push(pageSize, (pageNum - 1) * pageSize);
  
  const r = await query(dataSql, pVals);
  res.json({ list: r.rows, total });
});
async function addFinishedInventoryItems(items = [], actorName = 'system', notesText = '') {
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = rawItem || {};
    const productId = Number(item.productId || 0);
    const parsedQty = Number(item.qty || 0);
    const expiry = String(item.expiry || '').trim();
    const lote = String(item.lote || '').trim();
    if (!productId || !Number.isFinite(parsedQty) || parsedQty <= 0) continue;

    const p = await query('select stock from products where id=$1', [productId]);
    if (!p.rows[0]) continue;
    const currentStock = Number(p.rows[0]?.stock || 0);
    let batchQty = parsedQty;
    const entryNow = Date.now();

    if (currentStock <= 0) {
      await query('update inventory_batches set quantity = 0 where product_id=$1', [productId]);
    }

    if (currentStock < 0) {
      const deficit = Math.abs(currentStock);
      batchQty = batchQty > deficit ? batchQty - deficit : 0;
    }

    if (batchQty > 0) {
      await query(
        'insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)',
        [productId, batchQty, expiry, lote, entryNow]
      );
    }

    await query('update products set stock = stock + $1 where id=$2', [parsedQty, productId]);
    await query(
      'insert into inventory_logs(product_id, quantity, type, created_at, created_by, notes, lote) values($1,$2,$3,$4,$5,$6,$7)',
      [productId, parsedQty, 'in', entryNow, actorName || 'system', notesText || '', lote]
    );
  }
}
app.post('/api/inventory/finished', authRequired, ensureAllow('finished_stock','edit'), async (req, res) => {
  const items = req.body.items || [req.body];
  await addFinishedInventoryItems(items, req.user.name || 'system', '');
  res.json({ ok: true });
});
app.put('/api/inventory/finished/adjust', authRequired, ensureAllow('finished_stock_adjust','edit'), async (req, res) => {
  const { productId, qty, lote = '', expiry = '', notes = '' } = req.body || {};
  const pid = Number(productId || 0);
  const delta = Number(qty || 0);
  const loteText = String(lote || '').trim();
  const expiryText = String(expiry || '').trim();
  const noteText = String(notes || '').trim();
  if (!pid || !Number.isFinite(delta) || delta === 0 || !loteText || !noteText) return res.status(400).json({ error: 'bad_request' });
  const p = await query('select id from products where id=$1', [pid]);
  if (!p.rows[0]) return res.status(404).json({ error: 'not_found' });
  const now = Date.now();
  const batchR = await query('select id, quantity, lote from inventory_batches where product_id=$1 order by quantity desc, id desc', [pid]);
  const matchBatch = (x) => {
    const raw = String(x.lote || '').trim();
    return raw === loteText || formatLote(raw) === loteText;
  };
  const positiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0 && matchBatch(x));
  const anyBatch = batchR.rows.find(matchBatch);
  const batch = delta < 0 ? positiveBatch : (positiveBatch || anyBatch);
  if (delta > 0) {
    if (batch) {
      await query('update inventory_batches set quantity=quantity+$1, expiration_date=$2 where id=$3', [delta, expiryText || '', batch.id]);
    } else {
      await query('insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)', [pid, delta, expiryText || '', loteText, now]);
    }
  } else {
    if (!batch) return res.status(400).json({ error: 'batch_not_found' });
    const remaining = Number(batch.quantity || 0) + delta;
    await query('update inventory_batches set quantity=$1, expiration_date=$2 where id=$3', [Math.max(remaining, 0), expiryText || '', batch.id]);
  }
  const stockR = await query('select coalesce(sum(case when quantity > 0 then quantity else 0 end), 0) as stock from inventory_batches where product_id=$1', [pid]);
  await query('update products set stock = $1 where id=$2', [Number(stockR.rows[0]?.stock || 0), pid]);
  await query('insert into inventory_logs(product_id, quantity, type, created_at, created_by, notes, lote) values($1,$2,$3,$4,$5,$6,$7)', [pid, delta, 'adjust', now, req.user.name || 'system', noteText, loteText]);
  res.json({ ok: true });
});

async function getFinishedInventoryRecords({ productId = null, page = 1, size = 100 }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 100));
  const params = [];
  const productFilter = productId ? ` and p.id = $1` : '';
  const inFilter = productId ? ` and l.product_id = $1` : '';
  const outFilter = productId ? ` and (item->>'productId')::int = $1` : '';
  params.push(pageSize, (pageNum - 1) * pageSize);
  const limitIdx = productId ? 2 : 1;
  const offsetIdx = productId ? 3 : 2;
  if (productId) params.unshift(Number(productId));
  const r = await query(`
    with records as (
      select
        l.created_at,
        p.sku,
        p.name,
        p.name_cn,
        ''::text as invoice_no,
        ''::text as customer,
        l.quantity::numeric as qty,
        l.type::text as type,
        l.created_by as user,
        coalesce(nullif(l.lote, ''), nullif(b.lote, ''), nullif(l.notes, ''), '') as lote,
        case when l.type = 'adjust' then coalesce(l.notes, '') else '' end as notes
      from inventory_logs l
      join products p on p.id = l.product_id
      left join lateral (
        select lote
        from inventory_batches
        where product_id = l.product_id and abs(created_at - l.created_at) <= 10000
        order by abs(created_at - l.created_at) asc, id desc
        limit 1
      ) b on true
      where l.type in ('in','adjust')${inFilter}
      union all
      select
        i.created_at,
        p.sku,
        p.name,
        p.name_cn,
        i.invoice_no,
        i.customer,
        -1 * (item->>'qty')::numeric as qty,
        'out'::text as type,
        coalesce(nullif(d.shipped_by, ''), nullif(i.created_by, ''), 'system') as user,
        coalesce(
          (
            select string_agg(
              case
                when jsonb_typeof(ded) = 'object' then
                  case
                    when coalesce(ded->>'lote', '') = '' then '-'
                    else right(split_part(ded->>'lote', '-', 3), 2) || split_part(ded->>'lote', '-', 2)
                  end
                else '-'
              end,
              ','
            )
            from jsonb_array_elements(coalesce(item->'deductions', '[]'::jsonb)) ded
          ),
          case
            when item->>'description' ~* 'Lote:\\s*([^ ]+)' then regexp_replace(item->>'description', '.*Lote:\\s*([^ ]+).*', '\\1', 'i')
            else ''
          end
        ) as lote,
        ''::text as notes
      from invoices i
      left join daily_orders d on d.invoice_id = i.id
      cross join lateral jsonb_array_elements(i.items) as item
      left join products p on p.id = (item->>'productId')::int
      where item->>'productId' is not null
        and item->>'productId' != ''
        and item->>'productId' ~ '^[0-9]+$'${outFilter}
    )
    select *, count(*) over()::int as total_count
    from records
    order by created_at desc, sku asc
    limit $${limitIdx} offset $${offsetIdx}
  `, params);
  return {
    list: r.rows.map(x => ({
      date: Number(x.created_at),
      sku: x.sku || '',
      name: x.name || '',
      name_cn: x.name_cn || '',
      invoice_no: x.invoice_no || '',
      customer: x.customer || '',
      qty: Number(x.qty || 0),
      type: x.type,
      user: x.user || '',
      lote: x.lote || '',
      notes: x.notes || ''
    })),
    total: r.rows[0]?.total_count || 0
  };
}

app.get('/api/inventory/finished/logs', authRequired, async (req, res) => {
  try {
    const data = await getFinishedInventoryRecords({
      page: req.query.page,
      size: req.query.size
    });
    res.json(data);
  } catch (e) {
    console.error('Error in finished inventory records:', e);
    res.json({ list: [], total: 0 });
  }
});

app.get('/api/inventory/finished/:id/logs', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const data = await getFinishedInventoryRecords({ productId: id, page: 1, size: 1000 });
    res.json(data.list.map(x => ({
      type: x.type,
      date: x.date,
      qty: Math.abs(Number(x.qty || 0)),
      raw_qty: Number(x.qty || 0),
      user: x.user,
      invoice_no: x.invoice_no,
      customer: x.customer,
      lote: x.lote,
      notes: x.notes || ''
    })));
  } catch (e) {
    console.error('Error in logs:', e);
    res.json([]);
  }
});

// Inventory (Raw)
async function resolveMaterial({ materialId = null, name = '' }) {
  const mid = Number(materialId || 0);
  if (mid > 0) {
    const byId = await query('select id, name, stock from materials where id=$1', [mid]);
    if (byId.rows[0]) return byId.rows[0];
  }
  const materialName = String(name || '').trim();
  if (!materialName) return null;
  const byName = await query('select id, name, stock from materials where lower(name)=lower($1) limit 1', [materialName]);
  if (byName.rows[0]) return byName.rows[0];
  return null;
}
async function syncMaterialStock(materialId) {
  const stockR = await query('select coalesce(sum(case when quantity > 0 then quantity else 0 end), 0) as stock from material_batches where material_id=$1', [materialId]);
  const stock = Number(stockR.rows[0]?.stock || 0);
  await query('update materials set stock=$1 where id=$2', [stock, materialId]);
  return stock;
}
app.get('/api/inventory/raw', authRequired, async (req, res) => {
  const { page='1', size='50', q='' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 50));
  let countSql = 'select count(*)::int as c from materials m';
  let dataSql = `
    select m.id, m.name, m.image, m.stock,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc, id asc)
      from material_batches
      where material_id=m.id and quantity>0
    ) as batches
    from materials m
  `;
  const params = [];
  if (q && q.trim()) {
    countSql += ' where m.name ilike $1';
    dataSql += ' where m.name ilike $1';
    params.push('%' + q.trim() + '%');
  }
  const countR = await query(countSql, params);
  const total = countR.rows[0]?.c || 0;
  dataSql += ` order by m.id desc limit $${params.length + 1} offset $${params.length + 2}`;
  params.push(pageSize, (pageNum - 1) * pageSize);
  const r = await query(dataSql, params);
  res.json({ list: r.rows, total });
});
app.post('/api/inventory/raw/materials', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const image = String(req.body?.image || '').trim();
  if (!name) return res.status(400).json({ error: 'bad_request' });
  const exist = await query('select id from materials where lower(name)=lower($1) limit 1', [name]);
  if (exist.rows[0]) return res.status(400).json({ error: 'duplicate' });
  const created = await query('insert into materials(name, image, stock) values($1, $2, 0) returning id, name, image, stock', [name, image]);
  res.json({ ok: true, material: created.rows[0] });
});
app.put('/api/inventory/raw/materials/:id', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const mid = Number(req.params.id || 0);
  const name = String(req.body?.name || '').trim();
  const image = String(req.body?.image || '').trim();
  if (!mid || !name) return res.status(400).json({ error: 'bad_request' });
  const material = await query('select id from materials where id=$1 limit 1', [mid]);
  if (!material.rows[0]) return res.status(404).json({ error: 'not_found' });
  const exist = await query('select id from materials where lower(name)=lower($1) and id<>$2 limit 1', [name, mid]);
  if (exist.rows[0]) return res.status(400).json({ error: 'duplicate' });
  const updated = await query('update materials set name=$1, image=$2 where id=$3 returning id, name, image, stock', [name, image, mid]);
  res.json({ ok: true, material: updated.rows[0] });
});
app.delete('/api/inventory/raw/materials/:id', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const mid = Number(req.params.id || 0);
  if (!mid) return res.status(400).json({ error: 'bad_request' });
  const material = await query('select id, stock from materials where id=$1 limit 1', [mid]);
  if (!material.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (Number(material.rows[0].stock || 0) !== 0) return res.status(400).json({ error: 'has_stock' });
  const logCount = await query('select count(*)::int as c from material_logs where material_id=$1', [mid]);
  if (Number(logCount.rows[0]?.c || 0) > 0) return res.status(400).json({ error: 'has_logs' });
  await query('delete from material_batches where material_id=$1', [mid]);
  await query('delete from materials where id=$1', [mid]);
  res.json({ ok: true });
});
app.post('/api/inventory/raw', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
  for (const item of items) {
    const { materialId = null, name = '', qty, expiry = '', lote = '' } = item || {};
    const delta = Number(qty || 0);
    const expiryText = String(expiry || '').trim();
    const loteText = String(lote || '').trim();
    if (!Number.isFinite(delta) || delta <= 0 || !expiryText || !loteText) {
      return res.status(400).json({ error: 'bad_request' });
    }
    let material = await resolveMaterial({ materialId, name });
    if (!material) {
      const materialName = String(name || '').trim();
      if (!materialName) return res.status(400).json({ error: 'bad_request' });
      const created = await query('insert into materials(name, stock) values($1, 0) returning id, name, stock', [materialName]);
      material = created.rows[0];
    }
    const now = Date.now();
    const currentStock = Number(material.stock || 0);
    let batchQty = delta;
    if (currentStock <= 0) {
      await query('update material_batches set quantity = 0 where material_id=$1', [material.id]);
    }
    if (currentStock < 0) {
      const deficit = Math.abs(currentStock);
      batchQty = batchQty > deficit ? (batchQty - deficit) : 0;
    }
    if (batchQty > 0) {
      const existBatch = await query('select id from material_batches where material_id=$1 and coalesce(expiration_date, \'\')=$2 and coalesce(lote, \'\')=$3 order by id desc limit 1', [material.id, expiryText, loteText]);
      if (existBatch.rows[0]) {
        await query('update material_batches set quantity = quantity + $1 where id=$2', [batchQty, existBatch.rows[0].id]);
      } else {
        await query('insert into material_batches(material_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)', [material.id, batchQty, expiryText, loteText, now]);
      }
    }
    await syncMaterialStock(material.id);
    await query('insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, lote) values($1,$2,$3,$4,$5,$6,$7,$8)', [material.id, delta, 'in', now, req.user.name || 'system', '', expiryText, loteText]);
  }
  res.json({ ok: true });
});
app.put('/api/inventory/raw/adjust', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const { materialId, qty, expiry = '', notes = '' } = req.body || {};
  const mid = Number(materialId || 0);
  const delta = Number(qty || 0);
  const expiryText = String(expiry || '').trim();
  const noteText = String(notes || '').trim();
  if (!mid || !Number.isFinite(delta) || delta === 0 || !noteText) return res.status(400).json({ error: 'bad_request' });
  const material = await query('select id from materials where id=$1', [mid]);
  if (!material.rows[0]) return res.status(404).json({ error: 'not_found' });
  const now = Date.now();
  const batchR = await query('select id, quantity, expiration_date from material_batches where material_id=$1 order by quantity desc, id desc', [mid]);
  const matchBatch = (x) => String(x.expiration_date || '').trim() === expiryText;
  const positiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0 && matchBatch(x));
  const anyPositiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0);
  const anyBatch = batchR.rows.find(matchBatch);
  const batch = expiryText ? (delta < 0 ? positiveBatch : (positiveBatch || anyBatch)) : (delta < 0 ? anyPositiveBatch : anyPositiveBatch);
  if (delta > 0) {
    if (batch && (!expiryText || matchBatch(batch))) {
      await query('update material_batches set quantity=quantity+$1, expiration_date=$2 where id=$3', [delta, expiryText || String(batch.expiration_date || ''), batch.id]);
    } else {
      await query('insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)', [mid, delta, expiryText, now]);
    }
  } else {
    if (!batch) return res.status(400).json({ error: 'batch_not_found' });
    const remaining = Number(batch.quantity || 0) + delta;
    await query('update material_batches set quantity=$1 where id=$2', [Math.max(remaining, 0), batch.id]);
  }
  await syncMaterialStock(mid);
  await query('insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date) values($1,$2,$3,$4,$5,$6,$7)', [mid, delta, 'adjust', now, req.user.name || 'system', noteText, expiryText]);
  res.json({ ok: true });
});
app.get('/api/inventory/raw/logs', authRequired, async (req, res) => {
  const { page='1', size='100', q='' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 100));
  const params = [];
  let filter = '';
  if (q && q.trim()) {
    params.push('%' + q.trim() + '%');
    filter = ` where m.name ilike $${params.length}`;
  }
  params.push(pageSize, (pageNum - 1) * pageSize);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;
  const r = await query(`
    with records as (
      select
        ml.created_at,
        m.name,
        ml.quantity::numeric as qty,
        ml.type::text as type,
        ml.created_by as user,
        coalesce(ml.notes, '') as notes,
        coalesce(ml.expiration_date, '') as expiry,
        coalesce(ml.lote, '') as lote
      from material_logs ml
      join materials m on m.id = ml.material_id
      ${filter}
    )
    select *, count(*) over()::int as total_count
    from records
    order by created_at desc, name asc
    limit $${limitIdx} offset $${offsetIdx}
  `, params);
  res.json({
    list: r.rows.map(x => ({
      date: Number(x.created_at),
      name: x.name || '',
      qty: Number(x.qty || 0),
      type: x.type || '',
      user: x.user || '',
      notes: x.notes || '',
      expiry: x.expiry || '',
      lote: x.lote || ''
    })),
    total: r.rows[0]?.total_count || 0
  });
});
app.put('/api/inventory/raw/audit', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const { name, qty } = req.body || {};
  const materialName = String(name || '').trim();
  const totalQty = Number(qty || 0);
  if (!materialName || !Number.isFinite(totalQty) || totalQty < 0) return res.status(400).json({ error: 'bad_request' });
  let material = await resolveMaterial({ name: materialName });
  if (!material) {
    const created = await query('insert into materials(name, stock) values($1, 0) returning id, name, stock', [materialName]);
    material = created.rows[0];
  }
  await query('delete from material_batches where material_id=$1', [material.id]);
  const today = new Date().toISOString().slice(0,10);
  if (totalQty > 0) {
    await query('insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)', [material.id, totalQty, today, Date.now()]);
  }
  await query('update materials set stock=$1 where id=$2', [totalQty, material.id]);
  await query('insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date) values($1,$2,$3,$4,$5,$6,$7)', [material.id, totalQty, 'adjust', Date.now(), req.user.name || 'system', '盘点覆盖', today]);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
