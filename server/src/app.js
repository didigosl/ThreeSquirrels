import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { query, pool } from './db.js';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import convertHeic from 'heic-convert';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
const MAX_UPLOAD_FILE_SIZE = 200 * 1024 * 1024;
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE }
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
    quality: 0.78
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
const execFileAsync = promisify(execFile);
const pdfPreviewStore = new Map();
const RAW_MATERIAL_CATEGORIES = ['食物原料', '辅料', '包装材料', '清洁用品', '其它'];

function normalizeRawMaterialCategory(value) {
  const category = String(value || '').trim();
  return RAW_MATERIAL_CATEGORIES.includes(category) ? category : '其它';
}

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
      file text,
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
      sales text,
      shipping_addresses jsonb not null default '[]'::jsonb
    );
    create table if not exists accounts (
      id serial primary key,
      name text not null unique,
      name_es text,
      balance numeric not null default 0,
      description text,
      created text,
      initial_set boolean not null default false
    );
    create table if not exists shareholder_investments (
      id serial primary key,
      shareholder text not null,
      kind text not null default '投入',
      amount numeric not null default 0,
      investment_date text,
      notes text,
      created_at bigint,
      created_by text
    );
    create table if not exists shareholder_profiles (
      shareholder text primary key,
      holding_percent numeric(7,3) not null default 0,
      updated_at bigint,
      updated_by text
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
      password text,
      locale text not null default 'zh-CN'
    );
    create table if not exists invoices (
      id serial primary key,
      invoice_no text not null unique,
      invoice_type text default 'factura',
      customer text,
      date text,
      items jsonb default '[]'::jsonb,
      total_amount numeric default 0,
      manual_discount_amount numeric default 0,
      notes text,
      created_at bigint,
      created_by text,
      converted_invoice_id int,
      converted_invoice_no text,
      converted_at bigint,
      source_invoice_id int,
      source_invoice_no text,
      delivered boolean default false,
      delivered_at text,
      delivered_by text
    );
    create table if not exists products (
      id serial primary key,
      sku text unique,
      product_code text,
      print_label_enabled boolean default true,
      print_small_label_enabled boolean default false,
      print_small_label_copies int default 1,
      print_large_label_enabled boolean default false,
      print_large_label_copies int default 1,
      barcode text,
      name text,
      name_cn text,
      raw_material_id int,
      raw_material_name text,
      image text,
      description text,
      ingredients text,
      nutrition_facts text,
      allergens text,
      price1 numeric default 0,
      price2 numeric default 0,
      price3 numeric default 0,
      price4 numeric default 0,
      tax_rate numeric default 0,
      cost_price numeric default 0,
      weight_kg numeric default 0,
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
  await query("alter table invoices add column if not exists invoice_type text default 'factura'", []);
  await query('alter table invoices add column if not exists total_amount numeric default 0', []);
  await query('alter table invoices add column if not exists manual_discount_amount numeric default 0', []);
  await query('alter table invoices add column if not exists notes text', []);
  await query('alter table invoices add column if not exists sales text', []);
  await query('alter table invoices add column if not exists created_at bigint', []);
  await query('alter table invoices add column if not exists created_by text', []);
  await query('alter table invoices add column if not exists converted_invoice_id int', []);
  await query('alter table invoices add column if not exists converted_invoice_no text', []);
  await query('alter table invoices add column if not exists converted_at bigint', []);
  await query('alter table invoices add column if not exists source_invoice_id int', []);
  await query('alter table invoices add column if not exists source_invoice_no text', []);
  await query('alter table invoices add column if not exists shipping_printed boolean default false', []);
  await query('alter table invoices add column if not exists delivered boolean default false', []);
  await query('alter table invoices add column if not exists delivered_at text', []);
  await query('alter table invoices add column if not exists delivered_by text', []);

  // Products migrations
  await query('alter table products add column if not exists sku text unique', []);
  await query('alter table products add column if not exists product_code text', []);
  await query('alter table products add column if not exists print_label_enabled boolean default true', []);
  await query('alter table products add column if not exists print_small_label_enabled boolean default false', []);
  await query('alter table products add column if not exists print_small_label_copies int default 1', []);
  await query('alter table products add column if not exists print_large_label_enabled boolean default false', []);
  await query('alter table products add column if not exists print_large_label_copies int default 1', []);
  await query('alter table products add column if not exists barcode text', []);
  await query('alter table products add column if not exists name text', []);
  await query('alter table products add column if not exists name_cn text', []);
  await query('alter table products add column if not exists raw_material_id int', []);
  await query('alter table products add column if not exists raw_material_name text', []);
  await query('alter table products add column if not exists image text', []);
  await query('alter table products add column if not exists description text', []);
  await query('alter table products add column if not exists ingredients text', []);
  await query('alter table products add column if not exists nutrition_facts text', []);
  await query('alter table products add column if not exists allergens text', []);
  await query('update products set print_label_enabled=true where print_label_enabled is null', []);
  await query('alter table products add column if not exists price1 numeric default 0', []);
  await query('alter table products add column if not exists price2 numeric default 0', []);
  await query('alter table products add column if not exists price3 numeric default 0', []);
  await query('alter table products add column if not exists price4 numeric default 0', []);
  await query('alter table products add column if not exists tax_rate numeric default 0', []);
  await query('alter table products add column if not exists cost_price numeric default 0', []);
  await query('alter table products add column if not exists weight_kg numeric default 0', []);
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
  await query("alter table users add column if not exists locale text default 'zh-CN'", []);
  await query("alter table users add column if not exists holding_percent numeric(7,3) not null default 0", []);
  await query(`
    update users u
    set holding_percent = p.holding_percent
    from shareholder_profiles p
    where u.name = p.shareholder
      and coalesce(u.holding_percent, 0) = 0
      and coalesce(p.holding_percent, 0) <> 0
  `, []);
  await query('alter table users alter column password_hash drop not null', []);
  await query("update users set locale='zh-CN' where locale is null or trim(locale)=''", []);
  await query('alter table roles add column if not exists description text', []);
  await query('alter table roles add column if not exists created text', []);
  await query('alter table roles add column if not exists immutable boolean default false', []);
  await query("alter table roles add column if not exists perms jsonb default '{}'::jsonb", []);
  await query("update roles set perms='{}'::jsonb where perms is null", []);
  await query('update roles set immutable=false where immutable is null', []);
  await query('alter table accounts add column if not exists description text', []);
  await query('alter table accounts add column if not exists created text', []);
  await query('alter table accounts add column if not exists initial_set boolean default false', []);
  await query('alter table accounts add column if not exists name_es text', []);
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
  await query('alter table ledger add column if not exists skip_account_balance boolean not null default false', []);
  await query('alter table ledger add column if not exists repaid_amount numeric not null default 0', []);
  await query('alter table ledger add column if not exists loan_settled boolean not null default false', []);
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
  await query(`alter table contacts add column if not exists shipping_addresses jsonb not null default '[]'::jsonb`, []);
  await query('alter table materials add column if not exists merchant_id int', []);
  await query('alter table materials add column if not exists merchant_name text', []);
  await query('alter table material_logs add column if not exists merchant_name text', []);
  await query(`
    update material_logs ml
    set merchant_name = coalesce(mc.name, m.merchant_name, '')
    from materials m
    left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
    where ml.material_id = m.id
      and coalesce(ml.merchant_name, '') = ''
      and coalesce(mc.name, m.merchant_name, '') <> ''
  `, []);
  await query("update contacts set owner='客户' where owner is null or owner=''", []);
  await query("update contacts set type=owner where type is null or type=''", []);
  await query("alter table contacts alter column type set default '客户'", []);
  await query('alter table contacts alter column type drop not null', []);
  await query('create unique index if not exists uniq_contacts_owner_name on contacts(owner, name)', []);
  await query('alter table payables add column if not exists paid numeric default 0', []);
  await query('alter table payables add column if not exists settled boolean default false', []);
  await query('alter table payables add column if not exists trust_days int default 30', []);
  await query('alter table payables add column if not exists notes text', []);
  await query('alter table payables add column if not exists file text', []);
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
  await query('alter table payables add column if not exists confirmed_by text', []);
  await query('alter table payables add column if not exists confirmed_at text', []);
  await query("alter table payables add column if not exists special_status text default ''", []);
  await query("update payables set special_status='' where special_status is null", []);
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
    create table if not exists system_settings (
      setting_key text primary key,
      setting_value jsonb not null default '{}'::jsonb,
      updated_at bigint default 0,
      updated_by text default ''
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
    create table if not exists production_plans (
      id serial primary key,
      product_id int,
      plan_group_key text,
      product_name text,
      material_name text,
      material_qty numeric(18,2) default 0,
      sort_order int default 0,
      week_start bigint,
      plan_start bigint,
      plan_end bigint,
      status text default 'pending',
      created_by text,
      created_at bigint,
      confirmed_by text,
      confirmed_at bigint
    );
    create table if not exists daily_orders (
      id serial primary key,
      customer text,
      sales text,
      items jsonb default '[]'::jsonb,
      status text default 'new', -- new, allocated, shipped
      allocation_enabled boolean default false,
      created_by text,
      created_at bigint,
      invoice_id int,
      date text,
      manual_discount_amount numeric default 0,
      notes text,
      allocated_by text,
      shipped_by text
    );
    alter table daily_orders add column if not exists manual_discount_amount numeric default 0;
    alter table daily_orders add column if not exists notes text;
    alter table daily_orders add column if not exists allocated_by text;
    alter table daily_orders add column if not exists shipped_by text;
    alter table daily_orders add column if not exists allocation_enabled boolean default false;
    alter table daily_orders add column if not exists logistics_company_id int;
    alter table daily_orders add column if not exists logistics_status text;
    alter table daily_orders add column if not exists logistics_updated_at bigint;
    alter table daily_orders add column if not exists logistics_from text;
    alter table daily_orders add column if not exists logistics_to text;
    alter table daily_orders add column if not exists logistics_ship_date text;
    alter table daily_orders add column if not exists logistics_pallet_count text;
    alter table daily_orders add column if not exists logistics_box_count text;
    alter table daily_orders add column if not exists logistics_total_weight text;
    alter table daily_orders add column if not exists logistics_voucher_url text;
    alter table daily_orders add column if not exists logistics_voucher_name text;
    alter table daily_orders add column if not exists logistics_arrival_date text;
    alter table daily_orders add column if not exists logistics_completed_by text;
    alter table daily_orders add column if not exists logistics_reviewed_by text;
    alter table daily_orders add column if not exists is_manual_logistics boolean default false;
    alter table daily_orders add column if not exists stock_deducted_at bigint;
    alter table daily_orders add column if not exists stock_deducted_by text;
    update daily_orders set allocation_enabled=false where allocation_enabled is null;
    create table if not exists order_action_assignments (
      action_key text primary key,
      assigned_to text,
      updated_at bigint,
      updated_by text
    );

    create table if not exists logistics_companies (
      id serial primary key,
      name text not null unique,
      phone text,
      contact text,
      generate_logistics_order boolean not null default true,
      enabled boolean not null default true,
      created_at bigint,
      created_by text
    );
    alter table logistics_companies add column if not exists phone text;
    alter table logistics_companies add column if not exists contact text;
    alter table logistics_companies add column if not exists generate_logistics_order boolean default true;
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
      merchant_id int,
      merchant_name text,
      category text default '其它',
      pre_stock numeric default 0,
      stock numeric default 0
    );
    create table if not exists raw_material_audits (
      id serial primary key,
      session_id int,
      material_id int,
      material_name text,
      category text,
      pre_stock numeric default 0,
      previous_stock numeric default 0,
      counted_stock numeric default 0,
      difference numeric default 0,
      audited_at bigint,
      audited_by text
    );
    create table if not exists raw_material_audit_sessions (
      id serial primary key,
      audited_at bigint,
      audited_by text,
      audit_category text default '全部类别',
      status text default 'pending',
      approved_at bigint,
      approved_by text
    );
    create table if not exists material_batches (
      id serial primary key,
      material_id int,
      quantity numeric default 0,
      expiration_date text,
      created_at bigint
    );
    alter table material_batches add column if not exists lote text;
    alter table materials add column if not exists merchant_id int;
    alter table materials add column if not exists merchant_name text;
    alter table materials add column if not exists category text default '其它';
    alter table materials add column if not exists pre_stock numeric default 0;
    update materials set category='其它' where category is null or trim(category)='';
    update materials set pre_stock=0 where pre_stock is null;
    alter table raw_material_audits add column if not exists category text;
    alter table raw_material_audits add column if not exists session_id int;
    alter table raw_material_audit_sessions add column if not exists audit_category text default '全部类别';
    update raw_material_audit_sessions set audit_category='全部类别' where audit_category is null or trim(audit_category)='';
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
    alter table material_logs add column if not exists merchant_name text;
    create table if not exists event_records (
      id serial primary key,
      name text,
      record_date text,
      due_date text,
      notes text,
      image_url text,
      status text default 'ongoing',
      created_by text,
      created_at bigint,
      completed_at bigint
    );
    alter table event_records add column if not exists confirmed_by text;
    alter table event_records add column if not exists image_url text;
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
      confirmed_plan_id int,
      product_name text,
      product_name_cn text,
      product_image text,
      lote text,
      expiration_date text,
      box_count numeric default 0,
      print_note text,
      print_small_label boolean default false,
      print_small_label_copies int default 0,
      print_large_label boolean default false,
      print_large_label_copies int default 0,
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
    create table if not exists employee_checkin_employees (
      id serial primary key,
      name text not null,
      employee_no text,
      phone text,
      enabled boolean default true,
      created_at bigint,
      created_by text,
      updated_at bigint,
      updated_by text
    );
    create table if not exists employee_checkin_records (
      id serial primary key,
      employee_id int not null,
      employee_name text,
      employee_no text,
      phone text,
      remark text,
      checkin_date text not null,
      checkin_at bigint not null,
      start_at bigint,
      end_at bigint,
      created_at bigint,
      created_by text
    );
  `);
  await query('update logistics_companies set generate_logistics_order=true where generate_logistics_order is null', []);
  await query(
    `insert into order_action_assignments(action_key, assigned_to, updated_at, updated_by)
     values($1,$2,$3,$4)
     on conflict (action_key) do nothing`,
    ['ship_without_voucher', 'aaaaaa', Date.now(), 'system']
  );
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
  try { await query('create index if not exists idx_production_plans_week_start on production_plans(week_start, created_at desc)'); } catch {}
  try { await query('alter table production_plans add column if not exists product_id int'); } catch {}
  try { await query('alter table production_plans add column if not exists plan_group_key text'); } catch {}
  try { await query('alter table production_plans add column if not exists sort_order int default 0'); } catch {}
  try { await query('alter table production_plans add column if not exists plan_start bigint'); } catch {}
  try { await query('alter table production_plans add column if not exists plan_end bigint'); } catch {}
  try { await query('alter table production_entries add column if not exists confirmed_plan_id int'); } catch {}
  try { await query('alter table production_entries add column if not exists print_note text'); } catch {}
  try { await query('alter table production_entries add column if not exists print_small_label boolean default false'); } catch {}
  try { await query('alter table production_entries add column if not exists print_small_label_copies int default 0'); } catch {}
  try { await query('alter table production_entries add column if not exists print_large_label boolean default false'); } catch {}
  try { await query('alter table production_entries add column if not exists print_large_label_copies int default 0'); } catch {}
  try { await query('update production_plans set plan_start=week_start where plan_start is null and week_start is not null'); } catch {}
  try { await query('update production_plans set plan_end=week_start + 6 * 24 * 60 * 60 * 1000 where plan_end is null and week_start is not null'); } catch {}
  try { await query('update production_plans set sort_order=id where sort_order is null or sort_order=0'); } catch {}
  try {
    await query(`
      update production_plans
         set plan_group_key = concat('legacy-', coalesce(week_start, 0), '-', coalesce(created_by, ''), '-', coalesce(created_at, id))
       where coalesce(trim(plan_group_key), '') = ''
    `);
  } catch {}
  try { await query('create index if not exists idx_production_plans_plan_start on production_plans(plan_start, created_at desc)'); } catch {}
  try { await query('create index if not exists idx_production_plans_group_key on production_plans(plan_group_key, week_start, created_at desc)'); } catch {}
  try { await query('update auto_tasks set start_at=created_at where start_at is null'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists employee_no text'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists phone text'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists enabled boolean default true'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists created_at bigint'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists created_by text'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists updated_at bigint'); } catch {}
  try { await query('alter table employee_checkin_employees add column if not exists updated_by text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists employee_name text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists employee_no text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists phone text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists remark text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists checkin_date text'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists checkin_at bigint'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists start_at bigint'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists end_at bigint'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists created_at bigint'); } catch {}
  try { await query('alter table employee_checkin_records add column if not exists created_by text'); } catch {}
  try { await query('update employee_checkin_employees set enabled=true where enabled is null'); } catch {}
  try { await query('update employee_checkin_records set start_at=checkin_at where start_at is null and checkin_at is not null'); } catch {}
  try { await query('update employee_checkin_records set created_at=checkin_at where created_at is null and checkin_at is not null'); } catch {}
  try { await query('create unique index if not exists uniq_employee_checkin_daily on employee_checkin_records(employee_id, checkin_date)'); } catch {}
  try { await query('create index if not exists idx_employee_checkin_date_time on employee_checkin_records(checkin_date desc, checkin_at desc)'); } catch {}
  try { await query('create index if not exists idx_employee_checkin_employee_enabled on employee_checkin_employees(enabled, created_at desc)'); } catch {}
}
function formatLote(loteDate) {
  if (!loteDate) return '';
  const parts = loteDate.split('-');
  if (parts.length === 3) return parts[2] + parts[1];
  return loteDate;
}

function toYmdDateText(value = Date.now()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = new Date(Number(value || Date.now()));
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthRangeTexts(monthValue = '') {
  const raw = String(monthValue || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [yearText, monthText] = raw.split('-');
  const year = Number(yearText || 0);
  const month = Number(monthText || 0);
  if (!year || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    startDate: toYmdDateText(start.getTime()),
    endDate: toYmdDateText(end.getTime())
  };
}

function resolveEmployeeCheckinRange(query = {}) {
  const month = String(query.month || '').trim();
  const monthRange = getMonthRangeTexts(month);
  if (monthRange) return { ...monthRange, mode: 'month', month };
  const startDate = toYmdDateText(String(query.start_date || '').trim() || Date.now());
  const endDate = toYmdDateText(String(query.end_date || '').trim() || startDate);
  return {
    startDate: startDate <= endDate ? startDate : endDate,
    endDate: startDate <= endDate ? endDate : startDate,
    mode: 'range',
    month: ''
  };
}

function normalizeEmployeeCheckinPassword(value = '') {
  return String(value || '').trim();
}

function isValidEmployeeCheckinPassword(value = '') {
  return /^\d{4}$/.test(normalizeEmployeeCheckinPassword(value));
}

function canSelectEmployeeCheckinDate(user = null) {
  return String(user?.name || '').trim() === 'aaaaaa';
}

function normalizeFinishedInventoryLote(loteValue = '', fallbackValue = Date.now()) {
  const raw = String(loteValue || '').trim();
  return raw || toYmdDateText(fallbackValue);
}

async function syncFinishedStockWithClient(client, productId) {
  const stockR = await client.query('select coalesce(sum(case when quantity > 0 then quantity else 0 end), 0) as stock from inventory_batches where product_id=$1', [productId]);
  const stock = Number(stockR.rows[0]?.stock || 0);
  await client.query('update products set stock = $1 where id=$2', [stock, productId]);
  return stock;
}

async function reconcileFinishedInventoryBatches(productId, fallbackValue = Date.now()) {
  const pid = Number(productId || 0);
  if (!pid) return { totalStock: 0, batches: [] };
  const batchR = await query(`
    select id, quantity, expiration_date, lote, created_at
    from inventory_batches
    where product_id=$1 and quantity > 0
    order by expiration_date asc, id asc
  `, [pid]);
  const batches = batchR.rows.map(row => ({ ...row }));
  for (const row of batches) {
    const rawLote = String(row.lote || '').trim();
    if (rawLote) continue;
    const nextLote = normalizeFinishedInventoryLote('', row.created_at || fallbackValue);
    await query('update inventory_batches set lote=$1 where id=$2', [nextLote, row.id]);
    row.lote = nextLote;
  }
  const batchQty = batches.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
  return {
    totalStock: batchQty,
    batches: batches
      .filter(row => Number(row.quantity || 0) > 0)
      .map(row => ({
        qty: Number(row.quantity || 0),
        expiry: String(row.expiration_date || '').trim(),
        lote: String(row.lote || '').trim()
      }))
  };
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

function normalizeAutoTaskInterval(rawValue) {
  const raw = parseInt(rawValue, 10);
  if (raw === 0) return 0;
  if (raw === -1) return -1;
  if (raw === -2) return -2;
  return Math.max(1, raw || 1);
}

function advanceAutoTaskTs(baseTs, intervalValue) {
  const base = Number(baseTs || Date.now());
  const interval = normalizeAutoTaskInterval(intervalValue);
  if (interval === -1) return base + 24 * 60 * 60 * 1000;
  if (interval === -2) return base + 7 * 24 * 60 * 60 * 1000;
  return addMonthsTs(base, interval);
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
      const intervalValue = normalizeAutoTaskInterval(row.interval_months);
      const isOneTime = intervalValue === 0;
      const startAt = Number(row.start_at || row.created_at || now);
      let nextTs = Number(row.next_generate_at || 0);
      if (!nextTs) nextTs = startAt;
      let lastGeneratedAt = Number(row.last_generated_at || 0);
      let active = !!row.active;
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
        if (isOneTime) {
          nextTs = null;
          active = false;
          break;
        }
        nextTs = advanceAutoTaskTs(nextTs, intervalValue);
      }
      if (!!row.active !== active || Number(row.next_generate_at || 0) !== Number(nextTs || 0) || Number(row.last_generated_at || 0) !== lastGeneratedAt) {
        await query(
          'update auto_tasks set last_generated_at=$1, next_generate_at=$2, active=$3 where id=$4',
          [lastGeneratedAt || null, nextTs || null, active, row.id]
        );
      }
    }
  } finally {
    autoTaskGenerationRunning = false;
  }
}

function extractExplicitLote(item) {
  const directLote = String(item?.lote || '').trim();
  if (directLote) return directLote;
  const text = String(item?.description || '').trim();
  if (text) {
    const m = text.match(/lote\s*[:：]\s*([^\s,;]+)/i);
    if (m) return String(m[1] || '').trim();
  }
  const uniqueLotes = new Map();
  const appendRows = (rows = []) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const lote = String(row?.lote || '').trim();
      const loteKey = normalizeComparableLoteText(lote);
      if (!lote || !loteKey || uniqueLotes.has(loteKey)) return;
      uniqueLotes.set(loteKey, lote);
    });
  };
  appendRows(item?.deductions);
  appendRows(item?.allocation_plan);
  return uniqueLotes.size === 1 ? String(uniqueLotes.values().next().value || '').trim() : '';
}

function normalizeComparableLoteText(loteValue = '') {
  const raw = String(loteValue || '').trim();
  if (!raw) return '';
  return String(formatLote(raw) || raw).trim().toLowerCase();
}

async function dbQuery(dbClient, sql, params = []) {
  if (dbClient && typeof dbClient.query === 'function') {
    return dbClient.query(sql, params);
  }
  return query(sql, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('transaction rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

function sameInvoiceItemIdentity(a, b) {
  const aPid = String(a?.productId || '').trim();
  const bPid = String(b?.productId || '').trim();
  let sameBase = false;
  if (aPid && bPid) {
    sameBase = aPid === bPid;
  } else {
    const aSku = String(a?.sku || '').trim();
    const bSku = String(b?.sku || '').trim();
    if (aSku && bSku) {
      sameBase = aSku === bSku;
    } else {
      sameBase = String(a?.name || '').trim() === String(b?.name || '').trim();
    }
  }
  if (!sameBase) return false;
  const loteA = normalizeComparableLoteText(extractExplicitLote(a));
  const loteB = normalizeComparableLoteText(extractExplicitLote(b));
  if (loteA || loteB) return loteA === loteB;
  return true;
}

async function resolveProductIdFromItem(item, dbClient = null) {
  const rawPid = Number(item?.productId || 0);
  if (rawPid > 0) return rawPid;

  const sku = String(item?.sku || '').trim();
  if (sku) {
    const p = await dbQuery(dbClient, 'select id from products where trim(sku)=trim($1) order by id desc limit 1', [sku]);
    if (p.rows[0]) return Number(p.rows[0].id);
  }

  const name = String(item?.name || '').trim();
  if (name) {
    const p = await dbQuery(dbClient, 'select id from products where trim(name)=trim($1) order by id desc limit 1', [name]);
    if (p.rows[0]) return Number(p.rows[0].id);
  }

  return 0;
}

async function attachInvoiceItemSnapshots(items, oldItems = [], dbClient = null) {
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
    if (matchedOld && !Number(item?.productId || 0) && Number(matchedOld?.productId || 0)) {
      item.productId = Number(matchedOld.productId || 0);
    }
    if (matchedOld && !String(item?.sku || '').trim() && String(matchedOld?.sku || '').trim()) {
      item.sku = String(matchedOld.sku || '').trim();
    }
    if (matchedOld && !String(item?.name_cn || '').trim() && String(matchedOld?.name_cn || '').trim()) {
      item.name_cn = String(matchedOld.name_cn || '').trim();
    }
    if (matchedOld && matchedOld.cost_price !== undefined && matchedOld.cost_price !== null && matchedOld.cost_price !== '') {
      item.cost_price = Number(matchedOld.cost_price || 0);
    }
  }

  const needResolve = list.filter(item => {
    const missingCost = item.cost_price === undefined || item.cost_price === null || item.cost_price === '';
    const missingProductId = !Number(item?.productId || 0);
    const missingSku = !String(item?.sku || '').trim();
    const missingNameCn = !String(item?.name_cn || '').trim();
    return missingCost || missingProductId || missingSku || missingNameCn;
  });
  if (!needResolve.length) return list;

  const ids = [...new Set(needResolve.map(item => Number(item?.productId || 0)).filter(Boolean))];
  const skus = [...new Set(needResolve.map(item => String(item?.sku || '').trim()).filter(Boolean))];
  const names = [...new Set(needResolve.map(item => String(item?.name || '').trim()).filter(Boolean))];

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
    const r = await dbQuery(dbClient, `
      select id, trim(coalesce(sku, '')) as sku, trim(coalesce(name, '')) as name, trim(coalesce(name_cn, '')) as name_cn, coalesce(cost_price, 0) as cost_price
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
    const rawPid = Number(item?.productId || 0);
    const sku = String(item?.sku || '').trim();
    const name = String(item?.name || '').trim();
    const product = (rawPid && productMapById.get(rawPid)) || (sku && productMapBySku.get(sku)) || (name && productMapByName.get(name)) || null;
    if (!product) continue;
    if (!rawPid && Number(product?.id || 0)) item.productId = Number(product.id || 0);
    if (!sku && String(product?.sku || '').trim()) item.sku = String(product.sku || '').trim();
    if (!String(item?.name_cn || '').trim() && String(product?.name_cn || '').trim()) item.name_cn = String(product.name_cn || '').trim();
    if (item.cost_price === undefined || item.cost_price === null || item.cost_price === '') {
      item.cost_price = Number(product?.cost_price || 0);
    }
  }

  return list;
}

async function restoreInventoryForInvoiceItem(item, qtyOverride = null, dbClient = null) {
  const qty = Number(qtyOverride != null ? qtyOverride : item?.qty || 0);
  if (qty <= 0) return;

  const pid = await resolveProductIdFromItem(item, dbClient);
  if (!pid) return;

  await dbQuery(dbClient, 'update products set stock = stock + $1 where id=$2', [qty, pid]);

  const explicitLote = extractExplicitLote(item);
  const deductions = Array.isArray(item?.deductions) ? item.deductions : [];
  const fallbackLote = String(explicitLote || '').trim();

  async function findMergeableBatchId(lote, expiry) {
    const loteKey = formatLote(lote) || lote;
      const candidates = await dbQuery(
        dbClient,
      `select id, coalesce(lote,'') as lote, coalesce(expiration_date,'') as expiration_date
       from inventory_batches
       where product_id=$1
       order by
         case when coalesce(expiration_date,'')<>'' then 0 else 1 end,
         expiration_date asc,
         id asc`,
        [pid]
    );
    const matched = candidates.rows.filter(row => {
      const rowLote = String(row.lote || '').trim();
      return rowLote === lote || formatLote(rowLote) === loteKey;
    });
    const exact = matched.find(row => String(row.expiration_date || '').trim() === expiry);
    if (exact?.id) return exact;
    if (matched[0]?.id) return matched[0];
    return null;
  }

  async function mergeBackToBatch(takeQty, loteValue, expiryValue) {
    const lote = String(loteValue || '').trim();
    const expiry = String(expiryValue || '').trim();
    if (takeQty <= 0) return false;
    if (!lote) return false;
    const existed = await findMergeableBatchId(lote, expiry);
    if (existed?.id) {
      const nextExpiry = expiry || String(existed.expiration_date || '').trim();
      await dbQuery(
        dbClient,
        'update inventory_batches set quantity = quantity + $1, expiration_date=$2 where id=$3',
        [takeQty, nextExpiry, existed.id]
      );
    } else {
      await dbQuery(
        dbClient,
        'insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)',
        [pid, takeQty, expiry, lote, Date.now()]
      );
    }
    return true;
  }

  let remaining = qty;
  for (const d of deductions) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(d?.qty || 0));
    if (take <= 0) continue;

    if (d?.batch_id) {
      const b = await dbQuery(dbClient, 'select id from inventory_batches where id=$1', [d.batch_id]);
      if (b.rows[0]) {
        await dbQuery(dbClient, 'update inventory_batches set quantity = quantity + $1 where id=$2', [take, d.batch_id]);
      } else {
        await mergeBackToBatch(take, d?.lote || fallbackLote, d?.expiry || '');
      }
    } else {
      await mergeBackToBatch(take, d?.lote || fallbackLote, d?.expiry || '');
    }
    remaining -= take;
  }

  if (remaining > 0 && fallbackLote) {
    await mergeBackToBatch(remaining, fallbackLote, '');
  }
}

function normalizeOrderAllocationPlan(item) {
  const plan = Array.isArray(item?.allocation_plan) ? item.allocation_plan : [];
  const grouped = new Map();
  for (const row of plan) {
    const lote = String(row?.lote || '').trim();
    const expiry = String(row?.expiry || '').trim();
    const qty = Math.max(0, Number(row?.qty || 0));
    if (qty <= 0) continue;
    const key = `${lote}__${expiry}`;
    if (!grouped.has(key)) {
      grouped.set(key, { lote, expiry, qty: 0 });
    }
    grouped.get(key).qty += qty;
  }
  return Array.from(grouped.values());
}

function createInsufficientStockError(item, availableStock, requestedQty, extra = null) {
  const err = new Error('insufficient_stock');
  err.code = 'insufficient_stock';
  err.product_name = String(item?.name || item?.sku || item?.productId || '商品');
  err.available_stock = Math.max(0, Number(availableStock || 0));
  err.requested_qty = Math.max(0, Number(requestedQty || 0));
  const reservedQty = Math.max(0, Number(item?.__reserved_qty || 0));
  const requestedTotalQty = Math.max(0, Number(item?.__requested_total_qty || 0));
  if (reservedQty > 0) {
    err.edit_available_stock = err.available_stock + reservedQty;
  }
  if (requestedTotalQty > 0) {
    err.edit_requested_qty = requestedTotalQty;
  }
  if (extra && typeof extra === 'object') {
    Object.assign(err, extra);
  }
  return err;
}

function cloneInvoiceStockMetaRows(rows = [], qtyLimit = null, mode = 'deduction') {
  const list = Array.isArray(rows) ? rows : [];
  let remaining = qtyLimit == null ? Number.POSITIVE_INFINITY : Math.max(0, Number(qtyLimit || 0));
  const cloned = [];
  for (const row of list) {
    if (remaining <= 0) break;
    const rowQty = Math.max(0, Number(row?.qty || 0));
    if (rowQty <= 0) continue;
    const takeQty = Math.min(rowQty, remaining);
    const lote = String(row?.lote || '').trim();
    const expiry = String(row?.expiry || row?.expiration_date || '').trim();
    if (mode === 'plan') {
      cloned.push({ lote, expiry, qty: takeQty });
    } else {
      const batchId = Number(row?.batch_id || 0) || null;
      cloned.push({ batch_id: batchId, lote, expiry, qty: takeQty });
    }
    remaining -= takeQty;
  }
  return cloned;
}

function buildInvoiceItemStockMeta(item, keepQty = 0) {
  const qty = Math.max(0, Number(keepQty || 0));
  const deductionsSource = Array.isArray(item?.deductions) && item.deductions.length > 0
    ? item.deductions
    : Array.isArray(item?.allocation_plan)
      ? item.allocation_plan
      : [];
  const planSource = Array.isArray(item?.allocation_plan) && item.allocation_plan.length > 0
    ? item.allocation_plan
    : Array.isArray(item?.deductions)
      ? item.deductions
      : [];
  return {
    deductions: cloneInvoiceStockMetaRows(deductionsSource, qty, 'deduction'),
    allocation_plan: cloneInvoiceStockMetaRows(planSource, qty, 'plan')
  };
}

function expandInvoiceItemsByAllocationPlan(items = []) {
  const expanded = [];
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = rawItem && typeof rawItem === 'object' ? { ...rawItem } : rawItem;
    const planRows = normalizeOrderAllocationPlan(item);
    if (planRows.length <= 1) {
      if (planRows.length === 1 && !String(item?.lote || '').trim()) {
        item.lote = String(planRows[0]?.lote || '').trim();
      }
      expanded.push(item);
      continue;
    }
    for (const row of planRows) {
      const rowQty = Math.max(0, Number(row?.qty || 0));
      if (rowQty <= 0) continue;
      expanded.push({
        ...item,
        qty: rowQty,
        lote: String(row?.lote || '').trim(),
        deductions: [],
        allocation_plan: [ { lote: String(row?.lote || '').trim(), expiry: String(row?.expiry || '').trim(), qty: rowQty } ]
      });
    }
  }
  return expanded;
}

async function getProductStockSummary(pid, dbClient = null, lockRow = false) {
  const stockR = await dbQuery(dbClient, `
    select
      coalesce(p.stock, 0) as total_stock,
      coalesce((
        select count(*)
        from inventory_batches
        where product_id = p.id and quantity > 0
      ), 0) as batch_count,
      coalesce((
        select sum(case when quantity > 0 then quantity else 0 end)
        from inventory_batches
        where product_id = p.id
      ), 0) as batch_stock
    from products p
    where p.id = $1
    ${lockRow && dbClient ? 'for update' : ''}
  `, [pid]);
  const storedTotalStock = Number(stockR.rows[0]?.total_stock || 0);
  const batchCount = Number(stockR.rows[0]?.batch_count || 0);
  const batchStock = Number(stockR.rows[0]?.batch_stock || 0);
  const totalStock = batchCount > 0 ? batchStock : storedTotalStock;
  if (totalStock !== storedTotalStock) {
    await dbQuery(dbClient, 'update products set stock = $1 where id = $2', [totalStock, pid]);
  }
  return {
    totalStock,
    batchStock
  };
}

async function releaseReservedStockForOrderItems(items, dbClient = null) {
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    const qty = Number(item?.allocated_qty ?? item?.qty ?? 0);
    if (qty > 0) await restoreInventoryForInvoiceItem(item, qty, dbClient);
  }
}

async function reserveStockForOrderItems(items, dbClient = null, options = null) {
  const allowAutoSupplement = !!options?.allow_auto_supplement;
  const list = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
  for (const item of list) {
    const allocationPlan = normalizeOrderAllocationPlan(item);
    const plannedQty = allocationPlan.reduce((sum, row) => sum + Math.max(0, Number(row?.qty || 0)), 0);
    const allocQty = Math.max(0, Number(plannedQty > 0 ? plannedQty : (item?.allocated_qty ?? item?.qty ?? 0)));
    item.allocated_qty = allocQty;
    item.allocation_plan = allocationPlan;
    item.deductions = [];
    if (allocQty <= 0) continue;

    const pid = await resolveProductIdFromItem(item, dbClient);
    if (!pid) continue;

    const { totalStock, batchStock } = await getProductStockSummary(pid, dbClient, true);
    if (totalStock < allocQty) throw createInsufficientStockError(item, totalStock, allocQty);

    const unlottedAvailable = Math.max(0, totalStock - batchStock);
    const batches = await dbQuery(
      dbClient,
      `select *
       from inventory_batches
       where product_id=$1 and quantity > 0
       order by expiration_date asc, id asc
       ${dbClient ? 'for update' : ''}`,
      [pid]
    );
    const batchRows = batches.rows.map(b => ({
      ...b,
      quantity: Math.max(0, Number(b.quantity || 0))
    }));

    let unlottedRemaining = unlottedAvailable;
    let remaining = allocQty;

    const sumBatchAvailable = (loteValue, expiryValue = '') => {
      const lote = String(loteValue || '').trim();
      const loteKey = normalizeComparableLoteText(lote);
      const expiry = String(expiryValue || '').trim();
      return batchRows.reduce((sum, row) => {
        const rowLote = String(row?.lote || '').trim();
        if (normalizeComparableLoteText(rowLote) !== loteKey) return sum;
        if (expiry && String(row?.expiration_date || '').trim() !== expiry) return sum;
        return sum + Math.max(0, Number(row?.quantity || 0));
      }, 0);
    };

    const takeUnlotted = (qty) => {
      const take = Math.min(Math.max(0, Number(qty || 0)), unlottedRemaining);
      if (take <= 0) return 0;
      unlottedRemaining -= take;
      item.deductions.push({
        batch_id: null,
        qty: take,
        expiry: '',
        lote: ''
      });
      return take;
    };

    const takeFromBatches = (loteValue, expiryValue, qty) => {
      const lote = String(loteValue || '').trim();
      const loteKey = normalizeComparableLoteText(lote);
      const expiry = String(expiryValue || '').trim();
      let left = Math.max(0, Number(qty || 0));
      for (const row of batchRows) {
        if (left <= 0) break;
        const rowLote = String(row?.lote || '').trim();
        if (normalizeComparableLoteText(rowLote) !== loteKey) continue;
        if (expiry && String(row?.expiration_date || '').trim() !== expiry) continue;
        const available = Math.max(0, Number(row.quantity || 0));
        if (available <= 0) continue;
        const take = Math.min(available, left);
        row.quantity = available - take;
        item.deductions.push({
          batch_id: row.id,
          qty: take,
          expiry: row.expiration_date,
          lote: row.lote
        });
        left -= take;
      }
      return Math.max(0, Number(qty || 0)) - left;
    };

    for (const planRow of allocationPlan) {
      const planQty = Math.max(0, Number(planRow?.qty || 0));
      if (planQty <= 0) continue;
      const lote = String(planRow?.lote || '').trim();
      const expiry = String(planRow?.expiry || '').trim();
      if (!lote) {
        if (unlottedRemaining < planQty) throw createInsufficientStockError(item, unlottedRemaining, planQty);
        takeUnlotted(planQty);
      } else {
        const availableExact = sumBatchAvailable(lote, expiry);
        const availableByLote = expiry ? sumBatchAvailable(lote, '') : availableExact;
        const matchedExpiry = availableExact >= planQty ? expiry : '';
        const available = matchedExpiry ? availableExact : Math.max(availableExact, availableByLote);
        if (available < planQty) {
          const shortageQty = Math.max(0, planQty - available);
          const loteKey = normalizeComparableLoteText(lote);
          const supplementRows = [];
          let supplementAvailable = 0;
          for (const row of batchRows) {
            const rowQty = Math.max(0, Number(row?.quantity || 0));
            if (rowQty <= 0) continue;
            if (normalizeComparableLoteText(row?.lote || '') === loteKey) continue;
            supplementRows.push({
              lote: String(row?.lote || '').trim(),
              expiry: String(row?.expiration_date || '').trim(),
              qty: rowQty
            });
            supplementAvailable += rowQty;
            if (supplementAvailable >= shortageQty) break;
          }
          const autoSupplementAvailable = supplementAvailable >= shortageQty && supplementRows.length > 0;
          if (!allowAutoSupplement || !autoSupplementAvailable) {
            throw createInsufficientStockError(item, available, planQty, {
              selected_lote: lote,
              shortage_qty: shortageQty,
              auto_supplement_available: autoSupplementAvailable,
              supplement_lotes: supplementRows.map((row) => row.lote).filter(Boolean)
            });
          }
          let supplemented = takeFromBatches(lote, matchedExpiry, available);
          let supplementLeft = Math.max(0, planQty - supplemented);
          for (const row of batchRows) {
            if (supplementLeft <= 0) break;
            if (normalizeComparableLoteText(row?.lote || '') === loteKey) continue;
            const rowQty = Math.max(0, Number(row?.quantity || 0));
            if (rowQty <= 0) continue;
            const take = Math.min(rowQty, supplementLeft);
            row.quantity = rowQty - take;
            item.deductions.push({
              batch_id: row.id,
              qty: take,
              expiry: row.expiration_date,
              lote: row.lote
            });
            supplementLeft -= take;
          }
          if (supplementLeft > 0) {
            throw createInsufficientStockError(item, available, planQty, {
              selected_lote: lote,
              shortage_qty: shortageQty,
              auto_supplement_available: autoSupplementAvailable,
              supplement_lotes: supplementRows.map((row) => row.lote).filter(Boolean)
            });
          }
          item.__auto_supplemented = true;
        } else {
          takeFromBatches(lote, matchedExpiry, planQty);
        }
      }
      remaining -= planQty;
    }

    if (remaining > 0) {
      remaining -= takeUnlotted(remaining);
    }

    for (const row of batchRows) {
      if (remaining <= 0) break;
      const take = Math.min(Math.max(0, Number(row.quantity || 0)), remaining);
      if (take <= 0) continue;
      row.quantity = Math.max(0, Number(row.quantity || 0) - take);
      item.deductions.push({
        batch_id: row.id,
        qty: take,
        expiry: row.expiration_date,
        lote: row.lote
      });
      remaining -= take;
    }

    if (remaining > 0) throw createInsufficientStockError(item, allocQty - remaining, allocQty);

    await dbQuery(dbClient, 'update products set stock = stock - $1 where id=$2', [allocQty, pid]);
    for (const row of batchRows) {
      const nextQty = Math.max(0, Number(row.quantity || 0));
      const original = batches.rows.find(b => Number(b.id) === Number(row.id));
      const originalQty = Math.max(0, Number(original?.quantity || 0));
      if (originalQty === nextQty) continue;
      await dbQuery(dbClient, 'update inventory_batches set quantity = $1 where id=$2', [nextQty, row.id]);
    }
    if (item.__auto_supplemented) {
      delete item.__auto_supplemented;
    }
    item.qty = allocQty;
    item.lote = extractExplicitLote({
      ...item,
      lote: '',
      deductions: item.deductions,
      allocation_plan: item.allocation_plan
    });
  }
  return list;
}

let pendingDailyOrderStockSyncPromise = null;
let pendingDailyOrderStockSyncAt = 0;

async function reconcilePendingDailyOrderStockReservations(force = false) {
  const now = Date.now();
  if (!force && pendingDailyOrderStockSyncPromise) return pendingDailyOrderStockSyncPromise;
  if (!force && now - pendingDailyOrderStockSyncAt < 3000) return;
  pendingDailyOrderStockSyncPromise = (async () => {
    try {
      const pending = await query(`
        select id
        from daily_orders
        where status in ('allocated', 'ready_to_ship')
          and coalesce(is_manual_logistics,false)=false
          and coalesce(stock_deducted_at, 0) <= 0
        order by id asc
      `);
      for (const row of pending.rows) {
        const orderId = Number(row?.id || 0);
        if (!orderId) continue;
        try {
          await withTransaction(async (client) => {
            const ord = await client.query(`
              select id, items, stock_deducted_at
              from daily_orders
              where id=$1
                and status in ('allocated', 'ready_to_ship')
                and coalesce(is_manual_logistics,false)=false
              for update
            `, [orderId]);
            if (!ord.rows[0] || Number(ord.rows[0].stock_deducted_at || 0) > 0) return;
            const items = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
            const nextItems = await reserveStockForOrderItems(Array.isArray(items) ? items : [], client);
            await client.query(
              'update daily_orders set items=$1, stock_deducted_at=$2, stock_deducted_by=$3 where id=$4',
              [JSON.stringify(nextItems), Date.now(), 'system_reconcile', orderId]
            );
          });
        } catch (err) {
          console.error('reconcile pending daily order stock failed', { orderId, err: err?.message || err });
        }
      }
    } finally {
      pendingDailyOrderStockSyncAt = Date.now();
      pendingDailyOrderStockSyncPromise = null;
    }
  })();
  return pendingDailyOrderStockSyncPromise;
}

async function simulateSplitStock(items) {
  let finalItems = [];
  for (const item of items) {
    const allocQty = Number(item.allocated_qty || 0);
    const originalQty = Number(item.qty || 0);
    const explicitLote = extractExplicitLote(item);
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
        splitItem.lote = String(explicitLote || b.lote || splitItem.lote || '').trim();
        
        if (!explicitLote && !/lote/i.test(splitItem.description || '')) {
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
         splitItem.lote = String(explicitLote || splitItem.lote || '').trim();
         if (!explicitLote && !/lote/i.test(splitItem.description || '')) {
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

async function deductAndSplitStock(items, dbClient = null, options = null) {
  const allowAutoSupplement = !!options?.allow_auto_supplement;
  let finalItems = [];
  for (const item of items) {
    const qty = Number(item.qty || 0);
    const explicitLote = extractExplicitLote(item);
    const explicitLoteKey = normalizeComparableLoteText(explicitLote);
    if (qty <= 0) {
      finalItems.push(item);
      continue;
    }

    const pid = await resolveProductIdFromItem(item, dbClient);
    if (pid) {
      const { totalStock, batchStock } = await getProductStockSummary(pid, dbClient);
      if (totalStock < qty) throw createInsufficientStockError(item, totalStock, qty);
        const unlottedAvailable = explicitLoteKey ? 0 : Math.max(0, totalStock - batchStock);
        const batches = await dbQuery(dbClient, 'select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc, id asc', [pid]);
        const candidateBatches = explicitLoteKey
          ? batches.rows.filter(b => normalizeComparableLoteText(b?.lote || '') === explicitLoteKey)
          : batches.rows;

        if (explicitLoteKey) {
          const loteAvailable = candidateBatches.reduce((sum, row) => sum + Math.max(0, Number(row?.quantity || 0)), 0);
          if (loteAvailable < qty) {
            const shortageQty = Math.max(0, qty - loteAvailable);
            const supplementRows = [];
            let supplementAvailable = 0;
            for (const row of batches.rows) {
              const rowQty = Math.max(0, Number(row?.quantity || 0));
              if (rowQty <= 0) continue;
              if (normalizeComparableLoteText(row?.lote || '') === explicitLoteKey) continue;
              supplementRows.push({
                lote: String(row?.lote || '').trim(),
                expiry: String(row?.expiration_date || '').trim(),
                qty: rowQty
              });
              supplementAvailable += rowQty;
              if (supplementAvailable >= shortageQty) break;
            }
            const autoSupplementAvailable = supplementAvailable >= shortageQty && supplementRows.length > 0;
            if (!allowAutoSupplement || !autoSupplementAvailable) {
              throw createInsufficientStockError(item, loteAvailable, qty, {
                selected_lote: explicitLote,
                shortage_qty: shortageQty,
                auto_supplement_available: autoSupplementAvailable,
                supplement_lotes: supplementRows.map((row) => row.lote).filter(Boolean)
              });
            }
          }
        }

        await dbQuery(dbClient, 'update products set stock = stock - $1 where id=$2', [qty, pid]);

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

      if (explicitLoteKey) {
          const deductions = [];
          for (const b of candidateBatches) {
            if (remaining <= 0) break;
            const take = Math.min(Number(b.quantity), remaining);
            if (take <= 0) continue;
            if (Number(b.quantity) === take) {
              await dbQuery(dbClient, 'update inventory_batches set quantity = 0 where id=$1', [b.id]);
            } else {
              await dbQuery(dbClient, 'update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
            }
            deductions.push({
              batch_id: b.id,
              qty: take,
              expiry: b.expiration_date,
              lote: b.lote
            });
            remaining -= take;
          }
          if (remaining > 0) {
            for (const b of batches.rows) {
              if (remaining <= 0) break;
              if (normalizeComparableLoteText(b?.lote || '') === explicitLoteKey) continue;
              const batchQty = Math.max(0, Number(b?.quantity || 0));
              if (batchQty <= 0) continue;
              const take = Math.min(batchQty, remaining);
              if (Number(b.quantity) === take) {
                await dbQuery(dbClient, 'update inventory_batches set quantity = 0 where id=$1', [b.id]);
              } else {
                await dbQuery(dbClient, 'update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
              }
              deductions.push({
                batch_id: b.id,
                qty: take,
                expiry: b.expiration_date,
                lote: b.lote
              });
              remaining -= take;
            }
          }
          if (remaining > 0) {
            throw createInsufficientStockError(item, qty - remaining, qty, {
              selected_lote: explicitLote,
              shortage_qty: remaining,
              auto_supplement_available: false,
              supplement_lotes: []
            });
          }
          finalItems.push({
            ...item,
            qty,
            lote: String(explicitLote || item?.lote || '').trim(),
            deductions,
            allocation_plan: [{
              lote: String(explicitLote || item?.lote || '').trim(),
              expiry: '',
              qty
            }]
          });
          continue;
      }

      for (const b of candidateBatches) {
        if (remaining <= 0) break;
        const take = Math.min(Number(b.quantity), remaining);

        if (Number(b.quantity) === take) {
          await dbQuery(dbClient, 'update inventory_batches set quantity = 0 where id=$1', [b.id]);
        } else {
          await dbQuery(dbClient, 'update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
        }

        const splitItem = { ...item };
        splitItem.qty = take;
        splitItem.lote = String(explicitLote || b.lote || splitItem.lote || '').trim();

        if (!explicitLote && !/lote/i.test(splitItem.description || '')) {
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
        splitItem.lote = String(explicitLote || splitItem.lote || '').trim();
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
const SUPERADMIN_BOOTSTRAP_PASSWORD = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD || 'Jiangxiao';
const COMPANY_LOAN_CATEGORY = '公司向他人借款';
const COMPANY_REPAYMENT_CATEGORY = '还款（还款给他人）';
const LEGACY_COMPANY_LOAN_CATEGORIES = ['借贷（公司向他人借款）', '借贷(公司向他人借款)', '公司向他人借款'];

function getEffectiveUserRole(name, role = '') {
  return String(name || '').trim() === SUPERADMIN_NAME ? '超级管理员' : String(role || '').trim();
}

function getStoredPasswords(user) {
  const vals = [user?.password, user?.password_hash]
    .map(x => String(x || '').trim())
    .filter(Boolean);
  return Array.from(new Set(vals));
}

function normalizeUserLocale(locale) {
  return String(locale || '').trim() === 'es-ES' ? 'es-ES' : 'zh-CN';
}

function normalizeFinancialEditOverrideSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ledger_force_edit_enabled: !!source.ledger_force_edit_enabled,
    payables_force_edit_enabled: !!source.payables_force_edit_enabled
  };
}

async function getFinancialEditOverrideSettings() {
  const r = await query('select setting_value from system_settings where setting_key=$1 limit 1', ['financial_edit_overrides']);
  return normalizeFinancialEditOverrideSettings(r.rows[0]?.setting_value || {});
}

function canForceEditFinancialModule(user = {}, settings = {}, moduleName = '') {
  const currentUser = String(user?.name || '').trim();
  if (!currentUser || currentUser !== SUPERADMIN_NAME) return false;
  if (String(moduleName || '').trim() === 'ledger') return !!settings.ledger_force_edit_enabled;
  if (String(moduleName || '').trim() === 'payables') return !!settings.payables_force_edit_enabled;
  return false;
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
    const incomeChildren = ['服务收入(现金)','服务收入(银行)','银行储蓄',COMPANY_LOAN_CATEGORY,'订单收入','其它收入'];
    const expenseChildren = ['现金开支','员工工资','出差补贴','人工开支',COMPANY_REPAYMENT_CATEGORY,'其它开支'];
    await query('insert into categories(name, children) values($1,$2)', ['收入', JSON.stringify(incomeChildren)]);
    await query('insert into categories(name, children) values($1,$2)', ['开支', JSON.stringify(expenseChildren)]);
  }
  const incomeCategory = await query('select children from categories where name=$1 limit 1', ['收入']);
  if (incomeCategory.rows[0]) {
    const children = Array.isArray(incomeCategory.rows[0].children) ? incomeCategory.rows[0].children : [];
    const nextChildren = [...new Set(children.map((item) => LEGACY_COMPANY_LOAN_CATEGORIES.includes(String(item || '').trim()) ? COMPANY_LOAN_CATEGORY : String(item || '').trim()).filter(Boolean))];
    if (!nextChildren.includes(COMPANY_LOAN_CATEGORY)) nextChildren.splice(Math.min(3, nextChildren.length), 0, COMPANY_LOAN_CATEGORY);
    await query('update categories set children=$1 where name=$2', [JSON.stringify(nextChildren), '收入']);
  }
  await query('update ledger set category=$1 where category = any($2::text[])', [COMPANY_LOAN_CATEGORY, LEGACY_COMPANY_LOAN_CATEGORIES]);
  const expenseCategory = await query('select children from categories where name=$1 limit 1', ['开支']);
  if (expenseCategory.rows[0]) {
    const children = Array.isArray(expenseCategory.rows[0].children) ? expenseCategory.rows[0].children : [];
    if (!children.includes(COMPANY_REPAYMENT_CATEGORY)) children.splice(Math.min(4, children.length), 0, COMPANY_REPAYMENT_CATEGORY);
    await query('update categories set children=$1 where name=$2', [JSON.stringify([...new Set(children)]), '开支']);
  }
  const a1 = await query('select count(*)::int as c from accounts', []);
  if (a1.rows[0].c === 0) {
    const now = new Date().toISOString().slice(0,19).replace('T',' ');
    await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', ['现金账户', 'Cuenta de efectivo', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', ['银行账户 BBVA', 'Cuenta bancaria BBVA', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', ['银行账户 Santander', 'Cuenta bancaria Santander', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', ['人民币账号1', 'Cuenta RMB 1', 0, '系统预置账户', now, false]);
    await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', ['人民币账户 中智', 'Cuenta RMB Zhongzhi', 0, '系统预置账户', now, false]);
  }
  // Ensure named preset accounts exist even if table not empty
  const presetAccounts = [
    ['现金账户', 'Cuenta de efectivo'],
    ['银行账户 BBVA', 'Cuenta bancaria BBVA'],
    ['银行账户 Santander', 'Cuenta bancaria Santander'],
    ['人民币账号1', 'Cuenta RMB 1'],
    ['人民币账户 中智', 'Cuenta RMB Zhongzhi']
  ];
  for (const [nm, nmEs] of presetAccounts) {
    const r = await query('select count(*)::int as c from accounts where name=$1', [nm]);
    if (r.rows[0].c === 0) {
      const now2 = new Date().toISOString().slice(0,19).replace('T',' ');
      await query('insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6)', [nm, nmEs, 0, '系统预置账户', now2, false]);
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
  req.user = { name: payload.name, role: getEffectiveUserRole(payload.name, payload.role) };
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

const DAILY_ORDER_ACTION_DEFS = [
  { key: 'enable_allocation', label: '可配货' },
  { key: 'allocate', label: '配货' },
  { key: 'ready_to_ship', label: '可发货' },
  { key: 'contact_logistics', label: '联系物流' },
  { key: 'ship', label: '确认已发货' },
  { key: 'ship_without_voucher', label: '允许不上传图片确认已发货' }
];
const DAILY_ORDER_ACTION_KEYS = DAILY_ORDER_ACTION_DEFS.map(item => item.key);

function emptyDailyOrderActionAssignments() {
  return DAILY_ORDER_ACTION_KEYS.reduce((acc, key) => {
    acc[key] = '';
    return acc;
  }, {});
}

function emptyDailyOrderActionCounts() {
  return DAILY_ORDER_ACTION_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

async function getDailyOrderActionAssignments(dbClient = null) {
  const assignments = emptyDailyOrderActionAssignments();
  const foundKeys = new Set();
  const r = await dbQuery(
    dbClient,
    'select action_key, assigned_to from order_action_assignments where action_key = any($1::text[])',
    [DAILY_ORDER_ACTION_KEYS]
  );
  r.rows.forEach((row) => {
    const key = String(row?.action_key || '').trim();
    if (Object.prototype.hasOwnProperty.call(assignments, key)) {
      assignments[key] = normalizeNameList(row?.assigned_to).join(',');
      foundKeys.add(key);
    }
  });
  if (!foundKeys.has('ship_without_voucher')) {
    assignments.ship_without_voucher = 'aaaaaa';
  }
  return assignments;
}

async function saveDailyOrderActionAssignments(payload = {}, userName = '', dbClient = null) {
  const next = emptyDailyOrderActionAssignments();
  Object.keys(next).forEach((key) => {
    next[key] = normalizeNameList(payload?.[key]).join(',');
  });
  const now = Date.now();
  for (const key of DAILY_ORDER_ACTION_KEYS) {
    await dbQuery(
      dbClient,
      `insert into order_action_assignments(action_key, assigned_to, updated_at, updated_by)
       values($1,$2,$3,$4)
       on conflict (action_key)
       do update set assigned_to=excluded.assigned_to, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      [key, next[key], now, String(userName || '').trim()]
    );
  }
  return next;
}

function canUserHandleDailyOrderAction(user = {}, actionKey = '', assignments = {}) {
  const roleName = String(user?.role || '').trim();
  if (roleName === '超级管理员') return true;
  const currentUser = String(user?.name || '').trim();
  const assignedTo = normalizeNameList(assignments?.[actionKey]);
  if (!assignedTo.length) return true;
  return !!currentUser && assignedTo.includes(currentUser);
}

async function requireDailyOrderActionAccess(req, res, actionKey) {
  const assignments = await getDailyOrderActionAssignments();
  if (canUserHandleDailyOrderAction(req?.user || {}, actionKey, assignments)) return assignments;
  res.status(403).json({
    error: 'action_assigned_to_other',
    action: actionKey,
    assigned_to: normalizeNameList(assignments?.[actionKey]).join(',')
  });
  return null;
}

function canUserSkipShipVoucher(user = {}, assignments = {}) {
  const currentUser = String(user?.name || '').trim();
  if (!currentUser) return false;
  const assignedTo = normalizeNameList(assignments?.ship_without_voucher);
  return assignedTo.includes(currentUser);
}

async function getDailyOrderPendingOpsForUser(user = {}, dbClient = null) {
  const currentUser = String(user?.name || '').trim();
  const assignments = await getDailyOrderActionAssignments(dbClient);
  const counts = emptyDailyOrderActionCounts();
  if (!currentUser) return { total: 0, counts, assignments };

  const countBySql = async (sql, params = []) => {
    const r = await dbQuery(dbClient, sql, params);
    return Number(r.rows?.[0]?.c || 0) || 0;
  };

  if (normalizeNameList(assignments.enable_allocation).includes(currentUser)) {
    counts.enable_allocation = await countBySql(
      `select count(*)::int as c
       from daily_orders
       where coalesce(is_manual_logistics,false)=false
         and status='new'
         and coalesce(allocation_enabled,false)=false`
    );
  }
  if (normalizeNameList(assignments.allocate).includes(currentUser)) {
    counts.allocate = await countBySql(
      `select count(*)::int as c
       from daily_orders
       where coalesce(is_manual_logistics,false)=false
         and status='new'
         and coalesce(allocation_enabled,false)=true`
    );
  }
  if (normalizeNameList(assignments.ready_to_ship).includes(currentUser)) {
    counts.ready_to_ship = await countBySql(
      `select count(*)::int as c
       from daily_orders
       where coalesce(is_manual_logistics,false)=false
         and status='allocated'`
    );
  }
  if (normalizeNameList(assignments.contact_logistics).includes(currentUser)) {
    counts.contact_logistics = await countBySql(
      `select count(*)::int as c
       from daily_orders
       where coalesce(is_manual_logistics,false)=false
         and status='ready_to_ship'
         and coalesce(logistics_status,'') <> 'pickup_pending'`
    );
  }
  if (normalizeNameList(assignments.ship).includes(currentUser)) {
    counts.ship = await countBySql(
      `select count(*)::int as c
       from daily_orders
       where coalesce(is_manual_logistics,false)=false
         and status='ready_to_ship'`
    );
  }

  return {
    total: Object.values(counts).reduce((sum, value) => sum + (Number(value || 0) || 0), 0),
    counts,
    assignments
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getDayStartTsByOffset(nowTs = Date.now(), tzOffsetMinutes = 0) {
  const offsetMs = Number(tzOffsetMinutes || 0) * 60 * 1000;
  const localTs = Number(nowTs || Date.now()) - offsetMs;
  const d = new Date(localTs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + offsetMs;
}

function getWeekStartTs(offsetWeeks = 0, nowTs = Date.now(), tzOffsetMinutes = 0) {
  const offsetMs = Number(tzOffsetMinutes || 0) * 60 * 1000;
  const dayStartTs = getDayStartTsByOffset(nowTs, tzOffsetMinutes);
  const localDay = new Date(dayStartTs - offsetMs).getUTCDay();
  const diff = localDay === 0 ? -6 : 1 - localDay;
  return dayStartTs + diff * DAY_MS + offsetWeeks * 7 * DAY_MS;
}

function parsePlanDateInput(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0;
  const [year, month, day] = text.split('-').map(v => parseInt(v, 10));
  const ts = Date.UTC(year, month - 1, day);
  return Number.isFinite(ts) ? ts : 0;
}

function getPlanRange(row = {}) {
  const start = Number(row.plan_start || row.week_start || 0);
  const end = Number(row.plan_end || row.plan_start || row.week_start || 0);
  return { start, end: end >= start ? end : start };
}

function buildProductionPlanGroupKey(seedValue = Date.now()) {
  const base = Number(seedValue || Date.now()) || Date.now();
  return `plan-${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function getProductionPlanGroupKey(row = {}) {
  const raw = String(row.plan_group_key || '').trim();
  if (raw) return raw;
  return `legacy-${Number(row.week_start || 0)}-${String(row.created_by || '').trim()}-${Number(row.created_at || row.id || 0)}`;
}

function groupProductionPlansByWeek(list = []) {
  const groups = new Map();
  (Array.isArray(list) ? list : []).forEach(item => {
    const weekStart = Number(item.week_start || getPlanRange(item).start || 0);
    const key = getProductionPlanGroupKey(item);
    const range = getPlanRange(item);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        plan_group_key: key,
        plan_start: range.start,
        plan_end: range.end,
        week_start: weekStart,
        items: []
      });
    }
    const group = groups.get(key);
    group.plan_start = group.plan_start > 0 ? Math.min(group.plan_start, range.start) : range.start;
    group.plan_end = Math.max(group.plan_end, range.end);
    group.items.push(item);
  });
  return Array.from(groups.values()).sort((a, b) => {
    if (a.week_start !== b.week_start) return a.week_start - b.week_start;
    return a.plan_start - b.plan_start;
  });
}

function getProductionPlanCycleKey(row = {}) {
  const range = getPlanRange(row);
  const weekStart = Number(row.week_start || range.start || 0);
  return `cycle-${weekStart}-${range.start}-${range.end}`;
}

function mergeProductionPlanGroupsByCycle(list = []) {
  const rawGroups = groupProductionPlansByWeek(list);
  const cycleWindowMs = 10 * 60 * 1000;
  const createdAtOf = group => {
    const values = (Array.isArray(group.items) ? group.items : [])
      .map(item => Number(item.created_at || 0))
      .filter(ts => ts > 0);
    return values.length ? Math.min(...values) : 0;
  };
  const createdByOf = group => String(group.items?.[0]?.created_by || '').trim();
  const samePeriod = (a, b) => {
    return Number(a.plan_start || 0) === Number(b.plan_start || 0)
      && Number(a.plan_end || a.plan_start || 0) === Number(b.plan_end || b.plan_start || 0);
  };
  const sortedGroups = rawGroups.slice().sort((a, b) => {
    if (a.week_start !== b.week_start) return a.week_start - b.week_start;
    const createdDiff = createdAtOf(a) - createdAtOf(b);
    if (createdDiff !== 0) return createdDiff;
    return Number(a.plan_start || 0) - Number(b.plan_start || 0);
  });
  const cycleGroups = [];
  sortedGroups.forEach(group => {
    const groupWeekStart = Number(group.week_start || 0);
    const groupCreatedAt = createdAtOf(group);
    const groupCreatedBy = createdByOf(group);
    const target = cycleGroups.find(candidate => {
      if (Number(candidate.week_start || 0) !== groupWeekStart) return false;
      if (String(candidate.created_by || '') !== groupCreatedBy) return false;
      if (samePeriod(candidate, group)) return true;
      const candidateCreatedAt = Number(candidate.created_at || 0);
      if (!candidateCreatedAt || !groupCreatedAt) return false;
      return Math.abs(candidateCreatedAt - groupCreatedAt) <= cycleWindowMs;
    });
    if (target) {
      const nextStart = Number(group.plan_start || 0);
      const nextEnd = Number(group.plan_end || group.plan_start || 0);
      if (nextStart > 0) {
        target.plan_start = target.plan_start > 0 ? Math.min(target.plan_start, nextStart) : nextStart;
      }
      if (nextEnd > 0) {
        target.plan_end = target.plan_end > 0 ? Math.max(target.plan_end, nextEnd) : nextEnd;
      }
      target.created_at = target.created_at > 0 && groupCreatedAt > 0
        ? Math.min(target.created_at, groupCreatedAt)
        : (target.created_at || groupCreatedAt || 0);
      target.items.push(...(Array.isArray(group.items) ? group.items : []));
      return;
    }
    cycleGroups.push({
      key: getProductionPlanCycleKey(group),
      plan_start: Number(group.plan_start || 0),
      plan_end: Number(group.plan_end || group.plan_start || 0),
      week_start: groupWeekStart,
      created_at: groupCreatedAt,
      created_by: groupCreatedBy,
      items: Array.isArray(group.items) ? group.items.slice() : []
    });
  });
  return cycleGroups
    .map(group => ({
      ...group,
      items: (Array.isArray(group.items) ? group.items : []).slice().sort((a, b) => {
        const sortA = Number(a.sort_order || 0);
        const sortB = Number(b.sort_order || 0);
        if (sortA !== sortB) return sortA - sortB;
        const startA = Number(a.plan_start || a.week_start || 0);
        const startB = Number(b.plan_start || b.week_start || 0);
        if (startA !== startB) return startA - startB;
        const createdA = Number(a.created_at || 0);
        const createdB = Number(b.created_at || 0);
        if (createdA !== createdB) return createdA - createdB;
        return Number(a.id || 0) - Number(b.id || 0);
      })
    }))
    .sort((a, b) => {
      if (a.week_start !== b.week_start) return a.week_start - b.week_start;
      return a.plan_start - b.plan_start;
    });
}

function splitProductionPlanGroups(list = []) {
  const groups = mergeProductionPlanGroupsByCycle(list);
  const activeGroups = [];
  const completedGroups = [];
  groups.forEach(group => {
    const allConfirmed = group.items.length > 0 && group.items.every(item => String(item.status || '') === 'confirmed');
    if (allConfirmed) completedGroups.push(group);
    else activeGroups.push(group);
  });
  return { activeGroups, completedGroups };
}

function ensureAllow(module, action) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error:'unauthorized' });
    const roleName = req.user.role || '';
    if (roleName === '超级管理员') return next();

    const perms = await getRolePerms(roleName);
    const moduleName = String(module || '').trim();
    const modPerms = moduleName === 'employee_checkin'
      ? (perms.employee_checkin || perms.warehouse_production || {})
      : (perms[moduleName] || {});
    if (action === 'view') {
      if (modPerms.view) return next();
    } else if (action === 'assigned_only') {
      if (modPerms.assigned_only) return next();
    } else if (['update', 'delete', 'confirm'].includes(action)) {
      const hasGranularRecordPerm = ['update', 'delete', 'confirm'].some(act => Object.prototype.hasOwnProperty.call(modPerms, act));
      if (hasGranularRecordPerm) {
        if (modPerms[action]) return next();
      } else if (action === 'update') {
        if (modPerms.edit || modPerms[action]) return next();
      } else if (modPerms[action]) {
        return next();
      }
    } else {
      if (modPerms.edit || modPerms[action]) return next();
    }
    return res.status(403).json({ error:'forbidden' });
  };
}
function ensureAdmin(req, res, next) {
  const isNamedSuperAdmin = String(req.user?.name || '').trim() === 'aaaaaa';
  if ((req.user?.role || '') !== '超级管理员' && !isNamedSuperAdmin) return res.status(403).json({ error:'forbidden' });
  next();
}
function ensureShareholderView(req, res, next) {
  const role = getEffectiveUserRole(req.user?.name, req.user?.role);
  if (role === '超级管理员' || role === '股东') return next();
  return res.status(403).json({ error: 'forbidden' });
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
  const r = await query('select id, name, role, enabled, password, password_hash, locale from users where name=$1', [name]);
  const u = r.rows[0];
  const inputPassword = String(password || '');
  const storedPasswords = getStoredPasswords(u);
  if (!u || !u.enabled || !storedPasswords.includes(inputPassword)) return res.status(401).json({ error:'bad_credentials' });
  if (storedPasswords.length > 1 || String(u?.password || '') !== inputPassword || String(u?.password_hash || '') !== inputPassword) {
    await syncUserPasswordFields(u.id, inputPassword);
  }
  const locale = normalizeUserLocale(u.locale);
  const effectiveRole = getEffectiveUserRole(u.name, u.role);
  const token = signJwt({ name: u.name, role: effectiveRole, locale }, 24*3600);
  res.json({ token, user: { name: u.name, role: effectiveRole, locale } });
});
app.get('/api/daily-orders/action-assignments', authRequired, async (req, res) => {
  const assignments = await getDailyOrderActionAssignments();
  res.json({
    actions: DAILY_ORDER_ACTION_DEFS,
    assignments,
    can_edit: String(req.user?.role || '') === '超级管理员'
  });
});
app.put('/api/daily-orders/action-assignments', authRequired, ensureAdmin, async (req, res) => {
  const assignments = await saveDailyOrderActionAssignments(req.body || {}, req.user?.name || '');
  res.json({ ok: true, assignments });
});
app.get('/api/daily-orders/pending-ops', authRequired, async (req, res) => {
  const result = await getDailyOrderPendingOpsForUser(req.user || {});
  res.json({
    actions: DAILY_ORDER_ACTION_DEFS,
    total: result.total,
    counts: result.counts,
    assignments: result.assignments
  });
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
  try {
    const r = await query('select name, role, locale from users where name=$1 limit 1', [req.user?.name || '']);
    const u = r.rows[0];
    if (!u) return res.json({ user: req.user });
    res.json({ user: { name: u.name, role: getEffectiveUserRole(u.name, u.role), locale: normalizeUserLocale(u.locale) } });
  } catch (e) {
    console.error(e);
    res.json({ user: req.user });
  }
});

function roundMoneyValue(val) {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeInvoiceDiscountValue(rawValue, fallback = 0) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  if (value > 0 && value < 1) value *= 100;
  return Math.max(0, Math.min(100, value));
}

function getInvoiceDiscountFactor(rawValue, fallback = 0) {
  return 1 - normalizeInvoiceDiscountValue(rawValue, fallback) / 100;
}

function getInvoiceItemNetAmount(item = {}) {
  const qty = Number(item?.qty || 0);
  const price = Number(item?.price || 0);
  return qty * price * getInvoiceDiscountFactor(item?.discount, 0);
}
function normalizeInvoiceManualDiscountAmount(rawValue, fallback = 0) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  return Math.max(0, roundMoneyValue(value));
}
function computeInvoiceTotalAmount(items = [], manualDiscountAmount = 0) {
  const itemsTotal = roundMoneyValue((Array.isArray(items) ? items : []).reduce((sum, item) => {
    let taxRate = Number(item?.tax_rate);
    if (isNaN(taxRate) || item?.tax_rate === undefined || item?.tax_rate === null || item?.tax_rate === '') {
      taxRate = 0.10;
    }
    if (taxRate >= 1) taxRate = taxRate / 100;
    const rowVal = getInvoiceItemNetAmount(item);
    const rowTax = rowVal * taxRate;
    return sum + rowVal + rowTax;
  }, 0));
  return Math.max(0, roundMoneyValue(itemsTotal - normalizeInvoiceManualDiscountAmount(manualDiscountAmount, 0)));
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
    file: String(rec.file || ''),
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
  let sql = 'select * from payables p';
  const conds = [
    `not (
      p.type='应收账款'
      and (
        p.doc ilike 'Albaran-%'
        or coalesce(p.invoice_no, '') ilike 'Albaran-%'
        or exists (
          select 1
          from invoices i
          where i.invoice_no = p.doc
            and coalesce(i.invoice_type, 'factura') = 'albaran'
        )
      )
    )`
  ];
  if (type && (type === '应收账款' || type === '应付账款')) { params.push(type); conds.push(`p.type=$${params.length}`); }
  if (q) { params.push(`%${q}%`); conds.push(`(p.partner ilike $${params.length} or p.doc ilike $${params.length})`); }
  if (conds.length) sql += ' where ' + conds.join(' and ');
  sql += ' order by p.batch_at desc nulls last, p.batch_order asc nulls last, p.created_at desc';
  const r = await query(sql, params);
  res.json(r.rows);
});

app.post('/api/payables', authRequired, ensureAllow('payables','create'), async (req, res) => {
  const p = normalizePayable({ ...req.body, source: req.body.source || 'manual' });
  if (!p.type || !p.partner || !p.doc || !p.amount) return res.status(400).json({ error: 'bad_request' });
  // upsert by (type, doc)
  const r = await query(`
    insert into payables(type,partner,doc,amount,paid,settled,trust_days,notes,file,invoice_no,invoice_date,invoice_amount,sales,date,created_at,batch_at,batch_order,source,history,confirmed)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    on conflict (type, doc) do update set
      partner=excluded.partner,
      amount=excluded.amount,
      paid=excluded.paid,
      settled=excluded.settled,
      trust_days=excluded.trust_days,
      notes=excluded.notes,
      file=excluded.file,
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
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.file,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed]);
  res.json({ id: r.rows[0].id });
});

app.post('/api/payables/import', authRequired, ensureAllow('payables','import'), async (req, res) => {
  const list = Array.isArray(req.body.records) ? req.body.records : [];
  let inserted = 0, updated = 0;
  for (const rec of list) {
    const p = normalizePayable(rec);
    if (!p.type || !p.partner || !p.doc || !p.amount) continue;
    const r = await query(`
      insert into payables(type,partner,doc,amount,paid,settled,trust_days,notes,file,invoice_no,invoice_date,invoice_amount,sales,date,created_at,batch_at,batch_order,source,history,confirmed)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      on conflict (type, doc) do update set
        partner=excluded.partner,
        amount=excluded.amount,
        paid=excluded.paid,
        settled=excluded.settled,
        trust_days=excluded.trust_days,
        notes=excluded.notes,
        file=excluded.file,
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
    `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.file,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed]);
    if (r.rows[0]?.inserted) inserted++; else updated++;
  }
  res.json({ inserted, updated });
});
app.put('/api/payables/:id', authRequired, ensureAllow('payables','update'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const current = (await query('select id, confirmed from payables where id=$1 limit 1', [id])).rows[0];
  if (!current) return res.status(404).json({ error:'not_found' });
  const overrideSettings = current.confirmed ? await getFinancialEditOverrideSettings() : normalizeFinancialEditOverrideSettings();
  const canForceEditConfirmed = !!current.confirmed && canForceEditFinancialModule(req.user, overrideSettings, 'payables');
  if (current.confirmed && !canForceEditConfirmed) return res.status(400).json({ error:'not_editable' });
  const p = normalizePayable({ ...req.body, confirmed: current.confirmed ? true : false });
  const r = await query(`
    update payables set
      type=$1, partner=$2, doc=$3, amount=$4, paid=$5, settled=$6, trust_days=$7,
      notes=$8, file=$9, invoice_no=$10, invoice_date=$11, invoice_amount=$12, sales=$13,
      date=$14, created_at=$15, batch_at=$16, batch_order=$17, source=$18, history=$19, confirmed=$20
    where id=$21 and (confirmed=false or $22::boolean=true)
    returning id
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.file,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed,id,canForceEditConfirmed]);
  if (!r.rows[0]) return res.status(400).json({ error:'not_editable' });
  res.json({ ok: true });
});
app.put('/api/payables/:id/special-treatment', authRequired, ensureAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const specialStatus = String(req.body?.specialStatus || '').trim();
  if (!['逃单', '作废'].includes(specialStatus)) {
    return res.status(400).json({ error: 'invalid_special_status' });
  }
  const current = (await query(
    'select id, history, special_status from payables where id=$1 limit 1',
    [id]
  )).rows[0];
  if (!current) return res.status(404).json({ error: 'not_found' });
  if (['逃单', '作废'].includes(String(current.special_status || '').trim())) {
    return res.status(400).json({ error: 'already_special_treated' });
  }
  const now = new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const history = Array.isArray(current.history) ? current.history.slice() : [];
  history.push({
    date: dt,
    user: String(req.user?.name || ''),
    kind: specialStatus,
    amount: 0
  });
  const result = await query(`
    update payables
    set special_status=$1, settled=true, history=$2
    where id=$3 and coalesce(special_status, '')=''
    returning id, special_status, settled
  `, [specialStatus, JSON.stringify(history), id]);
  if (!result.rows[0]) return res.status(400).json({ error: 'already_special_treated' });
  res.json({ ok: true, ...result.rows[0] });
});
app.put('/api/payables/:id/refund', authRequired, ensureAllow('payables','update'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const p = normalizePayable(req.body || {});
  const r = await query(`
    update payables set
      type=$1, partner=$2, doc=$3, amount=$4, paid=$5, settled=$6, trust_days=$7,
      notes=$8, file=$9, invoice_no=$10, invoice_date=$11, invoice_amount=$12, sales=$13,
      date=$14, created_at=$15, batch_at=$16, batch_order=$17, source=$18, history=$19, confirmed=$20
    where id=$21
    returning id
  `, [p.type,p.partner,p.doc,p.amount,p.paid,p.settled,p.trust_days,p.notes,p.file,p.invoice_no,p.invoice_date,p.invoice_amount,p.sales,p.date,p.created_at,p.batch_at,p.batch_order,p.source,JSON.stringify(p.history),p.confirmed,id]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true });
});
app.put('/api/payables/:id/file', authRequired, ensureAllow('payables','update'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const { file = '' } = req.body || {};
  const r = await query(`
    update payables set file=$1
    where id=$2
    returning id, file
  `, [String(file || ''), id]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true, file: r.rows[0].file || '' });
});
app.put('/api/payables/:id/confirm', authRequired, ensureAllow('payables','confirm'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r0 = await query('select amount, history, confirmed from payables where id=$1', [id]);
  const row = r0.rows[0];
  if (!row || row.confirmed === true) return res.status(404).json({ error:'not_found' });
  const now = new Date();
  const dt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const user = String(req.user?.name || '');
  const history = Array.isArray(row.history) ? row.history.slice() : [];
  history.push({ date: dt, user, kind: '确认', amount: roundMoneyValue(row.amount || 0) });
  const r = await query('update payables set confirmed=true, confirmed_by=$2, confirmed_at=$3, history=$4 where id=$1 and confirmed=false returning id', [id, user, dt, JSON.stringify(history)]);
  if (!r.rows[0]) return res.status(404).json({ error:'not_found' });
  res.json({ ok: true });
});
app.delete('/api/payables/:id', authRequired, ensureAllow('payables','delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('delete from payables where id=$1 and confirmed=false returning id', [id]);
  if (!r.rows[0]) return res.status(400).json({ error:'not_deletable_or_not_found' });
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
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large', limit: MAX_UPLOAD_FILE_SIZE });
    }
    return res.status(400).json({ error: err.code || 'upload_error' });
  }
  next(err);
});
app.get('/api/public/products', async (req, res) => {
  const { page = '1', size = '50', q = '' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(size, 10) || 20));
  let sql = 'select id, sku, name, name_cn, image, stock, print_small_label_enabled, print_small_label_copies, print_large_label_enabled, print_large_label_copies from products';
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
    `select id, product_id, confirmed_plan_id, product_name, product_name_cn, product_image, lote, expiration_date, box_count, print_note, print_small_label, print_small_label_copies, print_large_label, print_large_label_copies, photo_url, created_at
     from production_entries${where}
     order by created_at desc, id desc
     limit $${params.length}`,
    params
  );
  res.json(r.rows);
});
app.get('/api/public/production-plans/confirmed', async (req, res) => {
  const size = Math.max(1, Math.min(100, parseInt(req.query.size, 10) || 30));
  const r = await query(
    `select
       p.id,
       p.product_id,
       p.product_name,
       coalesce(prod.name_cn, '') as product_name_cn,
       coalesce(prod.image, '') as product_image,
       p.material_name,
       p.material_qty,
       p.confirmed_at,
       p.confirmed_by,
       p.plan_start,
       p.plan_end,
       p.week_start
     from production_plans p
     left join products prod on prod.id = p.product_id
     where p.status='confirmed'
     order by p.confirmed_at desc nulls last, p.id desc
     limit $1`,
    [size]
  );
  res.json(r.rows || []);
});
app.post('/api/public/production-entries', async (req, res) => {
  const x = req.body || {};
  const productId = Number(x.product_id || 0);
  const confirmedPlanId = Number(x.confirmed_plan_id || 0);
  const boxCount = Number(x.box_count || 0);
  const printNote = String(x.print_note || '').trim();
  const printSmallLabel = !!x.print_small_label;
  const printSmallLabelCopies = printSmallLabel ? Math.max(1, parseInt(x.print_small_label_copies, 10) || 1) : 0;
  const printLargeLabel = !!x.print_large_label;
  const printLargeLabelCopies = printLargeLabel ? Math.max(1, parseInt(x.print_large_label_copies, 10) || 1) : 0;
  const photoUrl = String(x.photo_url || '').trim();
  if (!productId || !Number.isFinite(boxCount) || boxCount <= 0) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const prod = await query('select id, name, name_cn, image from products where id=$1', [productId]);
  if (!prod.rows[0]) return res.status(404).json({ error: 'product_not_found' });
  const p = prod.rows[0];
  const now = Date.now();
  const r = await query(
    `insert into production_entries(
      product_id, confirmed_plan_id, product_name, product_name_cn, product_image, lote, expiration_date, box_count, print_note, print_small_label, print_small_label_copies, print_large_label, print_large_label_copies, photo_url, status, created_at, created_by
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16) returning id`,
    [
      productId,
      confirmedPlanId > 0 ? confirmedPlanId : null,
      p.name || '',
      p.name_cn || '',
      p.image || '',
      String(x.lote || '').trim(),
      String(x.expiration_date || '').trim(),
      boxCount,
      printNote,
      printSmallLabel,
      printSmallLabelCopies,
      printLargeLabel,
      printLargeLabelCopies,
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
  const confirmedPlanId = Number(x.confirmed_plan_id || 0);
  const boxCount = Number(x.box_count || 0);
  const printNote = String(x.print_note || '').trim();
  const printSmallLabel = !!x.print_small_label;
  const printSmallLabelCopies = printSmallLabel ? Math.max(1, parseInt(x.print_small_label_copies, 10) || 1) : 0;
  const printLargeLabel = !!x.print_large_label;
  const printLargeLabelCopies = printLargeLabel ? Math.max(1, parseInt(x.print_large_label_copies, 10) || 1) : 0;
  const photoUrl = String(x.photo_url || '').trim();
  if (!id || !productId || !Number.isFinite(boxCount) || boxCount <= 0) {
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
      confirmed_plan_id=$2,
      product_name=$3,
      product_name_cn=$4,
      product_image=$5,
      lote=$6,
      expiration_date=$7,
      box_count=$8,
      print_note=$9,
      print_small_label=$10,
      print_small_label_copies=$11,
      print_large_label=$12,
      print_large_label_copies=$13,
      photo_url=$14
     where id=$15`,
    [
      productId,
      confirmedPlanId > 0 ? confirmedPlanId : null,
      p.name || '',
      p.name_cn || '',
      p.image || '',
      String(x.lote || '').trim(),
      String(x.expiration_date || '').trim(),
      boxCount,
      printNote,
      printSmallLabel,
      printSmallLabelCopies,
      printLargeLabel,
      printLargeLabelCopies,
      photoUrl,
      id
    ]
  );
  res.json({ ok: true });
});

app.get('/api/employee-checkin/employees', authRequired, ensureAllow('employee_checkin', 'view'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const enabled = String(req.query.enabled || '').trim();
  const params = [];
  const where = [];
  if (enabled === '1' || enabled === 'true') {
    where.push('coalesce(enabled, true) = true');
  } else if (enabled === '0' || enabled === 'false') {
    where.push('coalesce(enabled, true) = false');
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      coalesce(name, '') ilike $${params.length}
      or coalesce(employee_no, '') ilike $${params.length}
      or coalesce(phone, '') ilike $${params.length}
    )`);
  }
  const sql = `
    select id, name, employee_no, phone, coalesce(enabled, true) as enabled, created_at, created_by, updated_at, updated_by
      from employee_checkin_employees
      ${where.length ? 'where ' + where.join(' and ') : ''}
     order by
       case when trim(coalesce(employee_no, '')) ~ '^[0-9]+$' then 0 else 1 end asc,
       case when trim(coalesce(employee_no, '')) ~ '^[0-9]+$' then trim(employee_no)::int else null end asc nulls last,
       lower(trim(coalesce(employee_no, ''))) asc,
       lower(coalesce(name, '')) asc,
       id asc
  `;
  const r = await query(sql, params);
  res.json(r.rows || []);
});

app.post('/api/employee-checkin/employees', authRequired, ensureAllow('employee_checkin', 'edit'), async (req, res) => {
  const x = req.body || {};
  const name = String(x.name || '').trim();
  const employeeNo = String(x.employee_no || '').trim();
  const phone = normalizeEmployeeCheckinPassword(x.phone || '');
  const enabled = x.enabled === undefined ? true : String(x.enabled) !== 'false';
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!isValidEmployeeCheckinPassword(phone)) return res.status(400).json({ error: 'invalid_password' });
  const now = Date.now();
  const r = await query(
    `insert into employee_checkin_employees(name, employee_no, phone, enabled, created_at, created_by, updated_at, updated_by)
     values($1,$2,$3,$4,$5,$6,$5,$6)
     returning id, name, employee_no, phone, coalesce(enabled, true) as enabled, created_at, created_by, updated_at, updated_by`,
    [name, employeeNo, phone, enabled, now, req.user.name || 'system']
  );
  res.json(r.rows[0] || null);
});

app.put('/api/employee-checkin/employees/:id', authRequired, ensureAllow('employee_checkin', 'edit'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'bad_request' });
  const current = await query('select id from employee_checkin_employees where id=$1', [id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });
  const x = req.body || {};
  const name = String(x.name || '').trim();
  const employeeNo = String(x.employee_no || '').trim();
  const phone = normalizeEmployeeCheckinPassword(x.phone || '');
  const enabled = String(x.enabled) === 'false' ? false : Boolean(x.enabled);
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!isValidEmployeeCheckinPassword(phone)) return res.status(400).json({ error: 'invalid_password' });
  const now = Date.now();
  const r = await query(
    `update employee_checkin_employees
        set name=$1, employee_no=$2, phone=$3, enabled=$4, updated_at=$5, updated_by=$6
      where id=$7
    returning id, name, employee_no, phone, coalesce(enabled, true) as enabled, created_at, created_by, updated_at, updated_by`,
    [name, employeeNo, phone, enabled, now, req.user.name || 'system', id]
  );
  res.json(r.rows[0] || null);
});

app.get('/api/employee-checkin/dashboard', authRequired, ensureAllow('employee_checkin', 'view'), async (req, res) => {
  const dateText = canSelectEmployeeCheckinDate(req.user)
    ? toYmdDateText(String(req.query.date || '').trim() || Date.now())
    : toYmdDateText(Date.now());
  const q = String(req.query.q || '').trim();
  const params = [dateText];
  let where = `where coalesce(e.enabled, true) = true and (
    rec.id is null
    or coalesce(rec.start_at, rec.checkin_at, 0) = 0
    or coalesce(rec.end_at, 0) = 0
  )`;
  if (q) {
    params.push(`%${q}%`);
    where += ` and (
      coalesce(e.name, '') ilike $${params.length}
      or coalesce(e.employee_no, '') ilike $${params.length}
      or coalesce(e.phone, '') ilike $${params.length}
    )`;
  }
  const r = await query(
    `select
       e.id,
       e.name,
       e.employee_no,
       e.phone,
       coalesce(e.enabled, true) as enabled,
       rec.id as record_id,
       rec.checkin_date,
       coalesce(rec.start_at, rec.checkin_at) as start_at,
       rec.end_at,
       rec.created_by as checkin_by
     from employee_checkin_employees e
     left join employee_checkin_records rec
       on rec.employee_id = e.id
      and rec.checkin_date = $1
     ${where}
     order by
       case when trim(coalesce(e.employee_no, '')) ~ '^[0-9]+$' then 0 else 1 end asc,
       case when trim(coalesce(e.employee_no, '')) ~ '^[0-9]+$' then trim(e.employee_no)::int else null end asc nulls last,
       lower(trim(coalesce(e.employee_no, ''))) asc,
       lower(coalesce(e.name, '')) asc,
       e.id asc`,
    params
  );
  res.json({
    date: dateText,
    list: (r.rows || []).map(item => ({
      ...item,
      started: Boolean(item.start_at),
      ended: Boolean(item.end_at)
    }))
  });
});

app.post('/api/employee-checkin/sign-in', authRequired, ensureAllow('employee_checkin', 'edit'), async (req, res) => {
  const employeeId = Number(req.body?.employee_id || 0);
  if (!employeeId) return res.status(400).json({ error: 'bad_request' });
  const action = String(req.body?.action || 'start').trim().toLowerCase();
  if (action !== 'start' && action !== 'end') return res.status(400).json({ error: 'bad_request' });
  const password = normalizeEmployeeCheckinPassword(req.body?.password || '');
  if (!isValidEmployeeCheckinPassword(password)) return res.status(400).json({ error: 'invalid_password' });
  const dateText = canSelectEmployeeCheckinDate(req.user)
    ? toYmdDateText(String(req.body?.checkin_date || '').trim() || Date.now())
    : toYmdDateText(Date.now());
  const employeeRes = await query(
    `select id, name, employee_no, phone, coalesce(enabled, true) as enabled
       from employee_checkin_employees
      where id=$1`,
    [employeeId]
  );
  const employee = employeeRes.rows[0];
  if (!employee) return res.status(404).json({ error: 'employee_not_found' });
  if (!employee.enabled) return res.status(400).json({ error: 'employee_disabled' });
  if (normalizeEmployeeCheckinPassword(employee.phone || '') !== password) {
    return res.status(401).json({ error: 'bad_password' });
  }
  const now = Date.now();
  const existingRes = await query(
    `select id, employee_id, employee_name, employee_no, phone, checkin_date,
            remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by
       from employee_checkin_records
      where employee_id=$1 and checkin_date=$2
      limit 1`,
    [employeeId, dateText]
  );
  const existing = existingRes.rows[0] || null;

  if (action === 'start') {
    if (existing && existing.start_at) {
      return res.status(409).json({ error: 'already_started', record: existing });
    }
    if (existing) {
      const updated = await query(
        `update employee_checkin_records
            set employee_name=$1, employee_no=$2, phone=$3,
                checkin_at=coalesce(checkin_at, $4),
                start_at=coalesce(start_at, $4),
                created_at=coalesce(created_at, $4)
          where id=$5
        returning id, employee_id, employee_name, employee_no, phone, checkin_date,
                  remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by`,
        [employee.name || '', employee.employee_no || '', employee.phone || '', now, existing.id]
      );
      return res.json(updated.rows[0] || null);
    }
    const r = await query(
      `insert into employee_checkin_records(employee_id, employee_name, employee_no, phone, remark, checkin_date, checkin_at, start_at, end_at, created_at, created_by)
       values($1,$2,$3,$4,'',$5,$6,$6,null,$6,$7)
       returning id, employee_id, employee_name, employee_no, phone, checkin_date,
                 remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by`,
      [employeeId, employee.name || '', employee.employee_no || '', employee.phone || '', dateText, now, req.user.name || 'system']
    );
    return res.json(r.rows[0] || null);
  }

  if (!existing || !existing.start_at) {
    return res.status(400).json({ error: 'start_required' });
  }
  if (existing.end_at) {
    return res.status(409).json({ error: 'already_ended', record: existing });
  }
  const ended = await query(
    `update employee_checkin_records
        set employee_name=$1, employee_no=$2, phone=$3, end_at=$4
      where id=$5
    returning id, employee_id, employee_name, employee_no, phone, checkin_date,
              remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by`,
    [employee.name || '', employee.employee_no || '', employee.phone || '', now, existing.id]
  );
  res.json(ended.rows[0] || null);
});

app.put('/api/employee-checkin/records/:id/remark', authRequired, ensureAllow('employee_checkin', 'edit'), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'bad_request' });
  const remark = String(req.body?.remark || '').trim();
  const r = await query(
    `update employee_checkin_records
        set remark=$1
      where id=$2
    returning id, employee_id, employee_name, employee_no, phone, checkin_date,
              remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by`,
    [remark, id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'record_not_found' });
  res.json(r.rows[0]);
});

app.get('/api/employee-checkin/records', authRequired, ensureAllow('employee_checkin', 'view'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const employeeId = Number(req.query.employee_id || 0);
  const size = Math.max(1, Math.min(5000, parseInt(req.query.size, 10) || 1000));
  const range = resolveEmployeeCheckinRange(req.query || {});
  const params = [range.startDate, range.endDate];
  let where = `where checkin_date >= $1 and checkin_date <= $2
    and coalesce(start_at, checkin_at, 0) > 0
    and coalesce(end_at, 0) > 0`;
  if (employeeId > 0) {
    params.push(employeeId);
    where += ` and employee_id = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    where += ` and (
      coalesce(employee_name, '') ilike $${params.length}
      or coalesce(employee_no, '') ilike $${params.length}
      or coalesce(phone, '') ilike $${params.length}
      or coalesce(remark, '') ilike $${params.length}
      or coalesce(created_by, '') ilike $${params.length}
    )`;
  }
  params.push(size);
  const r = await query(
    `select id, employee_id, employee_name, employee_no, phone, checkin_date,
            remark, coalesce(start_at, checkin_at) as start_at, end_at, created_at, created_by
       from employee_checkin_records
       ${where}
      order by checkin_date desc, coalesce(start_at, checkin_at, end_at, created_at) desc, id desc
      limit $${params.length}`,
    params
  );
  res.json({
    start_date: range.startDate,
    end_date: range.endDate,
    month: range.mode === 'month' ? range.month : '',
    list: r.rows || []
  });
});

app.get('/api/ledger', authRequired, ensureAllow('ledger','view'), async (req, res) => {
  const r = await query('select * from ledger order by created_at desc nulls last, id desc');
  res.json(r.rows);
});
async function applyLedgerEffects(x) {
  return applyLedgerEffectsWithDb(query, x);
}

function normalizeLedgerDocList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))];
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return [...new Set(parsed.map(v => String(v || '').trim()).filter(Boolean))];
  } catch {}
  return [...new Set(text.split(/[,\n，、]/).map(v => String(v || '').trim()).filter(Boolean))];
}

async function applyLedgerEffectsWithDb(runQuery, x) {
  const method = (x.method || '').trim();
  const amount = roundMoneyValue(x.amount || 0);
  const docs = normalizeLedgerDocList(x.doc);
  const isLoanRepayment = String(x.category || '').trim() === COMPANY_REPAYMENT_CATEGORY;
  const payableType = !isLoanRepayment && x.type === '收入' ? '应收账款' : (!isLoanRepayment && (x.type === '支出' || x.type === '开支') ? '应付账款' : '');
  if (isLoanRepayment && docs.length && amount > 0) {
    let remaining = amount;
    for (const doc of docs) {
      if (remaining <= 0) break;
      const found = await runQuery(
        'select id, amount, repaid_amount from ledger where type=$1 and category=$2 and doc=$3 order by id asc limit 1',
        ['收入', COMPANY_LOAN_CATEGORY, doc]
      );
      const row = found.rows[0];
      const unpaid = Math.max(0, roundMoneyValue(Number(row?.amount || 0) - Number(row?.repaid_amount || 0)));
      const allocation = Math.min(remaining, unpaid);
      if (!row || allocation <= 0) continue;
      const nextRepaid = roundMoneyValue(Number(row.repaid_amount || 0) + allocation);
      await runQuery(
        'update ledger set repaid_amount=$1, loan_settled=($1 >= round(amount,2)) where id=$2',
        [nextRepaid, row.id]
      );
      remaining = roundMoneyValue(remaining - allocation);
    }
  }
  if (docs.length && payableType && amount > 0) {
    let remaining = amount;
    for (const doc of docs) {
      if (remaining <= 0) break;
      const found = await runQuery('select id, amount, paid from payables where doc=$1 and type=$2 limit 1', [doc, payableType]);
      const row = found.rows[0];
      const unpaid = Math.max(0, roundMoneyValue(Number(row?.amount || 0) - Number(row?.paid || 0)));
      const allocation = Math.min(remaining, unpaid);
      if (!row || allocation <= 0) continue;
      await runQuery(`update payables set paid = least(round(coalesce(paid,0) + $1, 2), round(amount, 2)), settled = (least(round(coalesce(paid,0) + $1, 2), round(amount, 2)) >= round(amount, 2)),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where id=$7`, [allocation, x.date_time||x.date||'', x.created_by||'', x.type === '收入' ? '收款' : '付款', x.notes||'', method, row.id]);
      remaining = roundMoneyValue(remaining - allocation);
    }
  }
  if (method && x.type && !x.skipAccountBalance && !x.skip_account_balance) {
    if (x.type === '收入') {
      await runQuery(`update accounts set balance = coalesce(balance,0) + $1 where trim(name) = $2`, [amount, method]);
    } else if (x.type === '支出' || x.type === '开支') {
      await runQuery(`update accounts set balance = coalesce(balance,0) - $1 where trim(name) = $2`, [amount, method]);
    }
  }
}

async function revertLedgerEffectsWithDb(runQuery, x) {
  const method = String(x.method || '').trim();
  const amount = roundMoneyValue(x.amount || 0);
  const docs = normalizeLedgerDocList(x.doc);
  const isLoanRepayment = String(x.category || '').trim() === COMPANY_REPAYMENT_CATEGORY;
  const payableType = !isLoanRepayment && x.type === '收入' ? '应收账款' : (!isLoanRepayment && (x.type === '支出' || x.type === '开支') ? '应付账款' : '');
  if (isLoanRepayment && docs.length && amount > 0) {
    let remaining = amount;
    for (const doc of docs) {
      if (remaining <= 0) break;
      const found = await runQuery(
        'select id, repaid_amount from ledger where type=$1 and category=$2 and doc=$3 order by id asc limit 1',
        ['收入', COMPANY_LOAN_CATEGORY, doc]
      );
      const row = found.rows[0];
      const allocation = Math.min(remaining, Math.max(0, roundMoneyValue(Number(row?.repaid_amount || 0))));
      if (!row || allocation <= 0) continue;
      const nextRepaid = roundMoneyValue(Number(row.repaid_amount || 0) - allocation);
      await runQuery(
        'update ledger set repaid_amount=$1, loan_settled=($1 >= round(amount,2)) where id=$2',
        [nextRepaid, row.id]
      );
      remaining = roundMoneyValue(remaining - allocation);
    }
  }
  if (docs.length && payableType && amount > 0) {
    let remaining = amount;
    for (const doc of docs) {
      if (remaining <= 0) break;
      const found = await runQuery('select id, paid from payables where doc=$1 and type=$2 limit 1', [doc, payableType]);
      const row = found.rows[0];
      const allocation = Math.min(remaining, Math.max(0, roundMoneyValue(Number(row?.paid || 0))));
      if (!row || allocation <= 0) continue;
      await runQuery(`update payables set
        paid = greatest(round(coalesce(paid,0) - $1, 2), 0),
        settled = (greatest(round(coalesce(paid,0) - $1, 2), 0) >= round(amount, 2)),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where id=$7`, [allocation, x.date_time || x.date || '', x.created_by || '', x.type === '收入' ? '冲销收款' : '冲销付款', x.notes || '', method, row.id]);
      remaining = roundMoneyValue(remaining - allocation);
    }
  }
  if (method && x.type && !x.skipAccountBalance && !x.skip_account_balance) {
    if (x.type === '收入') {
      await runQuery(`update accounts set balance = coalesce(balance,0) - $1 where trim(name) = $2`, [amount, method]);
    } else if (x.type === '支出' || x.type === '开支') {
      await runQuery(`update accounts set balance = coalesce(balance,0) + $1 where trim(name) = $2`, [amount, method]);
    }
  }
}
app.post('/api/ledger', authRequired, ensureAllow('ledger','create'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const createdAt = Number(x.createdAt);
  const confirmed = x.confirmed === false ? false : true;
  const r = await query(`
    insert into ledger(type,category,doc,client,amount,method,file,notes,date,date_time,created_at,created_by,confirmed,skip_account_balance)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    returning id
  `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', (Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now), x.createdBy||'', confirmed, x.skipAccountBalance === true]);
  if (confirmed) await applyLedgerEffects({ type:x.type, category:x.category, doc:x.doc, amount:x.amount, method:x.method, skipAccountBalance:x.skipAccountBalance === true, date_time:x.dateTime, date:x.date, created_by:x.createdBy, notes:x.notes });
  res.json({ id: r.rows[0].id });
});
app.put('/api/ledger/:id', authRequired, ensureAllow('ledger','update'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const current = (await query('select * from ledger where id=$1 limit 1', [id])).rows[0];
  if (!current) return res.status(404).json({ error:'not_found' });
  if (!current.confirmed) {
    const r = await query(`
      update ledger set
        type=$1, category=$2, doc=$3, client=$4, amount=$5, method=$6, file=$7, notes=$8,
        date=$9, date_time=$10, skip_account_balance=$11
      where id=$12 and confirmed=false
      returning id
    `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', x.skipAccountBalance === true, id]);
    if (!r.rows[0]) return res.status(400).json({ error:'not_editable' });
    return res.json({ ok: true });
  }
  const overrideSettings = await getFinancialEditOverrideSettings();
  if (!canForceEditFinancialModule(req.user, overrideSettings, 'ledger')) {
    return res.status(400).json({ error:'not_editable' });
  }
  const client = await pool.connect();
  try {
    const runQuery = client.query.bind(client);
    await client.query('begin');
    await revertLedgerEffectsWithDb(runQuery, current);
    const r = await runQuery(`
      update ledger set
        type=$1, category=$2, doc=$3, client=$4, amount=$5, method=$6, file=$7, notes=$8,
        date=$9, date_time=$10, skip_account_balance=$11
      where id=$12
      returning id
    `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', x.skipAccountBalance === true, id]);
    if (!r.rows[0]) {
      await client.query('rollback');
      return res.status(400).json({ error:'not_editable' });
    }
    await applyLedgerEffectsWithDb(runQuery, {
      type: x.type || '',
      category: x.category || '',
      doc: x.doc || '',
      amount: Number(x.amount || 0),
      method: x.method || '',
      skipAccountBalance: x.skipAccountBalance === true,
      date_time: x.dateTime || '',
      date: x.date || '',
      created_by: req.user?.name || current.created_by || '',
      notes: x.notes || ''
    });
    await client.query('commit');
    res.json({ ok: true, forced: true });
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error('ledger force edit failed', e);
    res.status(500).json({ error:'save_failed' });
  } finally {
    client.release();
  }
});
app.put('/api/ledger/:id/file', authRequired, ensureAllow('ledger','update'), async (req, res) => {
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
app.put('/api/ledger/:id/confirm', authRequired, ensureAllow('ledger','confirm'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r0 = await query('select * from ledger where id=$1 and confirmed=false', [id]);
  const row = r0.rows[0];
  if (!row) return res.status(404).json({ error:'not_found' });
  await applyLedgerEffects(row);
  await query('update ledger set confirmed=true, confirmed_by=$2 where id=$1', [id, req.user?.name || '']);
  res.json({ ok: true });
});
app.delete('/api/ledger/:id', authRequired, ensureAllow('ledger','delete'), async (req, res) => {
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
  const shippingAddresses = JSON.stringify(Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []);
  try {
    const r = await query(`
      insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales, use_price, is_iva, invoice_nota, email, province, ship_address, ship_zip, ship_city, ship_province, ship_country, ship_phone, ship_contact, shipping_addresses)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb) returning id
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', owner, x.created||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva, x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'', shippingAddresses]);
    res.json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23505') { // Unique violation
      return res.status(409).json({ error: 'duplicate_name' });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

async function syncCustomerNameReferences(oldName, newName) {
  const prev = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!prev || !next || prev === next) {
    return { daily_orders: 0, invoices: 0, payables: 0, ledger: 0 };
  }
  const dailyOrders = await query(
    'update daily_orders set customer=$1 where trim(customer)=trim($2)',
    [next, prev]
  );
  const invoices = await query(
    'update invoices set customer=$1 where trim(customer)=trim($2)',
    [next, prev]
  );
  const payables = await query(
    'update payables set partner=$1 where trim(partner)=trim($2)',
    [next, prev]
  );
  const ledger = await query(
    'update ledger set client=$1 where trim(client)=trim($2)',
    [next, prev]
  );
  return {
    daily_orders: dailyOrders.rowCount || 0,
    invoices: invoices.rowCount || 0,
    payables: payables.rowCount || 0,
    ledger: ledger.rowCount || 0
  };
}

async function getContactReferenceUsage({ owner = '客户', name = '', company = '' } = {}) {
  const primary = String(name || '').trim();
  const secondary = String(company || '').trim();
  if (!primary && !secondary) {
    return { payables: 0, ledger: 0, daily_orders: 0, invoices: 0, total: 0 };
  }
  const values = secondary && secondary !== primary ? [primary, secondary] : [primary || secondary];
  const sqlOr = (field) => values.map((_, idx) => `trim(${field})=trim($${idx + 1})`).join(' or ');
  const payables = await query(
    `select count(*)::int as c from payables where ${sqlOr('partner')}`,
    values
  );
  const ledger = await query(
    `select count(*)::int as c from ledger where ${sqlOr('client')}`,
    values
  );
  let dailyOrdersCount = 0;
  let invoicesCount = 0;
  if (String(owner || '').trim() === '客户') {
    const dailyOrders = await query(
      `select count(*)::int as c from daily_orders where ${sqlOr('customer')}`,
      values
    );
    const invoices = await query(
      `select count(*)::int as c from invoices where ${sqlOr('customer')}`,
      values
    );
    dailyOrdersCount = Number(dailyOrders.rows[0]?.c || 0);
    invoicesCount = Number(invoices.rows[0]?.c || 0);
  }
  const usage = {
    payables: Number(payables.rows[0]?.c || 0),
    ledger: Number(ledger.rows[0]?.c || 0),
    daily_orders: dailyOrdersCount,
    invoices: invoicesCount
  };
  usage.total = usage.payables + usage.ledger + usage.daily_orders + usage.invoices;
  return usage;
}

function uniqueTrimmedValues(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map(v => String(v || '').trim())
      .filter(Boolean)
  )];
}

async function reassignContactReferences({ owner = '客户', aliases = [], targetName = '' } = {}) {
  const nextName = String(targetName || '').trim();
  const sourceNames = uniqueTrimmedValues(aliases).filter(name => name !== nextName);
  if (!nextName || sourceNames.length === 0) {
    return { payables: 0, ledger: 0, daily_orders: 0, invoices: 0 };
  }
  const buildOrSql = (field) => sourceNames.map((_, idx) => `trim(${field})=trim($${idx + 2})`).join(' or ');
  const params = [nextName, ...sourceNames];
  const payables = await query(
    `update payables set partner=$1 where ${buildOrSql('partner')}`,
    params
  );
  const ledger = await query(
    `update ledger set client=$1 where ${buildOrSql('client')}`,
    params
  );
  let dailyOrders = { rowCount: 0 };
  let invoices = { rowCount: 0 };
  if (String(owner || '').trim() === '客户') {
    dailyOrders = await query(
      `update daily_orders set customer=$1 where ${buildOrSql('customer')}`,
      params
    );
    invoices = await query(
      `update invoices set customer=$1 where ${buildOrSql('customer')}`,
      params
    );
  }
  return {
    payables: payables.rowCount || 0,
    ledger: ledger.rowCount || 0,
    daily_orders: dailyOrders.rowCount || 0,
    invoices: invoices.rowCount || 0
  };
}

app.put('/api/contacts/:id', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  const shippingAddresses = JSON.stringify(Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []);
  try {
    const before = await query('select id, name, owner from contacts where id=$1 limit 1', [id]);
    if (!before.rows[0]) return res.status(404).json({ error: 'not_found' });
    const oldName = String(before.rows[0].name || '').trim();
    const oldOwner = String(before.rows[0].owner || '').trim();
    const nextName = String(x.name || '').trim();

    await query('begin');
    try {
      const r = await query(`
        update contacts set name=$1, contact=$2, phone=$3, city=$4, remark=$5, company=$6, code=$7, country=$8, address=$9, zip=$10, sales=$11, use_price=$12, is_iva=$13,
        invoice_nota=$14, email=$15, province=$16, ship_address=$17, ship_zip=$18, ship_city=$19, ship_province=$20, ship_country=$21, ship_phone=$22, ship_contact=$23, owner=$24, shipping_addresses=$25::jsonb
        where id=$26
      `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
          x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'', owner,
          shippingAddresses, id]);
      if (r.rowCount === 0) {
        await query('rollback');
        return res.status(404).json({ error: 'not_found' });
      }
      let renamedRefs = { daily_orders: 0, invoices: 0, payables: 0, ledger: 0 };
      if (oldOwner === '客户' && oldName && nextName && oldName !== nextName) {
        renamedRefs = await syncCustomerNameReferences(oldName, nextName);
      }
      await query('commit');
      res.json({ ok: true, renamed_refs: renamedRefs });
    } catch (err) {
      try { await query('rollback'); } catch {}
      throw err;
    }
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
  const shippingAddresses = JSON.stringify(Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []);
  await query(`
    update contacts set contact=$1, phone=$2, city=$3, remark=$4, company=$5, code=$6, country=$7, address=$8, zip=$9, sales=$10, use_price=$11, is_iva=$12,
    invoice_nota=$13, email=$14, province=$15, ship_address=$16, ship_zip=$17, ship_city=$18, ship_province=$19, ship_country=$20, ship_phone=$21, ship_contact=$22, shipping_addresses=$23::jsonb
    where owner=$24 and name=$25
  `, [x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
      x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
      shippingAddresses, owner, x.name||'']);
  res.json({ ok: true });
});

app.put('/api/contacts/by-company', authRequired, ensureAllow('contacts','edit'), async (req, res) => {
  const x = req.body || {};
  const owner = x.owner || '客户';
  const isIva = x.is_iva === undefined ? true : Boolean(x.is_iva);
  const shippingAddresses = JSON.stringify(Array.isArray(x.shipping_addresses) ? x.shipping_addresses : []);

  const exist = await query('select id, name, owner from contacts where owner=$1 and company=$2 limit 1', [owner, x.company]);
  if (!exist.rows[0]) return res.status(404).json({ error: 'not_found' });
  const oldName = String(exist.rows[0].name || '').trim();
  const oldOwner = String(exist.rows[0].owner || '').trim();
  const nextName = String(x.name || '').trim();

  await query('begin');
  try {
    await query(`
      update contacts set name=$1, contact=$2, phone=$3, city=$4, remark=$5, code=$6, country=$7, address=$8, zip=$9, sales=$10, use_price=$11, is_iva=$12,
      invoice_nota=$13, email=$14, province=$15, ship_address=$16, ship_zip=$17, ship_city=$18, ship_province=$19, ship_country=$20, ship_phone=$21, ship_contact=$22, shipping_addresses=$23::jsonb
      where id=$24
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
        x.invoice_nota||'', x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
        shippingAddresses, exist.rows[0].id]);
    let renamedRefs = { daily_orders: 0, invoices: 0, payables: 0, ledger: 0 };
    if (oldOwner === '客户' && oldName && nextName && oldName !== nextName) {
      renamedRefs = await syncCustomerNameReferences(oldName, nextName);
    }
    await query('commit');
    res.json({ ok: true, renamed_refs: renamedRefs });
  } catch (e) {
    try { await query('rollback'); } catch {}
    throw e;
  }
});

app.delete('/api/contacts/by-name', authRequired, ensureAllow('contacts','delete'), async (req, res) => {
  const { owner = '客户', name = '' } = req.query;
  const contact = await query(
    'select id, owner, name, company from contacts where owner=$1 and name=$2 limit 1',
    [owner, name]
  );
  const usage = await getContactReferenceUsage({
    owner,
    name,
    company: contact.rows[0]?.company || ''
  });
  if (usage.total > 0) {
    return res.status(400).json({ error: 'in_use', usage });
  }
  await query('delete from contacts where owner=$1 and name=$2', [owner, name]);
  res.json({ ok: true });
});

app.post('/api/contacts/merge', authRequired, ensureAllow('contacts','delete'), async (req, res) => {
  const sourceId = parseInt(req.body?.source_id, 10) || 0;
  const targetName = String(req.body?.target_name || '').trim();
  if (!sourceId || !targetName) return res.status(400).json({ error: 'invalid_params' });
  try {
    await query('begin');
    try {
      const sourceResult = await query(
        'select id, owner, name, company from contacts where id=$1 limit 1',
        [sourceId]
      );
      const source = sourceResult.rows[0];
      if (!source) {
        await query('rollback');
        return res.status(404).json({ error: 'source_not_found' });
      }
      const targetResult = await query(
        'select id, owner, name, company from contacts where owner=$1 and trim(name)=trim($2) limit 1',
        [source.owner, targetName]
      );
      const target = targetResult.rows[0];
      if (!target) {
        await query('rollback');
        return res.status(404).json({ error: 'target_not_found' });
      }
      if (Number(target.id) === Number(source.id)) {
        await query('rollback');
        return res.status(400).json({ error: 'same_contact' });
      }
      const movedRefs = await reassignContactReferences({
        owner: source.owner,
        aliases: [source.name, source.company],
        targetName: target.name
      });
      const movedNotes = await query(
        'update contact_notes set contact_id=$1 where contact_id=$2',
        [target.id, source.id]
      );
      await query('delete from contacts where id=$1', [source.id]);
      await query('commit');
      res.json({
        ok: true,
        source_name: source.name,
        target_name: target.name,
        moved_refs: movedRefs,
        moved_notes: movedNotes.rowCount || 0
      });
    } catch (err) {
      try { await query('rollback'); } catch {}
      throw err;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
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
  const r = await query('select name,name_es,balance,description as desc,created,initial_set from accounts order by id desc');
  res.json(r.rows);
});
app.post('/api/accounts', authRequired, ensureAllow('accounts','create_account'), async (req, res) => {
  const x = req.body || {};
  const r = await query(`insert into accounts(name, name_es, balance, description, created, initial_set) values($1,$2,$3,$4,$5,$6) returning id`,
    [x.name||'', x.nameEs||'', Number(x.balance||0), x.desc||'', x.created||'', !!x.initialSet]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/accounts/by-name', authRequired, ensureAllow('accounts','edit_account'), async (req, res) => {
  const x = req.body || {};
  const oldName = String(x.name || '').trim();
  const newName = String(x.newName || x.name || '').trim();
  const nameEs = String(x.nameEs || '').trim();
  const desc = String(x.desc || '').trim();
  if (!oldName || !newName) return res.status(400).json({ error: 'bad_request' });
  const updated = await query(
    `update accounts set name=$1, name_es=$2, description=$3 where name=$4 returning id`,
    [newName, nameEs, desc, oldName]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (newName !== oldName) {
    await query('update ledger set method=$1 where method=$2', [newName, oldName]);
  }
  res.json({ ok: true });
});
app.put('/api/accounts/init', authRequired, ensureAllow('accounts','init_account'), async (req, res) => {
  const { name = '', amount = 0 } = req.body || {};
  await query(`update accounts set balance=$1, initial_set=true where name=$2`, [Number(amount||0), name]);
  res.json({ ok: true });
});
app.get('/api/accounts/:name/ledger', authRequired, ensureAllow('accounts','view'), async (req, res) => {
  const name = String(req.params.name || '').trim();
  const account = (await query('select balance from accounts where name=$1 limit 1', [name])).rows[0];
  if (!account) return res.status(404).json({ error: 'not_found' });
  const ledger = await query(`
    select date, date_time, created_at, id, client, type, category, doc, amount, method, notes, skip_account_balance
    from ledger
    where method=$1
    order by created_at asc nulls last, id asc
  `, [name]);
  const rows = ledger.rows || [];
  const signedAmount = (row) => {
    if (row.skip_account_balance) return 0;
    const amount = Number(row.amount || 0);
    return row.type === '收入' ? amount : (row.type === '支出' || row.type === '开支' ? -amount : 0);
  };
  const currentBalance = Number(account.balance || 0);
  let runningBalance = currentBalance - rows.reduce((sum, row) => sum + signedAmount(row), 0);
  const result = rows.map((row) => {
    runningBalance += signedAmount(row);
    return {
      date: row.date || row.date_time || '',
      client: row.client || '',
      type: row.type || '',
      category: row.category || '',
      doc: row.doc || '',
      amount: Number(row.amount || 0),
      method: row.method || '',
      notes: row.notes || '',
      skipAccountBalance: row.skip_account_balance === true,
      balance: Number(runningBalance.toFixed(2))
    };
  }).reverse();
  res.json(result);
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
  res.json(r.rows.map(x => {
    let children = Array.isArray(x.children) ? x.children : [];
    if (x.name === '收入') {
      children = [...new Set(children.map((item) => LEGACY_COMPANY_LOAN_CATEGORIES.includes(String(item || '').trim()) ? COMPANY_LOAN_CATEGORY : String(item || '').trim()).filter(Boolean))];
      if (!children.includes(COMPANY_LOAN_CATEGORY)) children.splice(Math.min(3, children.length), 0, COMPANY_LOAN_CATEGORY);
    }
    if (x.name === '开支' && !children.includes(COMPANY_REPAYMENT_CATEGORY)) {
      children.splice(Math.min(4, children.length), 0, COMPANY_REPAYMENT_CATEGORY);
    }
    return { name: x.name, children };
  }));
});
app.put('/api/categories', authRequired, ensureAllow('categories','manage'), async (req, res) => {
  const list = Array.isArray(req.body?.list) ? req.body.list : [];
  await query('delete from categories', []);
  for (const c of list) {
    const name = String(c.name || '');
    let children = Array.isArray(c.children) ? c.children : [];
    if (name === '收入') {
      children = [...new Set(children.map((item) => LEGACY_COMPANY_LOAN_CATEGORIES.includes(String(item || '').trim()) ? COMPANY_LOAN_CATEGORY : String(item || '').trim()).filter(Boolean))];
      if (!children.includes(COMPANY_LOAN_CATEGORY)) children.splice(Math.min(3, children.length), 0, COMPANY_LOAN_CATEGORY);
    }
    if (name === '开支' && !children.includes(COMPANY_REPAYMENT_CATEGORY)) {
      children.splice(Math.min(4, children.length), 0, COMPANY_REPAYMENT_CATEGORY);
    }
    await query('insert into categories(name, children) values($1,$2)', [name, JSON.stringify(children)]);
  }
  if (!list.some((item) => String(item?.name || '') === '收入')) {
    await query('insert into categories(name, children) values($1,$2)', ['收入', JSON.stringify([COMPANY_LOAN_CATEGORY])]);
  }
  if (!list.some((item) => String(item?.name || '') === '开支')) {
    await query('insert into categories(name, children) values($1,$2)', ['开支', JSON.stringify([COMPANY_REPAYMENT_CATEGORY])]);
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
  const client = await pool.connect();
  try {
    await client.query('begin');
    const current = await client.query('select name from sales where id=$1 for update', [id]);
    if (!current.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not_found' });
    }
    const oldName = String(current.rows[0].name || '').trim();
    const nextName = String(x.name || '').trim();
    if (!nextName) {
      await client.query('rollback');
      return res.status(400).json({ error: 'bad_request' });
    }
    const duplicate = await client.query('select id from sales where lower(name)=lower($1) and id<>$2 limit 1', [nextName, id]);
    if (duplicate.rows[0]) {
      await client.query('rollback');
      return res.status(400).json({ error: 'duplicate_name' });
    }
    await client.query(
      `update sales set name=$1, region=$2, phone=$3, base=$4, rate=$5, commission=$6 where id=$7`,
      [nextName, x.region||'', x.phone||'', Number(x.base||0), Number(x.rate||0), Number(x.commission||0), id]
    );
    if (oldName && nextName && oldName !== nextName) {
      await client.query('update contacts set sales=$1 where sales=$2', [nextName, oldName]);
      await client.query('update invoices set sales=$1 where sales=$2', [nextName, oldName]);
      await client.query('update payables set sales=$1 where sales=$2', [nextName, oldName]);
    }
    await client.query('commit');
    res.json({ ok: true, old_name: oldName, name: nextName });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('update sales failed', err);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});
app.delete('/api/sales/:id', authRequired, ensureAllow('sales_accounts','delete_sales'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('select name from sales where id=$1', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  const name = r.rows[0].name;
  const boundUsers = await query('select count(*)::int as c from users where lower(trim(name))=lower(trim($1))', [name]);
  if (boundUsers.rows[0].c > 0) return res.status(400).json({ error: 'user_bound' });
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
  const locale = normalizeUserLocale(x.locale);
  const holdingPercent = Number(x.holdingPercent || 0);
  if (!Number.isFinite(holdingPercent) || holdingPercent < 0 || holdingPercent > 100) return res.status(400).json({ error: 'invalid_holding_percent' });
  const r = await query('insert into users(name, role, created, enabled, password, password_hash, locale, holding_percent) values($1,$2,$3,true,$4,$5,$6,$7) returning id',
    [x.name||'', x.role||'', x.created||'', pwd, pwd, locale, holdingPercent]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/users/:id', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const userR = await query('select id, name, role, enabled, locale, holding_percent from users where id=$1', [id]);
  const user = userR.rows[0];
  if (!user) return res.status(404).json({ error: 'not_found' });
  const name = String(x.name ?? user.name ?? '').trim();
  const role = String(x.role ?? user.role ?? '').trim();
  const enabled = typeof x.enabled === 'boolean' ? x.enabled : !!user.enabled;
  const locale = normalizeUserLocale(x.locale ?? user.locale);
  const holdingPercent = x.holdingPercent == null ? Number(user.holding_percent || 0) : Number(x.holdingPercent);
  if (!Number.isFinite(holdingPercent) || holdingPercent < 0 || holdingPercent > 100) return res.status(400).json({ error: 'invalid_holding_percent' });
  if (!name) return res.status(400).json({ error: 'bad_request' });
  if ((req.user?.role || '') !== '超级管理员') {
    const perms = await getRolePerms(req.user?.role || '');
    const modPerms = perms?.user_accounts || {};
    const sameName = name === String(user.name || '').trim();
    const sameRole = role === String(user.role || '').trim();
    const sameLocale = locale === normalizeUserLocale(user.locale);
    const sameHoldingPercent = holdingPercent === Number(user.holding_percent || 0);
    const sameEnabled = enabled === !!user.enabled;
    const statusOnlyChange = sameName && sameRole && sameLocale && sameHoldingPercent && !sameEnabled;
    const canEdit = !!modPerms.edit;
    const canEnable = !!(modPerms.enable_user || modPerms.edit);
    if (statusOnlyChange) {
      if (!canEnable) {
        return res.status(403).json({ error:'forbidden' });
      }
    } else {
      if (!canEdit) {
        return res.status(403).json({ error:'forbidden' });
      }
    }
  }
  const duplicate = await query('select id from users where lower(name)=lower($1) and id<>$2 limit 1', [name, id]);
  if (duplicate.rows[0]) {
    return res.status(400).json({ error: 'duplicate' });
  }
  await query('update users set name=$1, role=$2, enabled=$3, locale=$4, holding_percent=$5 where id=$6', [name, role, enabled, locale, holdingPercent, id]);
  res.json({ ok: true, name, role, enabled, locale, holdingPercent });
});
app.put('/api/users/me/locale', authRequired, async (req, res) => {
  const name = String(req.user?.name || '').trim();
  if (!name) return res.status(401).json({ error:'unauthorized' });
  const locale = normalizeUserLocale(req.body?.locale);
  await query('update users set locale=$1 where name=$2', [locale, name]);
  res.json({ ok: true, locale });
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

app.get('/api/shareholder-summary', authRequired, ensureShareholderView, async (req, res) => {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = now.toISOString().slice(0, 10);
  const [investments, shareholders, accountTotals, debtTotals, companyLoans, monthSales, monthLedger] = await Promise.all([
    query(`
      select id, shareholder, kind, amount, investment_date, notes, created_at, created_by
      from shareholder_investments
      order by investment_date desc nulls last, id desc
    `),
    query(`
      select name, holding_percent
      from users
      where enabled=true and role='股东'
      order by name asc
    `),
    query(`
      select coalesce(sum(balance), 0)::numeric(14,2) as total,
             count(*)::int as count
      from accounts
    `),
    query(`
      select
        coalesce(sum(case when type='应收账款' then greatest(amount - paid, 0) else 0 end), 0)::numeric(14,2) as receivable,
        coalesce(sum(case when type='应付账款' then greatest(amount - paid, 0) else 0 end), 0)::numeric(14,2) as debt
      from payables
      where coalesce(special_status, '') not in ('逃单', '作废')
    `),
    query(`
      select coalesce(sum(
        case
          when type='收入' and category = any($1::text[]) then greatest(amount, 0)
          when type in ('支出', '开支') and category = $2 then -greatest(amount, 0)
          else 0
        end
      ), 0)::numeric(14,2) as debt
      from ledger
      where category = any($1::text[]) or category = $2
    `, [[...new Set([COMPANY_LOAN_CATEGORY, ...LEGACY_COMPANY_LOAN_CATEGORIES])], COMPANY_REPAYMENT_CATEGORY]),
    query(`
      select coalesce(sum(total_amount), 0)::numeric(14,2) as total,
             count(*)::int as count
      from invoices
      where date >= $1 and date <= $2
    `, [monthStart, today]),
    query(`
      select
        coalesce(sum(case when type='收入' then amount else 0 end), 0)::numeric(14,2) as income,
        coalesce(sum(case when type in ('开支','支出') then abs(amount) else 0 end), 0)::numeric(14,2) as expense
      from ledger
      where date >= $1 and date <= $2
    `, [monthStart, today])
  ]);

  const list = investments.rows.map((row) => ({
    id: row.id,
    shareholder: String(row.shareholder || ''),
    kind: String(row.kind || '投入'),
    amount: Number(row.amount || 0),
    investmentDate: row.investment_date || '',
    notes: row.notes || '',
    createdAt: Number(row.created_at || 0),
    createdBy: row.created_by || ''
  }));
  const totals = {};
  list.forEach((item) => {
    const key = item.shareholder || '未指定股东';
    if (!totals[key]) totals[key] = 0;
    totals[key] += item.kind === '撤资' ? -item.amount : item.amount;
  });
  const holdingByName = Object.fromEntries(shareholders.rows.map((row) => [String(row.name || ''), Number(row.holding_percent || 0)]));
  const knownShareholders = shareholders.rows.map((row) => String(row.name || '')).filter(Boolean);
  knownShareholders.forEach((name) => {
    if (totals[name] == null) totals[name] = 0;
  });
  const shareholderTotals = Object.entries(totals)
    .map(([name, amount]) => ({
      shareholder: name,
      amount: Number(amount.toFixed(2)),
      holdingPercent: Number((holdingByName[name] || 0).toFixed(3))
    }))
    .sort((a, b) => b.amount - a.amount);
  const totalInvested = shareholderTotals.reduce((sum, item) => sum + item.amount, 0);
  const accountBalance = Number(accountTotals.rows[0]?.total || 0);
  const receivable = Number(debtTotals.rows[0]?.receivable || 0);
  const debt = Number(companyLoans.rows[0]?.debt || 0);

  res.json({
    metrics: {
      totalInvested: Number(totalInvested.toFixed(2)),
      accountBalance,
      receivable,
      debt,
      netAssets: Number((accountBalance + receivable - debt).toFixed(2)),
      monthSales: Number(monthSales.rows[0]?.total || 0),
      monthInvoiceCount: Number(monthSales.rows[0]?.count || 0),
      monthIncome: Number(monthLedger.rows[0]?.income || 0),
      monthExpense: Number(monthLedger.rows[0]?.expense || 0)
    },
    shareholders: shareholderTotals,
    investments: list,
    shareholderUsers: knownShareholders
  });
});

app.put('/api/shareholder-holdings', authRequired, ensureAdmin, async (req, res) => {
  const shareholder = String(req.body?.shareholder || '').trim();
  const holdingPercent = Number(req.body?.holdingPercent);
  if (!shareholder || !Number.isFinite(holdingPercent) || holdingPercent < 0 || holdingPercent > 100) {
    return res.status(400).json({ error: 'invalid_holding_percent' });
  }
  await query(`
    insert into shareholder_profiles(shareholder, holding_percent, updated_at, updated_by)
    values($1,$2,$3,$4)
    on conflict (shareholder) do update set
      holding_percent=excluded.holding_percent,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by
  `, [shareholder, holdingPercent, Date.now(), req.user?.name || '']);
  res.json({ ok: true, shareholder, holdingPercent });
});

app.post('/api/shareholder-investments', authRequired, ensureAdmin, async (req, res) => {
  const shareholder = String(req.body?.shareholder || '').trim();
  const kind = String(req.body?.kind || '投入').trim() === '撤资' ? '撤资' : '投入';
  const amount = Number(req.body?.amount || 0);
  const investmentDate = String(req.body?.investmentDate || '').trim() || new Date().toISOString().slice(0, 10);
  const notes = String(req.body?.notes || '').trim();
  if (!shareholder || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_investment' });
  }
  const r = await query(`
    insert into shareholder_investments(shareholder, kind, amount, investment_date, notes, created_at, created_by)
    values($1,$2,$3,$4,$5,$6,$7)
    returning id, shareholder, kind, amount, investment_date, notes, created_at, created_by
  `, [shareholder, kind, amount, investmentDate, notes, Date.now(), req.user?.name || '']);
  res.json({ ok: true, item: r.rows[0] });
});

app.delete('/api/shareholder-investments/:id', authRequired, ensureAdmin, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10) || 0;
  await query('delete from shareholder_investments where id=$1', [id]);
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
  await reconcilePendingDailyOrderStockReservations();
  const { names = [], ids = [], skus = [] } = req.body;
  const validNames = names.filter(n => n);
  const validIds = ids.map(i => parseInt(i, 10)).filter(i => !isNaN(i));
  const validSkus = skus.filter(s => s);
  
  if (validNames.length === 0 && validIds.length === 0 && validSkus.length === 0) return res.json([]);
  
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
      p.weight_kg,
      p.sku,
      (
        select count(*)
        from inventory_batches
        where product_id = p.id and quantity > 0
      ) as batch_count,
      (
        select coalesce(sum(case when quantity > 0 then quantity else 0 end), 0)
        from inventory_batches
        where product_id = p.id
      ) as batch_stock,
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

  if (validSkus.length > 0) {
    const pSkus = validSkus.map((_, i) => '$' + (params.length + i + 1)).join(',');
    sql += ` or sku in (${pSkus})`;
    params.push(...validSkus);
  }
  
  if (validIds.length > 0) {
    const pIds = validIds.map((_, i) => '$' + (params.length + i + 1)).join(',');
    sql += ` or id in (${pIds})`;
    params.push(...validIds);
  }
  
  const r = await query(sql, params);
  const rows = r.rows.map((row) => {
    const storedStock = Math.max(0, Number(row.stock || 0));
    const batchCount = Math.max(0, Number(row.batch_count || 0));
    const batchStock = Math.max(0, Number(row.batch_stock || 0));
    return {
      ...row,
      stock: batchCount > 0 ? batchStock : storedStock
    };
  });
  res.json(rows);
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
  const printSmallLabelEnabled = !!x.print_small_label_enabled;
  const printSmallLabelCopies = printSmallLabelEnabled ? Math.max(1, parseInt(x.print_small_label_copies, 10) || 1) : 0;
  const printLargeLabelEnabled = !!x.print_large_label_enabled;
  const printLargeLabelCopies = printLargeLabelEnabled ? Math.max(1, parseInt(x.print_large_label_copies, 10) || 1) : 0;
  try {
    const r = await query(`
      insert into products(sku, product_code, print_label_enabled, print_small_label_enabled, print_small_label_copies, print_large_label_enabled, print_large_label_copies, barcode, name, name_cn, raw_material_id, raw_material_name, image, description, ingredients, nutrition_facts, allergens, price1, price2, price3, price4, tax_rate, cost_price, weight_kg, dividend_enabled, dividend_users, spec, stock, remind_stock, notes, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) returning id
    `, [x.sku||'', x.product_code||'', x.print_label_enabled !== false, printSmallLabelEnabled, printSmallLabelCopies, printLargeLabelEnabled, printLargeLabelCopies, x.barcode||'', x.name||'', x.name_cn||'', Number(x.raw_material_id || 0) || null, x.raw_material_name||'', x.image||'', x.description||'', x.ingredients||'', x.nutrition_facts||'', x.allergens||'',
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0),
        Number(x.cost_price||0), Math.max(0, Number(x.weight_kg||0)), dividendEnabled, JSON.stringify(dividendUsers), x.spec||'', Number(x.stock||0), Math.max(0, Number(x.remind_stock||0)), x.notes||'', now, req.user.name||'']);
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
  const printSmallLabelEnabled = !!x.print_small_label_enabled;
  const printSmallLabelCopies = printSmallLabelEnabled ? Math.max(1, parseInt(x.print_small_label_copies, 10) || 1) : 0;
  const printLargeLabelEnabled = !!x.print_large_label_enabled;
  const printLargeLabelCopies = printLargeLabelEnabled ? Math.max(1, parseInt(x.print_large_label_copies, 10) || 1) : 0;
  try {
    const r = await query(`
      update products set sku=$1, product_code=$2, print_label_enabled=$3, print_small_label_enabled=$4, print_small_label_copies=$5, print_large_label_enabled=$6, print_large_label_copies=$7, barcode=$8, name=$9, name_cn=$10, image=$11, description=$12, ingredients=$13, nutrition_facts=$14, allergens=$15,
      raw_material_id=$16, raw_material_name=$17, price1=$18, price2=$19, price3=$20, price4=$21, tax_rate=$22, cost_price=$23, weight_kg=$24, dividend_enabled=$25, dividend_users=$26, spec=$27, stock=$28, remind_stock=$29, notes=$30
      where id=$31 returning id
    `, [x.sku||'', x.product_code||'', x.print_label_enabled !== false, printSmallLabelEnabled, printSmallLabelCopies, printLargeLabelEnabled, printLargeLabelCopies, x.barcode||'', x.name||'', x.name_cn||'', x.image||'', x.description||'', x.ingredients||'', x.nutrition_facts||'', x.allergens||'', Number(x.raw_material_id || 0) || null, x.raw_material_name||'',
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0),
        Number(x.cost_price||0), Math.max(0, Number(x.weight_kg||0)), dividendEnabled, JSON.stringify(dividendUsers), x.spec||'', Number(x.stock||0), Math.max(0, Number(x.remind_stock||0)), x.notes||'', id]);
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
  const specialInvoiceExclusion = `not exists (
    select 1
    from payables sp
    where sp.type='应收账款'
      and (sp.doc=i.invoice_no or sp.invoice_no=i.invoice_no)
      and coalesce(sp.special_status, '') in ('逃单', '作废')
  )`;
  const sql = `
    with expanded as (
      select
        i.id as invoice_id,
        i.invoice_no,
        i.date as invoice_date,
        item,
        nullif(trim(item->>'productId'), '') as pid_text,
        trim(coalesce(item->>'sku', '')) as sku_text,
        trim(coalesce(item->>'name', '')) as name_text,
        trim(coalesce(item->>'cn_name', item->>'name_cn', '')) as cn_text
      from invoices i
      cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) item
      ${[...invoiceConds, specialInvoiceExclusion].length
        ? 'where ' + [...invoiceConds, specialInvoiceExclusion].join(' and ')
        : ''}
    ),
    rows as (
      select
        coalesce(prod.id, case when e.pid_text ~ '^[0-9]+$' then e.pid_text::int else null end) as product_id,
        coalesce(nullif(trim(prod.sku), ''), e.sku_text) as sku,
        coalesce(nullif(trim(prod.name), ''), e.name_text) as product_name,
        coalesce(nullif(trim(prod.name_cn), ''), nullif(e.cn_text, ''), '') as product_name_cn,
        coalesce(prod.spec, '') as spec,
        coalesce(nullif(e.item->>'cost_price', '')::numeric, 0) as item_cost_price,
        (coalesce(prod.dividend_enabled, false) or coalesce(jsonb_array_length(coalesce(prod.dividend_users, '[]'::jsonb)), 0) > 0) as dividend_enabled,
        coalesce(prod.dividend_users, '[]'::jsonb) as dividend_users,
        coalesce(nullif(e.item->>'qty', '')::numeric, 0) as qty,
        coalesce(nullif(e.item->>'price', '')::numeric, 0) as unit_price,
        least(100, greatest(0, case
          when coalesce(nullif(e.item->>'discount', '')::numeric, null) is null then 0
          when coalesce(nullif(e.item->>'discount', '')::numeric, 0) > 0 and coalesce(nullif(e.item->>'discount', '')::numeric, 0) < 1 then coalesce(nullif(e.item->>'discount', '')::numeric, 0) * 100.0
          else coalesce(nullif(e.item->>'discount', '')::numeric, 0)
        end)) as discount_rate,
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
          or (e.sku_text <> '' and trim(coalesce(p.sku, '')) = e.sku_text)
          or (e.name_text <> '' and trim(coalesce(p.name, '')) = e.name_text)
          or (e.cn_text <> '' and trim(coalesce(p.name_cn, '')) = e.cn_text)
        order by
          case
            when e.pid_text ~ '^[0-9]+$' and p.id = e.pid_text::int then 0
            when e.sku_text <> '' and p.sku = e.sku_text then 1
            when e.name_text <> '' and p.name = e.name_text then 2
            when e.cn_text <> '' and p.name_cn = e.cn_text then 3
            else 4
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
        coalesce(sum(qty * unit_price * (1 - discount_rate / 100.0)), 0) as sales_amount,
        coalesce(sum(qty * unit_price * (1 - discount_rate / 100.0) * tax_rate), 0) as tax_amount,
        coalesce(sum(qty * unit_price * (1 - discount_rate / 100.0) * (1 + tax_rate)), 0) as gross_amount,
        case
          when coalesce(sum(qty), 0) = 0 then 0
          else coalesce(sum(qty * item_cost_price), 0) / nullif(sum(qty), 0)
        end as cost_price,
        coalesce(sum(qty * item_cost_price), 0) as cost_amount,
        coalesce(sum(qty * ((unit_price * (1 - discount_rate / 100.0)) - item_cost_price)), 0) as profit_amount
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
function normalizeInvoiceType(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === 'albaran' ? 'albaran' : 'factura';
}

function invoiceTypeRequiresStockDeduction(rawValue) {
  return normalizeInvoiceType(rawValue) === 'factura';
}

function invoiceItemsHaveStockDeductions(items) {
  return (Array.isArray(items) ? items : []).some(item =>
    Array.isArray(item?.deductions) && item.deductions.some(row => Math.max(0, Number(row?.qty || 0)) > 0)
  );
}

app.get('/api/invoices', authRequired, ensureAllow('sales_invoice','view'), async (req, res) => {
  const { q='', page='1', size='100' } = req.query;
  const invoiceType = normalizeInvoiceType(req.query.type || '');
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
  if (invoiceType) {
    conds.push(`coalesce(i.invoice_type,'factura')=$${p.length+1}`);
    p.push(invoiceType);
  }
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
  
  sql += ' order by i.invoice_no desc, i.id desc';
  sql += ` limit ${pageSize} offset ${(pageNum-1)*pageSize}`;
  const r = await query(sql, p);
  res.json({ list: r.rows, total: rCount.rows[0].c });
});

async function getNextInvoiceNoValue(rawType = '', dbClient = null) {
  const invoiceType = normalizeInvoiceType(rawType);
  const prefix = invoiceType === 'albaran' ? 'Albaran' : 'Factura';
  const rMax = await dbQuery(dbClient, `select invoice_no from invoices where invoice_no like $1 order by invoice_no desc limit 1`, [`${prefix}- %`]);
  let nextSeq = 231;
  if (rMax.rows[0]) {
    const lastNo = rMax.rows[0].invoice_no;
    const match = lastNo.match(new RegExp(`^${prefix}- (\\d{6})-\\d{2}$`));
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  const year2 = String(new Date().getFullYear()).slice(-2);
  return `${prefix}- ${String(nextSeq).padStart(6, '0')}-${year2}`;
}

async function ensureDailyOrderInvoice(orderId, actorName = '', dbClient = null) {
  const orderSql = dbClient
    ? 'select * from daily_orders where id=$1 for update'
    : 'select * from daily_orders where id=$1';
  const ordRes = await dbQuery(dbClient, orderSql, [orderId]);
  const ord = ordRes.rows[0];
  if (!ord) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  if (ord.invoice_id) {
    return { created: false, invoiceId: Number(ord.invoice_id || 0), invoiceNo: '' };
  }

  const items = typeof ord.items === 'string' ? JSON.parse(ord.items) : (ord.items || []);
  const manualDiscountAmount = normalizeInvoiceManualDiscountAmount(ord.manual_discount_amount, 0);
  const custRes = await dbQuery(dbClient, 'select is_iva from contacts where name=$1 and owner=$2 limit 1', [ord.customer, '客户']);
  const isIva = custRes.rows[0] ? custRes.rows[0].is_iva : true;
  const invoiceNo = await getNextInvoiceNoValue('factura', dbClient);
  const invoiceItems = await attachInvoiceItemSnapshots(expandInvoiceItemsByAllocationPlan(items.map(item => {
    const shipQty = Number(item.allocated_qty !== undefined ? item.allocated_qty : (item.qty || 0));
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate)) taxRate = 0.10;
    if (taxRate >= 1) taxRate = taxRate / 100;
    if (!isIva) taxRate = 0;
    return { ...item, qty: shipQty, original_qty: item.qty, tax_rate: taxRate };
  })), [], dbClient);

  const total = computeInvoiceTotalAmount(invoiceItems, manualDiscountAmount);

  const now = Date.now();
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const finalItems = Number(ord.stock_deducted_at || 0) > 0
    ? invoiceItems.filter(item => Number(item?.qty || 0) > 0)
    : await deductAndSplitStock(invoiceItems, dbClient);

  const inv = await dbQuery(dbClient, `
    insert into invoices(invoice_no, invoice_type, customer, date, items, total_amount, manual_discount_amount, sales, created_at, created_by, notes)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id
  `, [invoiceNo, 'factura', ord.customer, invoiceDate, JSON.stringify(finalItems), total, manualDiscountAmount, ord.sales, now, actorName || '', ord.notes || '']);

  await dbQuery(dbClient, `
    insert into payables(type, partner, doc, amount, paid, settled, trust_days, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
    values($1,$2,$3,$4,0,false,30,$5,$6,$7,$8,$9,$10,$11,'sales_order')
  `, ['应收账款', ord.customer, invoiceNo, total, invoiceNo, invoiceDate, total, ord.sales, invoiceDate, now, now]);

  await dbQuery(dbClient, 'update daily_orders set invoice_id=$1 where id=$2', [inv.rows[0].id, orderId]);
  return { created: true, invoiceId: Number(inv.rows[0].id || 0), invoiceNo };
}

app.get('/api/invoices/next-no', authRequired, ensureAllow('sales_order','view'), async (req, res) => {
  const invoiceType = normalizeInvoiceType(req.query.type || '');
  res.json({ nextNo: await getNextInvoiceNoValue(invoiceType), invoiceType });
});

app.post('/api/invoices', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const invoiceType = normalizeInvoiceType(x.invoice_type || '');
  const requiresStockDeduction = invoiceTypeRequiresStockDeduction(invoiceType);
  const manualDiscountAmount = normalizeInvoiceManualDiscountAmount(x.manual_discount_amount, 0);
  // Use provided invoice_no or generate new one
  let invoiceNo = String(x.invoice_no || '').trim();
  if (!invoiceNo) invoiceNo = await getNextInvoiceNoValue(invoiceType);

  const items = await attachInvoiceItemSnapshots(expandInvoiceItemsByAllocationPlan(Array.isArray(x.items) ? x.items : []));
  const total = computeInvoiceTotalAmount(items, manualDiscountAmount);

  // Update Stock and Split Items
  let finalItems = [];
  try {
    finalItems = requiresStockDeduction
      ? await deductAndSplitStock(items)
      : await simulateSplitStock(items);
  } catch (err) {
    if (err?.code === 'insufficient_stock') {
      return res.status(400).json({
        error: 'insufficient_stock',
        product_name: err.product_name,
        available_stock: err.available_stock,
        requested_qty: err.requested_qty
      });
    }
    throw err;
  }

  let r;
  try {
    r = await query(`
      insert into invoices(invoice_no, invoice_type, customer, date, items, total_amount, manual_discount_amount, notes, sales, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, invoice_no, invoice_type
    `, [invoiceNo, invoiceType, x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'', now, req.user.name||'']);
  } catch (e) {
    if (e?.code !== '23505') throw e;
    invoiceNo = await getNextInvoiceNoValue(invoiceType);
    r = await query(`
      insert into invoices(invoice_no, invoice_type, customer, date, items, total_amount, manual_discount_amount, notes, sales, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, invoice_no, invoice_type
    `, [invoiceNo, invoiceType, x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'', now, req.user.name||'']);
  }

  if (requiresStockDeduction) {
    const trustDays = parseInt(x.trust_days, 10) || 30;
    await query(`
      insert into payables(type, partner, doc, amount, paid, settled, trust_days, notes, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
      values($1,$2,$3,$4,0,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sales_order')
    `, ['应收账款', x.customer||'', invoiceNo, total, trustDays, x.notes||'', invoiceNo, x.date||'', total, x.sales||'', x.date||'', now, now]);
  }

  res.json({ id: r.rows[0].id, invoice_no: r.rows[0].invoice_no, invoice_type: r.rows[0].invoice_type });
});

app.delete('/api/invoices/:id', authRequired, ensureAllow('sales_invoice','delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  
  // Get invoice details to restore stock
  const r = await query('select * from invoices where id=$1', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  const inv = r.rows[0];
  const sourceInvoiceId = parseInt(inv.source_invoice_id, 10) || 0;
  
  // Check if paid
  const p = await query("select sum(paid) as paid from payables where doc=$1 and type='应收账款'", [inv.invoice_no]);
  const paid = Number(p.rows[0]?.paid || 0);
  if (paid > 0) return res.status(400).json({ error: 'cannot_delete_paid_invoice' });

  // Restore stock for full invoice items.
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  if (invoiceTypeRequiresStockDeduction(inv.invoice_type || '') || invoiceItemsHaveStockDeductions(items)) {
    for (const item of items) {
      await restoreInventoryForInvoiceItem(item);
    }
  }

  // Delete Payable
  await query("delete from payables where doc=$1 and type='应收账款'", [inv.invoice_no]);
  if (sourceInvoiceId > 0) {
    await query(`
      update invoices
      set converted_invoice_id=null, converted_invoice_no=null, converted_at=null
      where id=$1
    `, [sourceInvoiceId]);
  }
  
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

app.put('/api/invoices/:id/delivered', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const requestedAt = String(req.body?.delivered_at || '').trim();
  const now = new Date();
  const fallbackDt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const dt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(requestedAt) ? requestedAt : fallbackDt;
  const r = await query('update invoices set delivered=true, delivered_at=$2, delivered_by=$3 where id=$1 returning id, delivered, delivered_at, delivered_by', [id, dt, req.user?.name || '']);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, delivered: r.rows[0].delivered, delivered_at: r.rows[0].delivered_at, delivered_by: r.rows[0].delivered_by });
});

app.put('/api/invoices/:id', authRequired, ensureAllow('sales_order','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const allowAutoSupplement = !!x.allow_auto_supplement;
  
  // Check if invoice exists and payment status
  const check = await query(`
    select i.invoice_no, i.invoice_type, i.converted_invoice_id, i.converted_invoice_no,
    (select coalesce(sum(paid),0) from payables where doc=i.invoice_no and type='应收账款') as paid_amount,
    i.total_amount, i.manual_discount_amount, i.items
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
  const newItems = await attachInvoiceItemSnapshots(expandInvoiceItemsByAllocationPlan(Array.isArray(x.items) ? x.items : []), oldItems);
  const currentInvoiceType = normalizeInvoiceType(inv.invoice_type || '');
  const nextInvoiceType = normalizeInvoiceType(x.invoice_type || inv.invoice_type || '');
  const manualDiscountAmount = normalizeInvoiceManualDiscountAmount(
    x.manual_discount_amount !== undefined ? x.manual_discount_amount : inv.manual_discount_amount,
    0
  );
  const convertedInvoiceId = parseInt(inv.converted_invoice_id, 10) || 0;
  const convertedInvoiceNo = String(inv.converted_invoice_no || '').trim();
  const currentHasStockDeduction = invoiceTypeRequiresStockDeduction(currentInvoiceType) || invoiceItemsHaveStockDeductions(oldItems);
  const nextRequiresStockDeduction = invoiceTypeRequiresStockDeduction(nextInvoiceType);

  let finalItems = [];
  if (currentHasStockDeduction && nextRequiresStockDeduction) {
    const deltas = [];
    const usedNew = new Array(newItems.length).fill(false);
    const matchedOldMeta = new Map();
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
      if (matchIdx >= 0) {
        matchedOldMeta.set(matchIdx, { item: oldItem, qty: oldQty });
      }
      const delta = oldQty - Math.max(0, newQty);
      if (delta !== 0) {
        deltas.push({
          base: delta < 0 && matchIdx >= 0 ? newItems[matchIdx] : oldItem,
          delta,
          oldItem,
          newItem: matchIdx >= 0 ? newItems[matchIdx] : null,
          matchIdx
        });
      }
    }
    for (let i = 0; i < newItems.length; i++) {
      if (usedNew[i]) continue;
      const newQty = Number(newItems[i]?.qty || 0);
      if (newQty > 0) {
        deltas.push({
          base: newItems[i],
          delta: -newQty,
          oldItem: null,
          newItem: newItems[i],
          matchIdx: i
        });
      }
    }

    const restoredItems = [];
    for (const d of deltas) {
      if (d.delta > 0) {
        await restoreInventoryForInvoiceItem(d.oldItem || d.base, d.delta);
        restoredItems.push({ ...(d.oldItem || d.base), qty: d.delta });
      }
    }

    const extraItems = deltas
      .filter(d => d.delta < 0)
      .map(d => ({
        ...d.base,
        qty: Math.abs(d.delta),
        __match_idx: d.matchIdx,
        __reserved_qty: Math.max(0, Number(d.oldItem?.qty || 0)),
        __requested_total_qty: Math.max(0, Number(d.newItem?.qty || d.base?.qty || 0))
      }));
    try {
        const extraResults = await deductAndSplitStock(extraItems, null, { allow_auto_supplement: allowAutoSupplement });
      const extraMetaByIndex = new Map();
      extraResults.forEach((item) => {
        const matchIdx = Number(item?.__match_idx);
        if (!Number.isInteger(matchIdx) || matchIdx < 0) return;
        if (!extraMetaByIndex.has(matchIdx)) {
          extraMetaByIndex.set(matchIdx, { deductions: [], allocation_plan: [] });
        }
        const bucket = extraMetaByIndex.get(matchIdx);
        bucket.deductions.push(...cloneInvoiceStockMetaRows(item?.deductions, null, 'deduction'));
        const extraPlanRows = Array.isArray(item?.allocation_plan) && item.allocation_plan.length > 0 ? item.allocation_plan : item?.deductions;
        bucket.allocation_plan.push(...cloneInvoiceStockMetaRows(extraPlanRows, null, 'plan'));
      });

      finalItems = newItems
        .filter(item => Number(item?.qty || 0) > 0)
        .map((item, index) => {
          const nextQty = Math.max(0, Number(item?.qty || 0));
          const matchedOld = matchedOldMeta.get(index) || null;
          const preservedQty = matchedOld ? Math.min(Math.max(0, Number(matchedOld.qty || 0)), nextQty) : 0;
          const preservedMeta = matchedOld ? buildInvoiceItemStockMeta(matchedOld.item, preservedQty) : { deductions: [], allocation_plan: [] };
          const extraMeta = extraMetaByIndex.get(index) || { deductions: [], allocation_plan: [] };
          const nextDeductions = [...preservedMeta.deductions, ...extraMeta.deductions];
          const nextPlan = [...preservedMeta.allocation_plan, ...extraMeta.allocation_plan];
          const derivedLote = extractExplicitLote({ ...item, deductions: nextDeductions, allocation_plan: nextPlan });
          return {
            ...item,
            lote: String(item?.lote || derivedLote || '').trim(),
            deductions: nextDeductions,
            allocation_plan: nextPlan
          };
        });
    } catch (err) {
      if (restoredItems.length) {
        try {
          await deductAndSplitStock(restoredItems);
        } catch (rollbackErr) {
          console.error('rollback restored stock after invoice edit failed', rollbackErr);
        }
      }
      if (err?.code === 'insufficient_stock') {
        return res.status(400).json({
          error: 'insufficient_stock',
          product_name: err.product_name,
          available_stock: Number(err.edit_available_stock || err.available_stock || 0),
            requested_qty: Number(err.edit_requested_qty || err.requested_qty || 0),
            selected_lote: err.selected_lote,
            shortage_qty: err.shortage_qty,
            auto_supplement_available: err.auto_supplement_available,
            supplement_lotes: err.supplement_lotes
        });
      }
      throw err;
    }
  } else if (nextRequiresStockDeduction) {
    try {
        finalItems = await deductAndSplitStock(newItems, null, { allow_auto_supplement: allowAutoSupplement });
    } catch (err) {
      if (err?.code === 'insufficient_stock') {
        return res.status(400).json({
          error: 'insufficient_stock',
            product_name: err.product_name,
            available_stock: Number(err.edit_available_stock || err.available_stock || 0),
            requested_qty: Number(err.edit_requested_qty || err.requested_qty || 0),
            selected_lote: err.selected_lote,
            shortage_qty: err.shortage_qty,
            auto_supplement_available: err.auto_supplement_available,
            supplement_lotes: err.supplement_lotes
        });
      }
      throw err;
    }
  } else {
    if (currentHasStockDeduction) {
      for (const item of oldItems) {
        await restoreInventoryForInvoiceItem(item);
      }
    }
    finalItems = await simulateSplitStock(newItems);
  }

  // Recalculate total
  const total = computeInvoiceTotalAmount(finalItems, manualDiscountAmount);

  if (currentInvoiceType === 'albaran' && nextInvoiceType === 'factura') {
    if (convertedInvoiceId || convertedInvoiceNo) {
      return res.json({
        ok: true,
        invoice_no: inv.invoice_no,
        invoice_type: 'albaran',
        converted_invoice_id: convertedInvoiceId,
        converted_invoice_no: convertedInvoiceNo,
        already_converted: true
      });
    }

    const albaranItems = await simulateSplitStock(newItems);
    let facturaInvoiceNo = await getNextInvoiceNoValue('factura');
    let facturaInsert;
    try {
      facturaInsert = await query(`
        insert into invoices(
          invoice_no, invoice_type, customer, date, items, total_amount, manual_discount_amount, notes, sales,
          created_at, created_by, source_invoice_id, source_invoice_no
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        returning id, invoice_no, invoice_type
      `, [
        facturaInvoiceNo, 'factura', x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'',
        Date.now(), req.user.name||'', id, String(inv.invoice_no || '').trim()
      ]);
    } catch (err) {
      if (err?.code !== '23505') throw err;
      facturaInvoiceNo = await getNextInvoiceNoValue('factura');
      facturaInsert = await query(`
        insert into invoices(
          invoice_no, invoice_type, customer, date, items, total_amount, manual_discount_amount, notes, sales,
          created_at, created_by, source_invoice_id, source_invoice_no
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        returning id, invoice_no, invoice_type
      `, [
        facturaInvoiceNo, 'factura', x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'',
        Date.now(), req.user.name||'', id, String(inv.invoice_no || '').trim()
      ]);
    }

    const facturaId = parseInt(facturaInsert.rows[0]?.id, 10) || 0;
    const convertedAt = Date.now();
    await query(`
      update invoices
      set customer=$1, date=$2, items=$3, total_amount=$4, manual_discount_amount=$5, notes=$6, sales=$7,
          converted_invoice_id=$8, converted_invoice_no=$9, converted_at=$10
      where id=$11
    `, [x.customer||'', x.date||'', JSON.stringify(albaranItems), total, manualDiscountAmount, x.notes||'', x.sales||'', facturaId, facturaInvoiceNo, convertedAt, id]);

    await query("delete from payables where doc=$1 and type='应收账款'", [String(inv.invoice_no || '').trim()]);
    const trustDays = parseInt(x.trust_days, 10) || 30;
    await query(`
      insert into payables(type, partner, doc, amount, paid, settled, trust_days, notes, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
      values($1,$2,$3,$4,0,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sales_order')
    `, ['应收账款', x.customer||'', facturaInvoiceNo, total, trustDays, x.notes||'', facturaInvoiceNo, x.date||'', total, x.sales||'', x.date||'', convertedAt, convertedAt]);

    return res.json({
      ok: true,
      invoice_no: inv.invoice_no,
      invoice_type: 'albaran',
      converted_invoice_id: facturaId,
      converted_invoice_no: facturaInvoiceNo,
      created_factura_id: facturaId,
      created_factura_no: facturaInvoiceNo
    });
  }

  let nextInvoiceNo = String(x.invoice_no || '').trim() || String(inv.invoice_no || '').trim();
  if (!nextInvoiceNo) nextInvoiceNo = await getNextInvoiceNoValue(nextInvoiceType);

  // Update invoice
  try {
    await query(`
      update invoices
      set invoice_no=$1, invoice_type=$2, customer=$3, date=$4, items=$5, total_amount=$6, manual_discount_amount=$7, notes=$8, sales=$9
      where id=$10
    `, [nextInvoiceNo, nextInvoiceType, x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'', id]);
  } catch (err) {
    if (err?.code !== '23505') throw err;
    nextInvoiceNo = await getNextInvoiceNoValue(nextInvoiceType);
    await query(`
      update invoices
      set invoice_no=$1, invoice_type=$2, customer=$3, date=$4, items=$5, total_amount=$6, manual_discount_amount=$7, notes=$8, sales=$9
      where id=$10
    `, [nextInvoiceNo, nextInvoiceType, x.customer||'', x.date||'', JSON.stringify(finalItems), total, manualDiscountAmount, x.notes||'', x.sales||'', id]);
  }
  
  // Update payable (receivable)
  // Only update fields that should sync. 
  const trustDays = parseInt(x.trust_days, 10) || 30;
  if (nextRequiresStockDeduction) {
    const payableUpdate = await query(`
      update payables
      set partner=$1, amount=$2, invoice_amount=$3, date=$4, invoice_date=$4, notes=$5, trust_days=$6, sales=$7, doc=$8, invoice_no=$8
      where doc=$9 and type='应收账款'
    `, [x.customer||'', total, total, x.date||'', x.notes||'', trustDays, x.sales||'', nextInvoiceNo, inv.invoice_no]);
    if (!payableUpdate.rowCount) {
      await query(`
        insert into payables(type, partner, doc, amount, paid, settled, trust_days, notes, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
        values($1,$2,$3,$4,0,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sales_order')
      `, ['应收账款', x.customer||'', nextInvoiceNo, total, trustDays, x.notes||'', nextInvoiceNo, x.date||'', total, x.sales||'', x.date||'', Date.now(), Date.now()]);
    }
  } else {
    await query("delete from payables where doc=$1 and type='应收账款'", [String(inv.invoice_no || '').trim()]);
  }

  res.json({ ok: true, invoice_no: nextInvoiceNo, invoice_type: nextInvoiceType });
});

app.get('/api/system/financial-edit-overrides', authRequired, async (req, res) => {
  const settings = await getFinancialEditOverrideSettings();
  res.json({
    ...settings,
    can_manage: String(req.user?.role || '').trim() === '超级管理员' || String(req.user?.name || '').trim() === 'aaaaaa'
  });
});

app.put('/api/system/financial-edit-overrides', authRequired, ensureAdmin, async (req, res) => {
  const next = normalizeFinancialEditOverrideSettings(req.body || {});
  await query(
    `insert into system_settings(setting_key, setting_value, updated_at, updated_by)
     values($1, $2::jsonb, $3, $4)
     on conflict (setting_key) do update set
       setting_value=excluded.setting_value,
       updated_at=excluded.updated_at,
       updated_by=excluded.updated_by`,
    ['financial_edit_overrides', JSON.stringify(next), Date.now(), String(req.user?.name || '').trim()]
  );
  res.json({
    ok: true,
    ...next,
    can_manage: true
  });
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
  const intervalMonths = normalizeAutoTaskInterval(x.interval_months);
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
  const intervalMonths = normalizeAutoTaskInterval(x.interval_months);
  const timeLimit = Math.max(0, parseInt(x.time_limit, 10) || 0);
  const startAt = Math.max(0, parseInt(x.start_at, 10) || 0) || Number(row.start_at || row.created_at || Date.now());
  const active = x.active !== false;
  if (!title || !assignedTo) return res.status(400).json({ error: 'bad_request' });
  let nextGenerateAt = null;
  if (active) {
    if (intervalMonths === 0) {
      nextGenerateAt = Number(row.last_generated_at || 0) > 0 ? null : startAt;
    } else if (Number(row.last_generated_at || 0) > 0) {
      nextGenerateAt = advanceAutoTaskTs(Number(row.last_generated_at), intervalMonths);
      while (nextGenerateAt <= Date.now()) nextGenerateAt = advanceAutoTaskTs(nextGenerateAt, intervalMonths);
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
app.get('/api/production-plans', authRequired, async (req, res) => {
  const rawTzOffset = parseInt(req.query.tz_offset_minutes, 10);
  const tzOffsetMinutes = Number.isFinite(rawTzOffset) && rawTzOffset >= -720 && rawTzOffset <= 840 ? rawTzOffset : 0;
  const currentWeekStart = getWeekStartTs(0, Date.now(), tzOffsetMinutes);
  const nextWeekStart = getWeekStartTs(1, Date.now(), tzOffsetMinutes);
  const weekAfterNextStart = getWeekStartTs(2, Date.now(), tzOffsetMinutes);
  const futureWindowEnd = getWeekStartTs(6, Date.now(), tzOffsetMinutes);
  const r = await query(
    `select * from production_plans
     where coalesce(plan_end, coalesce(plan_start, week_start)) >= $1
       and coalesce(plan_start, week_start) < $2
     order by week_start asc, sort_order asc, coalesce(plan_start, week_start) asc, created_at asc, id asc`,
    [currentWeekStart, futureWindowEnd]
  );
  const list = r.rows || [];
  const currentWeekSplit = splitProductionPlanGroups(list.filter(x => {
    const range = getPlanRange(x);
    return range.end >= currentWeekStart && range.start < nextWeekStart;
  }));
  const nextWeekSplit = splitProductionPlanGroups(list.filter(x => {
    const range = getPlanRange(x);
    return range.end >= nextWeekStart && range.start < weekAfterNextStart;
  }));
  const futureSplit = splitProductionPlanGroups(list.filter(x => {
    const range = getPlanRange(x);
    return range.start >= weekAfterNextStart;
  }));
  res.json({
    currentWeekStart,
    nextWeekStart,
    weekAfterNextStart,
    currentWeek: currentWeekSplit.activeGroups.flatMap(group => group.items),
    nextWeek: nextWeekSplit.activeGroups.flatMap(group => group.items),
    futureGroups: futureSplit.activeGroups.map(group => ({
      key: String(group.key || group.plan_group_key || group.week_start || ''),
      week_start: group.week_start,
      plan_start: group.plan_start,
      plan_end: group.plan_end,
      items: group.items
    }))
  });
});
app.get('/api/production-plans/completed', authRequired, async (req, res) => {
  const r = await query(
    `select * from production_plans
     order by week_start desc, sort_order asc, coalesce(plan_start, week_start) asc, created_at asc, id asc`
  );
  const list = r.rows || [];
  const { completedGroups } = splitProductionPlanGroups(list);
  completedGroups.sort((a, b) => {
    if (b.plan_start !== a.plan_start) return b.plan_start - a.plan_start;
    return b.plan_end - a.plan_end;
  });
  res.json({
    groups: completedGroups.map(group => ({
      key: group.key,
      plan_start: group.plan_start,
      plan_end: group.plan_end,
      week_start: group.week_start,
      completed_at: Math.max(0, ...group.items.map(item => Number(item.confirmed_at || 0))),
      items: group.items
    }))
  });
});
app.post('/api/production-plans', authRequired, async (req, res) => {
  const x = req.body || {};
  const startDate = String(x.start_date || '').trim();
  const endDate = String(x.end_date || '').trim();
  const startTs = parsePlanDateInput(startDate);
  const endTs = parsePlanDateInput(endDate);
  const productIds = [...new Set((Array.isArray(x.product_ids) ? x.product_ids : []).map(v => parseInt(v, 10)).filter(v => v > 0))];
  if (!startTs || !endTs || endTs < startTs || !productIds.length) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const placeholders = productIds.map((_, idx) => `$${idx + 1}`).join(',');
  const productR = await query(
    `select id, name, name_cn, raw_material_name from products where id in (${placeholders})`,
    productIds
  );
  const productMap = new Map((productR.rows || []).map(row => [Number(row.id), row]));
  const selectedProducts = productIds.map(id => {
    const row = productMap.get(Number(id));
    if (!row) return null;
    return {
      id: Number(row.id),
      name: String(row.name || row.name_cn || '').trim(),
      materialName: String(row.raw_material_name || '').trim()
    };
  }).filter(row => row && row.name);
  if (!selectedProducts.length) return res.status(400).json({ error: 'bad_request' });
  const weekStart = getWeekStartTs(0, startTs);
  const sortR = await query('select coalesce(max(sort_order), 0)::int as max_sort from production_plans where week_start=$1', [weekStart]);
  const baseSort = Number(sortR.rows?.[0]?.max_sort || 0);
  const now = Date.now();
  const planGroupKey = buildProductionPlanGroupKey(now);
  const params = [];
  const valuesSql = selectedProducts.map((item, idx) => {
    const base = params.length;
    params.push(item.id, planGroupKey, item.name, item.materialName || '', baseSort + idx + 1, weekStart, startTs, endTs, req.user.name || '', now);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},0,$${base + 5},$${base + 6},$${base + 7},$${base + 8},'pending',$${base + 9},$${base + 10})`;
  }).join(',');
  const inserted = await query(
    `insert into production_plans(product_id, plan_group_key, product_name, material_name, material_qty, sort_order, week_start, plan_start, plan_end, status, created_by, created_at)
     values ${valuesSql}
     returning id`,
    params
  );
  res.json({ ids: (inserted.rows || []).map(row => row.id) });
});
app.put('/api/production-plans/group', authRequired, async (req, res) => {
  try {
    const x = req.body || {};
    const ids = [...new Set((Array.isArray(x.ids) ? x.ids : []).map(v => parseInt(v, 10)).filter(v => v > 0))];
    const startDate = String(x.start_date || '').trim();
    const endDate = String(x.end_date || '').trim();
    const startTs = parsePlanDateInput(startDate);
    const endTs = parsePlanDateInput(endDate);
    const productIds = [...new Set((Array.isArray(x.product_ids) ? x.product_ids : []).map(v => parseInt(v, 10)).filter(v => v > 0))];
    if (!ids.length || !startTs || !endTs || endTs < startTs) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const idPlaceholders = ids.map((_, idx) => `$${idx + 1}`).join(',');
    const currentR = await query(
      `select *
       from production_plans
       where id in (${idPlaceholders})
       order by sort_order asc, coalesce(plan_start, week_start) asc, created_at asc, id asc`,
      ids
    );
    const currentRows = currentR.rows || [];
    if (currentRows.length !== ids.length) return res.status(404).json({ error: 'not_found' });
    const weekStarts = [...new Set(currentRows.map(row => Number(row.week_start || 0)))];
    if (weekStarts.length !== 1) return res.status(400).json({ error: 'bad_request' });
    const groupKeys = [...new Set(currentRows.map(row => getProductionPlanGroupKey(row)))];
    const nextGroupKey = groupKeys[0] || buildProductionPlanGroupKey(Date.now());
    const nextWeekStart = getWeekStartTs(0, startTs);
    await query(
      `update production_plans
       set plan_group_key=$1, week_start=$2, plan_start=$3, plan_end=$4
       where id in (${ids.join(',')})`,
      [nextGroupKey, nextWeekStart, startTs, endTs]
    );
    if (productIds.length) {
      const productPlaceholders = productIds.map((_, idx) => `$${idx + 1}`).join(',');
      const productR = await query(
        `select id, name, name_cn, raw_material_name from products where id in (${productPlaceholders})`,
        productIds
      );
      const productMap = new Map((productR.rows || []).map(row => [Number(row.id), row]));
      const selectedProducts = productIds.map(id => {
        const row = productMap.get(Number(id));
        if (!row) return null;
        return {
          id: Number(row.id),
          name: String(row.name || row.name_cn || '').trim(),
          materialName: String(row.raw_material_name || '').trim()
        };
      }).filter(row => row && row.name);
      let nextSortOrder = currentRows.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0);
      for (const product of selectedProducts) {
        nextSortOrder += 1;
        await query(
          `insert into production_plans(product_id, plan_group_key, product_name, material_name, material_qty, sort_order, week_start, plan_start, plan_end, status, created_by, created_at)
           values ($1,$2,$3,$4,0,$5,$6,$7,$8,'pending',$9,$10)`,
          [product.id, nextGroupKey, product.name, product.materialName || '', nextSortOrder, nextWeekStart, startTs, endTs, req.user.name || '', Date.now()]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('update production plan group failed', err);
    res.status(500).json({ error: 'server_error' });
  }
});
app.put('/api/production-plans/reorder', authRequired, async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(v => parseInt(v, 10)).filter(v => v > 0))];
  if (ids.length < 2) return res.status(400).json({ error: 'bad_request' });
  const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(',');
  const rowsR = await query(`select id, week_start from production_plans where id in (${placeholders})`, ids);
  const rows = rowsR.rows || [];
  if (rows.length !== ids.length) return res.status(404).json({ error: 'not_found' });
  const weekStarts = [...new Set(rows.map(row => Number(row.week_start || 0)))];
  if (weekStarts.length !== 1) return res.status(400).json({ error: 'bad_request' });
  const caseSql = ids.map((id, idx) => `when ${id} then ${idx + 1}`).join(' ');
  await query(
    `update production_plans
     set sort_order = case id ${caseSql} end
     where id in (${ids.join(',')})`
  );
  res.json({ ok: true });
});
app.put('/api/production-plans/:id', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const hasScheduleUpdate = 'start_date' in x || 'end_date' in x || 'product_ids' in x;
  const hasMaterialNameUpdate = 'material_name' in x;
  const hasMaterialQtyUpdate = 'material_qty' in x;
  const startDate = String(x.start_date || '').trim();
  const endDate = String(x.end_date || '').trim();
  const productIds = [...new Set((Array.isArray(x.product_ids) ? x.product_ids : []).map(v => parseInt(v, 10)).filter(v => v > 0))];
  const current = await query('select * from production_plans where id=$1', [id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });
  let productId = Number(current.rows[0].product_id || 0);
  let planGroupKey = getProductionPlanGroupKey(current.rows[0]);
  let productName = String(current.rows[0].product_name || '').trim();
  let planStart = Number(current.rows[0].plan_start || current.rows[0].week_start || 0);
  let planEnd = Number(current.rows[0].plan_end || current.rows[0].plan_start || current.rows[0].week_start || 0);
  let sortOrder = Number(current.rows[0].sort_order || 0);
  let weekStart = Number(current.rows[0].week_start || getWeekStartTs(0, planStart || Date.now()));
  let materialName = String(current.rows[0].material_name || '').trim();
  let materialQty = Number(current.rows[0].material_qty || 0);

  if (hasScheduleUpdate) {
    const startTs = parsePlanDateInput(startDate);
    const endTs = parsePlanDateInput(endDate);
    if (!startTs || !endTs || endTs < startTs || productIds.length !== 1) {
      return res.status(400).json({ error: 'bad_request' });
    }
    productId = productIds[0];
    const productR = await query('select id, name, name_cn from products where id=$1 limit 1', [productId]);
    const product = productR.rows[0];
    productName = String(product?.name || product?.name_cn || '').trim();
    if (!productName) return res.status(400).json({ error: 'bad_request' });
    planStart = startTs;
    planEnd = endTs;
    if (weekStart !== getWeekStartTs(0, startTs)) sortOrder = 0;
    weekStart = getWeekStartTs(0, startTs);
  }

  if (hasMaterialNameUpdate) {
    materialName = String(x.material_name || '').trim();
  }
  if (hasMaterialQtyUpdate) {
    const rawQty = String(x.material_qty ?? '').trim();
    if (!rawQty) {
      materialQty = 0;
    } else {
      const parsedQty = Number(rawQty);
      if (!Number.isFinite(parsedQty) || parsedQty < 0) {
        return res.status(400).json({ error: 'bad_request' });
      }
      materialQty = parsedQty;
    }
  }
  if (!Number.isFinite(sortOrder) || sortOrder <= 0) {
    const sortR = await query('select coalesce(max(sort_order), 0)::int as max_sort from production_plans where week_start=$1 and id<>$2', [weekStart, id]);
    sortOrder = Number(sortR.rows?.[0]?.max_sort || 0) + 1;
  }

  await query(
    `update production_plans
     set product_id=$1, plan_group_key=$2, product_name=$3, sort_order=$4, week_start=$5, plan_start=$6, plan_end=$7, material_name=$8, material_qty=$9
     where id=$10`,
    [productId, planGroupKey, productName, sortOrder, weekStart, planStart, planEnd, materialName, materialQty, id]
  );
  res.json({ ok: true });
});
app.put('/api/production-plans/:id/confirm', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const current = await client.query(
      'select id, status, product_name, material_name, material_qty from production_plans where id=$1 for update',
      [id]
    );
    if (!current.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not_found' });
    }
    const item = current.rows[0];
    if (String(item.status || '') === 'confirmed') {
      await client.query('commit');
      return res.json({ ok: true });
    }
    await consumeRawMaterialForProductionPlan(client, {
      materialName: item.material_name || '',
      materialQty: item.material_qty || 0,
      productName: item.product_name || '',
      userName: req.user.name || ''
    });
    await client.query(
      `update production_plans
       set status='confirmed', confirmed_by=$1, confirmed_at=$2
       where id=$3`,
      [req.user.name || '', Date.now(), id]
    );
    await client.query('commit');
    res.json({ ok: true });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    if (err?.code === 'material_not_found') return res.status(400).json({ error: 'material_not_found' });
    if (err?.code === 'insufficient_material_stock') {
      return res.status(400).json({ error: 'insufficient_material_stock', ...(err.meta || {}) });
    }
    if (err?.code === 'bad_request') return res.status(400).json({ error: 'bad_request' });
    console.error('confirm production plan failed', err);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});
app.delete('/api/production-plans/:id', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const current = await query('select id, status from production_plans where id=$1', [id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (String(current.rows[0].status || '') === 'confirmed') {
    return res.status(400).json({ error: 'confirmed_not_deletable' });
  }
  await query('delete from production_plans where id=$1', [id]);
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
  const stats = { new: 0, allocated: 0, ready_to_ship: 0, shipped: 0 };
  r.rows.forEach(x => {
    if (x.status === 'new') stats.new = x.c;
    else if (x.status === 'allocated') stats.allocated = x.c;
    else if (x.status === 'ready_to_ship') stats.ready_to_ship = x.c;
    else if (x.status === 'shipped') stats.shipped = x.c;
  });
  res.json(stats);
});
app.get('/api/daily-orders', authRequired, async (req, res) => {
  await reconcilePendingDailyOrderStockReservations();
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
  const manualDiscountAmount = normalizeInvoiceManualDiscountAmount(x.manual_discount_amount, 0);
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  
  const r = await query(`insert into daily_orders(customer,sales,items,created_by,created_at,date,notes,allocation_enabled,manual_discount_amount) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [x.customer||'', x.sales||'', JSON.stringify(items), req.user.name, Date.now(), dateStr, x.notes||'', false, manualDiscountAmount]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/daily-orders/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const x = req.body || {};
  const items = Array.isArray(x.items) ? x.items : [];
  const manualDiscountAmount = normalizeInvoiceManualDiscountAmount(x.manual_discount_amount, 0);
  const allowAutoSupplement = !!x.allow_auto_supplement;
  try {
    const newItems = await withTransaction(async (client) => {
      const ord = await client.query('select status, items, stock_deducted_at from daily_orders where id=$1 for update', [id]);
      if (!ord.rows[0]) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      if (ord.rows[0].status === 'shipped') {
        const err = new Error('cannot_edit_shipped');
        err.code = 'cannot_edit_shipped';
        throw err;
      }

      let nextItems = items;
      if (ord.rows[0].status === 'allocated' || ord.rows[0].status === 'ready_to_ship') {
        const oldItems = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
        const oldAllocatedMap = new Map();
        oldItems.forEach(i => {
          const key = `${Number(i?.productId || 0)}__${String(i?.name || '').trim()}`;
          oldAllocatedMap.set(key, {
            allocated_qty: Math.max(0, Number(i?.allocated_qty || 0)),
            allocation_plan: Array.isArray(i?.allocation_plan) ? i.allocation_plan : [],
            deductions: Array.isArray(i?.deductions) ? i.deductions : []
          });
        });
        nextItems = items.map(i => {
          const key = `${Number(i?.productId || 0)}__${String(i?.name || '').trim()}`;
          const oldMeta = oldAllocatedMap.get(key) || null;
          const hasAllocatedQty = i?.allocated_qty !== undefined && i?.allocated_qty !== null && i?.allocated_qty !== '';
          const hasPlan = Array.isArray(i?.allocation_plan);
          const hasDeductions = Array.isArray(i?.deductions);
          return {
            ...i,
            allocated_qty: hasAllocatedQty ? Math.max(0, Number(i.allocated_qty || 0)) : Math.max(0, Number(oldMeta?.allocated_qty || 0)),
            allocation_plan: hasPlan ? i.allocation_plan : (oldMeta?.allocation_plan || []),
            deductions: hasDeductions ? i.deductions : (oldMeta?.deductions || [])
          };
        });
      }

      if ((ord.rows[0].status === 'allocated' || ord.rows[0].status === 'ready_to_ship') && Number(ord.rows[0].stock_deducted_at || 0) > 0) {
        const oldItems = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
        await releaseReservedStockForOrderItems(oldItems, client);
        nextItems = await reserveStockForOrderItems(nextItems, client, { allow_auto_supplement: allowAutoSupplement });
      }

      await client.query('update daily_orders set customer=$1, notes=$2, items=$3, manual_discount_amount=$4 where id=$5',
        [x.customer||'', x.notes||'', JSON.stringify(nextItems), manualDiscountAmount, id]);
      return nextItems;
    });
    res.json({ ok: true, items: newItems });
  } catch (err) {
    if (err?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'cannot_edit_shipped') return res.status(400).json({ error: 'cannot_edit_shipped' });
    if (err?.code === 'insufficient_stock') {
      return res.status(400).json({
        error: 'insufficient_stock',
        product_name: err.product_name,
        available_stock: err.available_stock,
        requested_qty: err.requested_qty,
        edit_available_stock: err.edit_available_stock,
        edit_requested_qty: err.edit_requested_qty,
        selected_lote: err.selected_lote || '',
        shortage_qty: err.shortage_qty || 0,
        auto_supplement_available: !!err.auto_supplement_available,
        supplement_lotes: Array.isArray(err.supplement_lotes) ? err.supplement_lotes : []
      });
    }
    throw err;
  }
});
app.delete('/api/daily-orders/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await withTransaction(async (client) => {
      const ord = await client.query('select status, items, stock_deducted_at from daily_orders where id=$1 for update', [id]);
      if (!ord.rows[0] || ord.rows[0].status === 'shipped' || ord.rows[0].status === 'cancelled') {
        const err = new Error('cannot_cancel_shipped_or_cancelled');
        err.code = 'cannot_cancel_shipped_or_cancelled';
        throw err;
      }
      if ((ord.rows[0].status === 'allocated' || ord.rows[0].status === 'ready_to_ship') && Number(ord.rows[0].stock_deducted_at || 0) > 0) {
        const oldItems = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
        await releaseReservedStockForOrderItems(oldItems, client);
      }
      await client.query("update daily_orders set status='cancelled', stock_deducted_at=null, stock_deducted_by='' where id=$1", [id]);
    });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'cannot_cancel_shipped_or_cancelled') {
      return res.status(400).json({ error: 'cannot_cancel_shipped_or_cancelled' });
    }
    throw err;
  }
});

app.put('/api/daily-orders/:id/restore', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ord = await query('select status from daily_orders where id=$1', [id]);
  if (!ord.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (ord.rows[0].status !== 'cancelled') return res.status(400).json({ error: 'bad_status' });
  await query(
    "update daily_orders set status='new', allocated_by='', stock_deducted_at=null, stock_deducted_by='' where id=$1",
    [id]
  );
  res.json({ ok: true });
});

app.put('/api/daily-orders/:id/enable-allocation', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const access = await requireDailyOrderActionAccess(req, res, 'enable_allocation');
  if (!access) return;
  const ord = await query('select status from daily_orders where id=$1', [id]);
  if (!ord.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (ord.rows[0].status !== 'new') return res.status(400).json({ error: 'bad_status' });
  await query('update daily_orders set allocation_enabled=true where id=$1', [id]);
  res.json({ ok: true });
});

app.put('/api/daily-orders/:id/ready-to-ship', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const access = await requireDailyOrderActionAccess(req, res, 'ready_to_ship');
  if (!access) return;
  const x = req.body || {};
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  try {
    const invoiceInfo = await withTransaction(async (client) => {
      const ord = await client.query('select status from daily_orders where id=$1 for update', [id]);
      if (!ord.rows[0]) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      if (ord.rows[0].status !== 'allocated') {
        const err = new Error('bad_status');
        err.code = 'bad_status';
        throw err;
      }
      await client.query(
        "update daily_orders set status='ready_to_ship', logistics_pallet_count=$2, logistics_box_count=$3, logistics_total_weight=$4 where id=$1",
        [id, palletCount, boxCount, totalWeight]
      );
      return ensureDailyOrderInvoice(id, req.user?.name || '', client);
    });
    res.json({ ok: true, invoice_id: invoiceInfo.invoiceId, invoice_no: invoiceInfo.invoiceNo });
  } catch (err) {
    if (err?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'bad_status') return res.status(400).json({ error: 'bad_status' });
    if (err?.code === 'insufficient_stock') {
      return res.status(400).json({
        error: 'insufficient_stock',
        product_name: err.product_name,
        available_stock: err.available_stock,
        requested_qty: err.requested_qty,
        edit_available_stock: err.edit_available_stock,
        edit_requested_qty: err.edit_requested_qty
      });
    }
    throw err;
  }
});

app.put('/api/daily-orders/:id/contact-logistics', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const access = await requireDailyOrderActionAccess(req, res, 'contact_logistics');
  if (!access) return;
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  const ord = await query('select status from daily_orders where id=$1', [id]);
  if (!ord.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (ord.rows[0].status !== 'ready_to_ship') return res.status(400).json({ error: 'bad_status' });
  await query(
    `update daily_orders
     set logistics_company_id=$2, logistics_status=$3, logistics_updated_at=$4, logistics_from=$5, logistics_to=$6, logistics_ship_date=$7,
         logistics_pallet_count=$8, logistics_box_count=$9, logistics_total_weight=$10
     where id=$1`,
    [id, companyId, 'pickup_pending', Date.now(), from, to, shipDate, palletCount, boxCount, totalWeight]
  );
  res.json({ ok: true });
});

app.put('/api/daily-orders/:id/allocate', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const access = await requireDailyOrderActionAccess(req, res, 'allocate');
  if (!access) return;
  const { items } = req.body; // updated items with allocated_qty
  try {
    const finalItems = await withTransaction(async (client) => {
      const ord = await client.query('select status, items, stock_deducted_at, allocation_enabled from daily_orders where id=$1 for update', [id]);
      if (!ord.rows[0]) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      if (ord.rows[0].status === 'shipped' || ord.rows[0].status === 'cancelled') {
        const err = new Error('bad_status');
        err.code = 'bad_status';
        throw err;
      }
      if (ord.rows[0].status === 'new' && ord.rows[0].allocation_enabled !== true) {
        const err = new Error('allocation_not_enabled');
        err.code = 'allocation_not_enabled';
        throw err;
      }

      const oldItems = typeof ord.rows[0].items === 'string' ? JSON.parse(ord.rows[0].items) : (ord.rows[0].items || []);
      if (Number(ord.rows[0].stock_deducted_at || 0) > 0) {
        await releaseReservedStockForOrderItems(oldItems, client);
      }

      const nextItems = await reserveStockForOrderItems(Array.isArray(items) ? items : [], client);
      await client.query(
        'update daily_orders set items=$1, status=$2, allocated_by=$3, stock_deducted_at=$4, stock_deducted_by=$5 where id=$6',
        [JSON.stringify(nextItems), 'allocated', req.user.name, Date.now(), req.user.name, id]
      );
      return nextItems;
    });
    res.json({ ok: true, items: finalItems });
  } catch (err) {
    if (err?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'bad_status') return res.status(400).json({ error: 'bad_status' });
    if (err?.code === 'allocation_not_enabled') return res.status(400).json({ error: 'allocation_not_enabled' });
    if (err?.code === 'insufficient_stock') {
      return res.status(400).json({
        error: 'insufficient_stock',
        product_name: err.product_name,
        available_stock: err.available_stock,
        requested_qty: err.requested_qty
      });
    }
    throw err;
  }
});
app.put('/api/daily-orders/:id/ship', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const access = await requireDailyOrderActionAccess(req, res, 'ship');
  if (!access) return;
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  const voucherUrl = String(x.logistics_voucher_url || '').trim();
  const voucherName = String(x.logistics_voucher_name || '').trim();
  try {
    const invoiceInfo = await withTransaction(async (client) => {
      const assignments = await getDailyOrderActionAssignments(client);
      const ordBeforeShip = (await client.query('select * from daily_orders where id=$1 for update', [id])).rows[0];
      if (!ordBeforeShip) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      if (ordBeforeShip.status !== 'ready_to_ship') {
        const err = new Error('bad_status');
        err.code = 'bad_status';
        throw err;
      }
      const finalCompanyId = Number(companyId || ordBeforeShip.logistics_company_id || 0);
      const finalFrom = String(from || ordBeforeShip.logistics_from || '').trim() || '-';
      const finalTo = String(to || ordBeforeShip.logistics_to || '').trim();
      const finalShipDate = String(shipDate || ordBeforeShip.logistics_ship_date || '').trim();
      const finalPalletCount = String(palletCount || ordBeforeShip.logistics_pallet_count || '').trim() || '0';
      const finalBoxCount = String(boxCount || ordBeforeShip.logistics_box_count || '').trim() || '0';
      const finalTotalWeight = String(totalWeight || ordBeforeShip.logistics_total_weight || '').trim() || '0';
      if (!finalCompanyId) {
        const err = new Error('logistics_company_required');
        err.code = 'logistics_company_required';
        throw err;
      }
      if (!finalTo) {
        const err = new Error('logistics_to_required');
        err.code = 'logistics_to_required';
        throw err;
      }
      if (!finalShipDate) {
        const err = new Error('logistics_ship_date_required');
        err.code = 'logistics_ship_date_required';
        throw err;
      }
      if (!voucherUrl && !canUserSkipShipVoucher(req.user || {}, assignments)) {
        const err = new Error('logistics_voucher_required');
        err.code = 'logistics_voucher_required';
        throw err;
      }
      const comp = (await client.query('select id, enabled, generate_logistics_order from logistics_companies where id=$1', [finalCompanyId])).rows[0];
      if (!comp || comp.enabled !== true) {
        const err = new Error('bad_logistics_company');
        err.code = 'bad_logistics_company';
        throw err;
      }
      const generateLogisticsOrder = comp.generate_logistics_order !== false;
      await client.query(
        'update daily_orders set status=$1, shipped_by=coalesce(shipped_by,$2), logistics_company_id=$3, logistics_status=$4, logistics_updated_at=$5, logistics_from=$6, logistics_to=$7, logistics_ship_date=$8, logistics_pallet_count=$9, logistics_box_count=$10, logistics_total_weight=$11, logistics_voucher_url=$12, logistics_voucher_name=$13 where id=$14',
        ['shipped', req.user.name, finalCompanyId, generateLogisticsOrder ? 'ongoing' : null, Date.now(), finalFrom, finalTo, finalShipDate, finalPalletCount, finalBoxCount, finalTotalWeight, voucherUrl, voucherName, id]
      );
      return ensureDailyOrderInvoice(id, req.user?.name || '', client);
    });
    res.json({ ok: true, invoice_id: invoiceInfo.invoiceId, invoice_no: invoiceInfo.invoiceNo });
  } catch (err) {
    if (err?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'bad_status') return res.status(400).json({ error: 'bad_status' });
    if (err?.code === 'logistics_company_required') return res.status(400).json({ error: 'logistics_company_required' });
    if (err?.code === 'logistics_to_required') return res.status(400).json({ error: 'logistics_to_required' });
    if (err?.code === 'logistics_ship_date_required') return res.status(400).json({ error: 'logistics_ship_date_required' });
    if (err?.code === 'logistics_voucher_required') return res.status(400).json({ error: 'logistics_voucher_required' });
    if (err?.code === 'bad_logistics_company') return res.status(400).json({ error: 'bad_logistics_company' });
    if (err?.code === 'insufficient_stock') {
      return res.status(400).json({
        error: 'insufficient_stock',
        product_name: err.product_name,
        available_stock: err.available_stock,
        requested_qty: err.requested_qty,
        edit_available_stock: err.edit_available_stock,
        edit_requested_qty: err.edit_requested_qty
      });
    }
    throw err;
  }
});

app.get('/api/logistics/companies', authRequired, async (req, res) => {
  const r = await query('select id, name, phone, contact, generate_logistics_order, enabled, created_at, created_by from logistics_companies order by enabled desc, id asc');
  res.json(r.rows);
});
app.post('/api/logistics/companies', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const x = req.body || {};
  const name = String(x.name || '').trim();
  const phone = String(x.phone || '').trim();
  const contact = String(x.contact || '').trim();
  const generateLogisticsOrder = x.generate_logistics_order !== false;
  if (!name) return res.status(400).json({ error: 'bad_request' });
  const now = Date.now();
  let r;
  try {
    r = await query(
      'insert into logistics_companies(name, phone, contact, generate_logistics_order, enabled, created_at, created_by) values($1,$2,$3,$4,true,$5,$6) returning id',
      [name, phone, contact, generateLogisticsOrder, now, req.user?.name || '']
    );
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  }
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
  const voucherUrl = String(x.logistics_voucher_url || '').trim();
  const voucherName = String(x.logistics_voucher_name || '').trim();
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  const now = Date.now();
  const r = await query(
    `insert into daily_orders(
      customer, sales, items, status, created_by, created_at, date, notes, shipped_by,
      logistics_company_id, logistics_status, logistics_updated_at, logistics_from, logistics_to,
      logistics_ship_date, logistics_pallet_count, logistics_box_count, logistics_total_weight,
      logistics_voucher_url, logistics_voucher_name, is_manual_logistics
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
    [to, '', '[]', 'shipped', req.user?.name || '', now, shipDate, '', req.user?.name || '', companyId, 'ongoing', now, from, to, shipDate, palletCount, boxCount, totalWeight, voucherUrl, voucherName, true]
  );
  res.json({ ok: true, id: r.rows[0].id });
});
app.put('/api/logistics/companies/:id', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  if ((req.user?.role || '') !== '超级管理员') return res.status(403).json({ error:'forbidden' });
  const id = parseInt(req.params.id, 10);
  const current = (await query('select * from logistics_companies where id=$1', [id])).rows[0];
  if (!current) return res.status(404).json({ error:'not_found' });
  const x = req.body || {};
  const name = x.name !== undefined ? String(x.name || '').trim() : String(current.name || '').trim();
  const phone = x.phone !== undefined ? String(x.phone || '').trim() : String(current.phone || '').trim();
  const contact = x.contact !== undefined ? String(x.contact || '').trim() : String(current.contact || '').trim();
  const enabled = x.enabled === undefined ? current.enabled === true : !!x.enabled;
  const generateLogisticsOrder = x.generate_logistics_order === undefined
    ? current.generate_logistics_order !== false
    : x.generate_logistics_order !== false;
  if (!name) return res.status(400).json({ error:'bad_request' });
  try {
    await query(
      'update logistics_companies set name=$1, phone=$2, contact=$3, generate_logistics_order=$4, enabled=$5 where id=$6',
      [name, phone, contact, generateLogisticsOrder, enabled, id]
    );
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  }
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
      d.logistics_voucher_url,
      d.logistics_voucher_name,
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

app.put('/api/logistics/records/:id([0-9]+)', authRequired, ensureAllow('daily_orders','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const companyId = Number(x.logistics_company_id || 0);
  const from = String(x.logistics_from || '').trim();
  const to = String(x.logistics_to || '').trim();
  const shipDate = String(x.logistics_ship_date || '').trim();
  const palletCount = String(x.logistics_pallet_count || '').trim();
  const boxCount = String(x.logistics_box_count || '').trim();
  const totalWeight = String(x.logistics_total_weight || '').trim();
  const voucherUrl = String(x.logistics_voucher_url || '').trim();
  const voucherName = String(x.logistics_voucher_name || '').trim();
  if (!id) return res.status(400).json({ error: 'bad_request' });
  if (!companyId) return res.status(400).json({ error: 'logistics_company_required' });
  if (!to) return res.status(400).json({ error: 'logistics_to_required' });
  if (!shipDate) return res.status(400).json({ error: 'logistics_ship_date_required' });
  const comp = (await query('select id, enabled from logistics_companies where id=$1', [companyId])).rows[0];
  if (!comp || comp.enabled !== true) return res.status(400).json({ error: 'bad_logistics_company' });
  const r = await query(
    `update daily_orders
     set logistics_company_id=$1, logistics_updated_at=$2, logistics_from=$3, logistics_to=$4, logistics_ship_date=$5,
         logistics_pallet_count=$6, logistics_box_count=$7, logistics_total_weight=$8, logistics_voucher_url=$9, logistics_voucher_name=$10
     where id=$11 and status='shipped' and coalesce(logistics_status,'')='ongoing'`,
    [companyId, Date.now(), from, to, shipDate, palletCount, boxCount, totalWeight, voucherUrl, voucherName, id]
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
    `insert into event_records(name, record_date, due_date, notes, image_url, status, created_by, created_at)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      String(x.name || '').trim(),
      String(x.record_date || '').trim(),
      String(x.due_date || '').trim(),
      String(x.notes || '').trim(),
      String(x.image_url || '').trim(),
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
     set name=$1, record_date=$2, due_date=$3, notes=$4, image_url=$5, status=$6, completed_at=$7, confirmed_by=$8
     where id=$9`,
    [
      String(x.name || '').trim(),
      String(x.record_date || '').trim(),
      String(x.due_date || '').trim(),
      String(x.notes || '').trim(),
      String(x.image_url || '').trim(),
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
  let where = ' where pe.status=$1';
  let countWhere = ' where status=$1';
  if (q) {
    params.push(`%${q}%`);
    countWhere += ` and (
      coalesce(product_name,'') ilike $${params.length}
      or coalesce(product_name_cn,'') ilike $${params.length}
      or coalesce(lote,'') ilike $${params.length}
    )`;
    where += ` and (
      coalesce(pe.product_name,'') ilike $${params.length}
      or coalesce(pe.product_name_cn,'') ilike $${params.length}
      or coalesce(pe.lote,'') ilike $${params.length}
    )`;
  }
  const totalRes = await query(`select count(*)::int as count from production_entries${countWhere}`, params);
  params.push(size, (page - 1) * size);
  const listRes = await query(
    `select
       pe.*,
       coalesce(prod.product_code, '') as product_code,
       coalesce(prod.print_label_enabled, true) as print_label_enabled,
       coalesce(prod.barcode, '') as product_barcode,
       coalesce(prod.spec, '') as product_spec,
       coalesce(prod.ingredients, '') as product_ingredients,
       coalesce(prod.nutrition_facts, '') as product_nutrition_facts,
       coalesce(prod.allergens, '') as product_allergens
     from production_entries pe
     left join products prod on prod.id = pe.product_id
     ${where}
     order by pe.created_at desc, pe.id desc
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
    const fresh = await query(
      `select
         pe.*,
         coalesce(prod.product_code, '') as product_code,
         coalesce(prod.print_label_enabled, true) as print_label_enabled,
         coalesce(prod.barcode, '') as product_barcode,
         coalesce(prod.spec, '') as product_spec,
         coalesce(prod.ingredients, '') as product_ingredients,
         coalesce(prod.nutrition_facts, '') as product_nutrition_facts,
         coalesce(prod.allergens, '') as product_allergens
       from production_entries pe
       left join products prod on prod.id = pe.product_id
       where pe.id=$1`,
      [id]
    );
    return res.json({ ok: true, entry: fresh.rows[0] || entry });
  }
  if (action === 'reject') {
    await query(
      `update production_entries
       set status='rejected', rejected_at=$1, rejected_by=$2, reject_reason=$3
       where id=$4`,
      [Date.now(), req.user.name || '', reason, id]
    );
    const fresh = await query(
      `select
         pe.*,
         coalesce(prod.product_code, '') as product_code,
         coalesce(prod.print_label_enabled, true) as print_label_enabled,
         coalesce(prod.barcode, '') as product_barcode,
         coalesce(prod.spec, '') as product_spec,
         coalesce(prod.ingredients, '') as product_ingredients,
         coalesce(prod.nutrition_facts, '') as product_nutrition_facts,
         coalesce(prod.allergens, '') as product_allergens
       from production_entries pe
       left join products prod on prod.id = pe.product_id
       where pe.id=$1`,
      [id]
    );
    return res.json({ ok: true, entry: fresh.rows[0] || entry });
  }
  return res.status(400).json({ error: 'bad_action' });
});

// Inventory (Finished)
app.get('/api/inventory/finished', authRequired, async (req, res) => {
  await reconcilePendingDailyOrderStockReservations();
  const { page='1', size='50', q='', low_stock='' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 50));
  const lowStockOnly = String(low_stock || '').trim() === '1';
  
  let countSql = 'select count(*)::int as c from products p';
  let dataSql = `
    select p.id, p.sku, p.product_code, p.barcode, p.name, p.name_cn, p.image, p.spec,
    p.price1, p.price2, p.price3, p.price4, p.tax_rate, p.cost_price,
    p.description, p.ingredients, p.nutrition_facts, p.allergens, p.notes, p.stock, p.dividend_enabled, p.dividend_users,
    p.stock as total_stock, coalesce(p.remind_stock, 0) as remind_stock,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc)
      from inventory_batches
      where product_id=p.id and quantity>0
    ) as batches
    from products p
  `;
  
  const pVals = [];
  const conds = [];
  if (q && q.trim()) {
    conds.push(`(p.name ilike $${pVals.length + 1} or p.name_cn ilike $${pVals.length + 1} or p.sku ilike $${pVals.length + 1} or p.barcode ilike $${pVals.length + 1})`);
    pVals.push('%' + q.trim() + '%');
  }
  if (lowStockOnly) {
    conds.push('(coalesce(p.remind_stock, 0) > 0 and coalesce(p.stock, 0) <= coalesce(p.remind_stock, 0))');
  }
  if (conds.length) {
    const condSql = ` where ${conds.join(' and ')}`;
    countSql += condSql;
    dataSql += condSql;
  }
  
  const countR = await query(countSql, pVals);
  const total = countR.rows[0].c;

  dataSql += ` order by length(p.sku) asc, p.sku asc limit $${pVals.length + 1} offset $${pVals.length + 2}`;
  pVals.push(pageSize, (pageNum - 1) * pageSize);
  
  const r = await query(dataSql, pVals);
  for (const row of r.rows) {
    const batches = Array.isArray(row.batches) ? row.batches : [];
    const totalStock = Number(row.total_stock || 0);
    const batchedQty = batches.reduce((sum, batch) => sum + Math.max(0, Number(batch?.qty || 0)), 0);
    const hasEmptyLote = batches.some(batch => Number(batch?.qty || 0) > 0 && !String(batch?.lote || '').trim());
    if (!hasEmptyLote && totalStock <= batchedQty) continue;
    const repaired = await reconcileFinishedInventoryBatches(row.id, Date.now());
    row.batches = repaired.batches;
    row.total_stock = repaired.totalStock;
    row.stock = repaired.totalStock;
  }
  res.json({ list: r.rows, total });
});
async function addFinishedInventoryItems(items = [], actorName = 'system', notesText = '') {
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = rawItem || {};
    const productId = Number(item.productId || 0);
    const parsedQty = Number(item.qty || 0);
    const expiry = String(item.expiry || '').trim();
    if (!productId || !Number.isFinite(parsedQty) || parsedQty <= 0) continue;

    const p = await query('select stock from products where id=$1', [productId]);
    if (!p.rows[0]) continue;
    const currentStock = Number(p.rows[0]?.stock || 0);
    let batchQty = parsedQty;
    const entryNow = Date.now();
    const lote = normalizeFinishedInventoryLote(item.lote, entryNow);

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
  const client = await pool.connect();
  try {
    await client.query('begin');
    const p = await client.query('select id from products where id=$1 for update', [pid]);
    if (!p.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not_found' });
    }
    const now = Date.now();
    const batchR = await client.query('select id, quantity, lote, expiration_date from inventory_batches where product_id=$1 order by quantity desc, id desc for update', [pid]);
    const matchBatch = (x) => {
      const raw = String(x.lote || '').trim();
      return raw === loteText || formatLote(raw) === loteText;
    };
    const positiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0 && matchBatch(x));
    const anyBatch = batchR.rows.find(matchBatch);
    const batch = delta < 0 ? positiveBatch : (positiveBatch || anyBatch);
    if (delta > 0) {
      if (batch) {
        const nextExpiry = expiryText || String(batch.expiration_date || '').trim();
        await client.query('update inventory_batches set quantity=quantity+$1, expiration_date=$2 where id=$3', [delta, nextExpiry, batch.id]);
      } else {
        await client.query('insert into inventory_batches(product_id, quantity, expiration_date, lote, created_at) values($1,$2,$3,$4,$5)', [pid, delta, expiryText || '', loteText, now]);
      }
    } else {
      const matchedPositiveBatches = batchR.rows.filter(x => Number(x.quantity || 0) > 0 && matchBatch(x));
      if (!matchedPositiveBatches.length) {
        await client.query('rollback');
        return res.status(400).json({ error: 'batch_not_found' });
      }
      const requiredQty = Math.abs(delta);
      const availableQty = matchedPositiveBatches.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
      if (availableQty + 1e-9 < requiredQty) {
        await client.query('rollback');
        return res.status(400).json({ error: 'insufficient_batch_stock', availableQty });
      }
      let remainingToDeduct = requiredQty;
      for (const matched of matchedPositiveBatches) {
        if (remainingToDeduct <= 1e-9) break;
        const currentQty = Math.max(0, Number(matched.quantity || 0));
        if (currentQty <= 0) continue;
        const takeQty = Math.min(currentQty, remainingToDeduct);
        const nextQty = Math.max(0, currentQty - takeQty);
        const nextExpiry = expiryText || String(matched.expiration_date || '').trim();
        await client.query('update inventory_batches set quantity=$1, expiration_date=$2 where id=$3', [nextQty, nextExpiry, matched.id]);
        remainingToDeduct -= takeQty;
      }
    }
    await syncFinishedStockWithClient(client, pid);
    await client.query('insert into inventory_logs(product_id, quantity, type, created_at, created_by, notes, lote) values($1,$2,$3,$4,$5,$6,$7)', [pid, delta, 'adjust', now, req.user.name || 'system', noteText, loteText]);
    await client.query('commit');
    res.json({ ok: true });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('adjust finished inventory failed', err);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
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
            when coalesce(item->>'lote', '') <> '' then item->>'lote'
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
async function syncMaterialStockWithClient(client, materialId) {
  const stockR = await client.query('select coalesce(sum(case when quantity > 0 then quantity else 0 end), 0) as stock from material_batches where material_id=$1', [materialId]);
  const stock = Number(stockR.rows[0]?.stock || 0);
  await client.query('update materials set stock=$1 where id=$2', [stock, materialId]);
  return stock;
}
async function consumeRawMaterialForProductionPlan(client, { materialName = '', materialQty = 0, productName = '', userName = '' }) {
  const normalizedMaterialName = String(materialName || '').trim();
  const requiredQty = Number(materialQty || 0);
  if (!normalizedMaterialName || !Number.isFinite(requiredQty) || requiredQty <= 0) {
    const err = new Error('bad_request');
    err.code = 'bad_request';
    throw err;
  }
  const materialR = await client.query(
    'select id, name, stock from materials where lower(name)=lower($1) limit 1 for update',
    [normalizedMaterialName]
  );
  const material = materialR.rows[0];
  if (!material) {
    const err = new Error('material_not_found');
    err.code = 'material_not_found';
    throw err;
  }
  const batchR = await client.query(
    `select id, quantity, coalesce(expiration_date, '') as expiration_date, coalesce(lote, '') as lote
       from material_batches
      where material_id=$1 and quantity>0
      order by
        case when coalesce(expiration_date, '')='' then 1 else 0 end asc,
        expiration_date asc,
        created_at asc nulls last,
        id asc
      for update`,
    [material.id]
  );
  const availableQty = batchR.rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
  if (availableQty + 1e-9 < requiredQty) {
    const err = new Error('insufficient_material_stock');
    err.code = 'insufficient_material_stock';
    err.meta = {
      materialName: material.name || normalizedMaterialName,
      requiredQty,
      availableQty
    };
    throw err;
  }
  let remainingQty = requiredQty;
  const now = Date.now();
  const noteText = `生产计划确认扣减：${String(productName || '').trim() || '未命名商品'}`;
  for (const row of batchR.rows) {
    const batchQty = Math.max(0, Number(row.quantity || 0));
    if (batchQty <= 0 || remainingQty <= 1e-9) continue;
    const takeQty = Math.min(batchQty, remainingQty);
    const nextQty = Math.max(0, batchQty - takeQty);
    await client.query('update material_batches set quantity=$1 where id=$2', [nextQty, row.id]);
    await client.query(
      'insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, lote) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [material.id, -takeQty, 'out', now, userName || 'system', noteText, row.expiration_date || '', row.lote || '']
    );
    remainingQty -= takeQty;
  }
  if (remainingQty > 1e-6) {
    const err = new Error('insufficient_material_stock');
    err.code = 'insufficient_material_stock';
    err.meta = {
      materialName: material.name || normalizedMaterialName,
      requiredQty,
      availableQty
    };
    throw err;
  }
  const stock = await syncMaterialStockWithClient(client, material.id);
  return { materialId: material.id, materialName: material.name || normalizedMaterialName, stock };
}
app.get('/api/inventory/raw', authRequired, async (req, res) => {
  const { page='1', size='50', q='' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 50));
  let countSql = 'select count(*)::int as c from materials m';
  let dataSql = `
    select m.id, m.name, m.image, m.merchant_id, coalesce(m.pre_stock, 0) as pre_stock, m.stock, coalesce(nullif(trim(m.category), ''), '其它') as category,
    coalesce(mc.name, m.merchant_name, '') as merchant_name,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date, 'lote', lote) order by expiration_date asc, id asc)
      from material_batches
      where material_id=m.id and quantity>0
    ) as batches
    from materials m
    left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
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
  const category = normalizeRawMaterialCategory(req.body?.category);
  const preStock = Math.max(0, Number(req.body?.pre_stock || 0));
  const merchantIdInput = Number(req.body?.merchant_id || 0) || 0;
  const merchantNameInput = String(req.body?.merchant_name || '').trim();
  if (!name) return res.status(400).json({ error: 'bad_request' });
  let merchantRecord = null;
  if (merchantIdInput > 0) {
    const merchantR = await query('select id, name from contacts where id=$1 and owner=$2 limit 1', [merchantIdInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  } else if (merchantNameInput) {
    const merchantR = await query('select id, name from contacts where lower(name)=lower($1) and owner=$2 limit 1', [merchantNameInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  }
  if ((merchantIdInput > 0 || merchantNameInput) && !merchantRecord) return res.status(400).json({ error: 'merchant_not_found' });
  const exist = await query('select id from materials where lower(name)=lower($1) limit 1', [name]);
  if (exist.rows[0]) return res.status(400).json({ error: 'duplicate' });
  const created = await query(
    'insert into materials(name, image, merchant_id, merchant_name, category, pre_stock, stock) values($1, $2, $3, $4, $5, $6, 0) returning id, name, image, merchant_id, merchant_name, category, pre_stock, stock',
    [name, image, Number(merchantRecord?.id || 0) || null, String(merchantRecord?.name || '').trim(), category, preStock]
  );
  res.json({ ok: true, material: created.rows[0] });
});
app.put('/api/inventory/raw/materials/:id', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const mid = Number(req.params.id || 0);
  const name = String(req.body?.name || '').trim();
  const image = String(req.body?.image || '').trim();
  const category = normalizeRawMaterialCategory(req.body?.category);
  const preStock = Math.max(0, Number(req.body?.pre_stock || 0));
  const merchantIdInput = Number(req.body?.merchant_id || 0) || 0;
  const merchantNameInput = String(req.body?.merchant_name || '').trim();
  if (!mid || !name) return res.status(400).json({ error: 'bad_request' });
  let merchantRecord = null;
  if (merchantIdInput > 0) {
    const merchantR = await query('select id, name from contacts where id=$1 and owner=$2 limit 1', [merchantIdInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  } else if (merchantNameInput) {
    const merchantR = await query('select id, name from contacts where lower(name)=lower($1) and owner=$2 limit 1', [merchantNameInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  }
  if ((merchantIdInput > 0 || merchantNameInput) && !merchantRecord) return res.status(400).json({ error: 'merchant_not_found' });
  const material = await query('select id from materials where id=$1 limit 1', [mid]);
  if (!material.rows[0]) return res.status(404).json({ error: 'not_found' });
  const exist = await query('select id from materials where lower(name)=lower($1) and id<>$2 limit 1', [name, mid]);
  if (exist.rows[0]) return res.status(400).json({ error: 'duplicate' });
  const updated = await query(
    'update materials set name=$1, image=$2, merchant_id=$3, merchant_name=$4, category=$5, pre_stock=$6 where id=$7 returning id, name, image, merchant_id, merchant_name, category, pre_stock, stock',
    [name, image, Number(merchantRecord?.id || 0) || null, String(merchantRecord?.name || '').trim(), category, preStock, mid]
  );
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
  const merchantIdInput = Number(req.body?.merchant_id || 0) || 0;
  const merchantNameInput = String(req.body?.merchant_name || '').trim();
  const category = normalizeRawMaterialCategory(req.body?.category);
  let merchantRecord = null;
  if (merchantIdInput > 0) {
    const merchantR = await query('select id, name from contacts where id=$1 and owner=$2 limit 1', [merchantIdInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  } else if (merchantNameInput) {
    const merchantR = await query('select id, name from contacts where lower(name)=lower($1) and owner=$2 limit 1', [merchantNameInput, '商家']);
    merchantRecord = merchantR.rows[0] || null;
  }
  if ((merchantIdInput > 0 || merchantNameInput) && !merchantRecord) {
    return res.status(400).json({ error: 'merchant_not_found' });
  }
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
      const created = await query('insert into materials(name, category, stock) values($1, $2, 0) returning id, name, category, stock', [materialName, category]);
      material = created.rows[0];
    }
    if (merchantRecord) {
      await query('update materials set merchant_id=$1, merchant_name=$2 where id=$3', [Number(merchantRecord.id || 0) || null, String(merchantRecord.name || '').trim(), material.id]);
    }
    await query('update materials set category=$1 where id=$2', [category, material.id]);
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
      await query(
        `insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, lote, merchant_name)
         select $1,$2,$3,$4,$5,$6,$7,$8,coalesce(mc.name, m.merchant_name, '')
         from materials m
         left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
         where m.id=$1`,
        [material.id, delta, 'in', now, req.user.name || 'system', '', expiryText, loteText]
      );
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
  const client = await pool.connect();
  try {
    await client.query('begin');
    const material = await client.query('select id from materials where id=$1 for update', [mid]);
    if (!material.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not_found' });
    }
    const now = Date.now();
    const batchR = await client.query('select id, quantity, expiration_date from material_batches where material_id=$1 order by quantity desc, id desc for update', [mid]);
    const matchBatch = (x) => String(x.expiration_date || '').trim() === expiryText;
    const positiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0 && matchBatch(x));
    const anyPositiveBatch = batchR.rows.find(x => Number(x.quantity || 0) > 0);
    const anyBatch = batchR.rows.find(matchBatch);
    const batch = expiryText ? (delta < 0 ? positiveBatch : (positiveBatch || anyBatch)) : (delta < 0 ? anyPositiveBatch : anyPositiveBatch);
    if (delta > 0) {
      if (batch && (!expiryText || matchBatch(batch))) {
        await client.query('update material_batches set quantity=quantity+$1, expiration_date=$2 where id=$3', [delta, expiryText || String(batch.expiration_date || ''), batch.id]);
      } else {
        await client.query('insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)', [mid, delta, expiryText, now]);
      }
    } else {
      const matchedPositiveBatches = expiryText
        ? batchR.rows.filter(x => Number(x.quantity || 0) > 0 && matchBatch(x))
        : batchR.rows.filter(x => Number(x.quantity || 0) > 0);
      if (!matchedPositiveBatches.length) {
        await client.query('rollback');
        return res.status(400).json({ error: 'batch_not_found' });
      }
      const requiredQty = Math.abs(delta);
      const availableQty = matchedPositiveBatches.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
      if (availableQty + 1e-9 < requiredQty) {
        await client.query('rollback');
        return res.status(400).json({ error: 'insufficient_batch_stock', availableQty });
      }
      let remainingToDeduct = requiredQty;
      for (const matched of matchedPositiveBatches) {
        if (remainingToDeduct <= 1e-9) break;
        const currentQty = Math.max(0, Number(matched.quantity || 0));
        if (currentQty <= 0) continue;
        const takeQty = Math.min(currentQty, remainingToDeduct);
        const nextQty = Math.max(0, currentQty - takeQty);
        await client.query('update material_batches set quantity=$1 where id=$2', [nextQty, matched.id]);
        remainingToDeduct -= takeQty;
      }
    }
    await syncMaterialStockWithClient(client, mid);
    await client.query(
      `insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, merchant_name)
       select $1,$2,$3,$4,$5,$6,$7,coalesce(mc.name, m.merchant_name, '')
       from materials m
       left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
       where m.id=$1`,
      [mid, delta, 'adjust', now, req.user.name || 'system', noteText, expiryText]
    );
    await client.query('commit');
    res.json({ ok: true });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('adjust raw inventory failed', err);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
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
        coalesce(ml.merchant_name, mc.name, m.merchant_name, '') as merchant_name,
        ml.quantity::numeric as qty,
        ml.type::text as type,
        ml.created_by as user,
        coalesce(ml.notes, '') as notes,
        coalesce(ml.expiration_date, '') as expiry,
        coalesce(ml.lote, '') as lote,
        info.product_name_raw,
        coalesce(prod.name, info.product_name_raw, '') as product_name,
        coalesce(prod.name_cn, '') as product_name_cn
      from material_logs ml
      join materials m on m.id = ml.material_id
      left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
      left join lateral (
        select trim(
          case
            when coalesce(ml.notes, '') like '生产计划确认扣减：%' then substr(coalesce(ml.notes, ''), length('生产计划确认扣减：') + 1)
            else ''
          end
        ) as product_name_raw
      ) info on true
      left join lateral (
        select trim(coalesce(p.name, '')) as name, trim(coalesce(p.name_cn, '')) as name_cn
        from products p
        where info.product_name_raw <> ''
          and (
            trim(coalesce(p.name, '')) = info.product_name_raw
            or trim(coalesce(p.name_cn, '')) = info.product_name_raw
          )
        order by p.id desc
        limit 1
      ) prod on true
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
      merchant_name: x.merchant_name || '',
      qty: Number(x.qty || 0),
      type: x.type || '',
      user: x.user || '',
      notes: x.notes || '',
      expiry: x.expiry || '',
      lote: x.lote || '',
      product_name: x.product_name || '',
      product_name_cn: x.product_name_cn || ''
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
  await query(
    `insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, merchant_name)
     select $1,$2,$3,$4,$5,$6,$7,coalesce(mc.name, m.merchant_name, '')
     from materials m
     left join contacts mc on mc.id = m.merchant_id and mc.owner='商家'
     where m.id=$1`,
    [material.id, totalQty, 'adjust', Date.now(), req.user.name || 'system', '盘点覆盖', today]
  );
  res.json({ ok: true });
});
app.post('/api/inventory/raw/audit-batch', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'bad_request' });
  const auditedAt = Date.now();
  const auditedBy = req.user.name || 'system';
  const requestedCategory = String(req.body?.audit_category || '').trim();
  const auditCategory = RAW_MATERIAL_CATEGORIES.includes(requestedCategory) ? requestedCategory : '全部类别';
  const snapshots = [];
  for (const item of items) {
    const materialId = Number(item?.material_id || 0);
    const countedStock = Number(item?.counted_stock);
    if (!materialId || !Number.isFinite(countedStock) || countedStock < 0) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const materialR = await query(
      `select id, name, coalesce(nullif(trim(category), ''), '其它') as category,
              coalesce(pre_stock, 0) as pre_stock, coalesce(stock, 0) as stock
       from materials where id=$1 limit 1`,
      [materialId]
    );
    const material = materialR.rows[0];
    if (!material) return res.status(404).json({ error: 'not_found' });
    const previousStock = Number(material.stock || 0);
    const difference = countedStock - previousStock;
    snapshots.push({
      materialId,
      materialName: material.name,
      category: material.category,
      preStock: Number(material.pre_stock || 0),
      previousStock,
      countedStock,
      difference
    });
  }
  const sessionR = await query(
    `insert into raw_material_audit_sessions(audited_at, audited_by, audit_category, status)
     values($1,$2,$3,'pending') returning id, audited_at, audited_by, audit_category, status`,
    [auditedAt, auditedBy, auditCategory]
  );
  const sessionId = sessionR.rows[0].id;
  const results = [];
  for (const item of snapshots) {
    const auditR = await query(
      `insert into raw_material_audits
        (session_id, material_id, material_name, category, pre_stock, previous_stock, counted_stock, difference, audited_at, audited_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id, session_id, material_id, material_name, category, pre_stock, previous_stock, counted_stock, difference, audited_at, audited_by`,
      [sessionId, item.materialId, item.materialName, item.category, item.preStock, item.previousStock, item.countedStock, item.difference, auditedAt, auditedBy]
    );
    results.push(auditR.rows[0]);
  }
  res.json({ ok: true, session: sessionR.rows[0], list: results });
});
app.get('/api/inventory/raw/audit-results', authRequired, async (req, res) => {
  const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
  const size = Math.max(1, Math.min(500, parseInt(req.query?.size, 10) || 100));
  const offset = (page - 1) * size;
  const category = String(req.query?.category || '').trim();
  const params = [];
  const conditions = [];
  if (category && RAW_MATERIAL_CATEGORIES.includes(category)) {
    params.push(category);
    conditions.push(`exists (select 1 from raw_material_audits ax where ax.session_id=s.id and ax.category=$${params.length})`);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const countR = await query(`select count(*)::int as total from raw_material_audit_sessions s ${where}`, params);
  params.push(size, offset);
  const resultR = await query(
    `select s.id, s.audited_at, s.audited_by, coalesce(s.audit_category, '全部类别') as audit_category,
            s.status, s.approved_at, s.approved_by,
            count(a.id)::int as item_count,
            count(distinct a.category)::int as category_count,
            string_agg(distinct a.category, '、' order by a.category) as category_names
     from raw_material_audit_sessions s
     left join raw_material_audits a on a.session_id=s.id
     ${where}
     group by s.id, s.audit_category
     order by s.audited_at desc, s.id desc
     limit $${params.length - 1} offset $${params.length}`,
    params
  );
  res.json({ list: resultR.rows, total: Number(countR.rows[0]?.total || 0) });
});
app.get('/api/inventory/raw/audit-results/:id', authRequired, async (req, res) => {
  const sessionId = Number(req.params.id || 0);
  if (!sessionId) return res.status(400).json({ error: 'bad_request' });
  const sessionR = await query(
    `select id, audited_at, audited_by, audit_category, status, approved_at, approved_by
     from raw_material_audit_sessions where id=$1 limit 1`,
    [sessionId]
  );
  if (!sessionR.rows[0]) return res.status(404).json({ error: 'not_found' });
  const itemsR = await query(
    `select id, session_id, material_id, material_name, category, pre_stock, previous_stock,
            counted_stock, difference
     from raw_material_audits where session_id=$1 order by id asc`,
    [sessionId]
  );
  res.json({ session: sessionR.rows[0], list: itemsR.rows });
});
app.put('/api/inventory/raw/audit-results/:id', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const sessionId = Number(req.params.id || 0);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!sessionId || !items.length) return res.status(400).json({ error: 'bad_request' });
  const sessionR = await query('select id, status from raw_material_audit_sessions where id=$1 limit 1', [sessionId]);
  if (!sessionR.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (sessionR.rows[0].status !== 'pending') return res.status(400).json({ error: 'already_approved' });
  for (const item of items) {
    const itemId = Number(item?.id || 0);
    const countedStock = Number(item?.counted_stock);
    if (!itemId || !Number.isFinite(countedStock) || countedStock < 0) return res.status(400).json({ error: 'bad_request' });
    await query(
      `update raw_material_audits
       set counted_stock=$1, difference=$1-previous_stock
       where id=$2 and session_id=$3`,
      [countedStock, itemId, sessionId]
    );
  }
  const listR = await query('select * from raw_material_audits where session_id=$1 order by id asc', [sessionId]);
  res.json({ ok: true, list: listR.rows });
});
app.post('/api/inventory/raw/audit-results/:id/approve', authRequired, ensureAllow('raw_stock','edit'), async (req, res) => {
  const sessionId = Number(req.params.id || 0);
  if (!sessionId) return res.status(400).json({ error: 'bad_request' });
  const sessionR = await query('select id, status from raw_material_audit_sessions where id=$1 limit 1', [sessionId]);
  if (!sessionR.rows[0]) return res.status(404).json({ error: 'not_found' });
  if (sessionR.rows[0].status !== 'pending') return res.status(400).json({ error: 'already_approved' });
  const itemsR = await query('select * from raw_material_audits where session_id=$1 order by id asc', [sessionId]);
  const approvedAt = Date.now();
  const approvedBy = req.user.name || 'system';
  const today = new Date().toISOString().slice(0, 10);
  for (const item of itemsR.rows) {
    const countedStock = Number(item.counted_stock || 0);
    await query('delete from material_batches where material_id=$1', [item.material_id]);
    if (countedStock > 0) {
      await query(
        'insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
        [item.material_id, countedStock, today, approvedAt]
      );
    }
    await query('update materials set stock=$1 where id=$2', [countedStock, item.material_id]);
    await query(
      `insert into material_logs(material_id, quantity, type, created_at, created_by, notes, expiration_date, merchant_name)
       select $1,$2,'adjust',$3,$4,'盘点审核',$5,coalesce(mc.name, m.merchant_name, '')
       from materials m
       left join contacts mc on mc.id=m.merchant_id and mc.owner='商家'
       where m.id=$1`,
      [item.material_id, countedStock - Number(item.previous_stock || 0), approvedAt, approvedBy, today]
    );
  }
  const updatedR = await query(
    `update raw_material_audit_sessions
     set status='approved', approved_at=$1, approved_by=$2
     where id=$3
     returning id, audited_at, audited_by, audit_category, status, approved_at, approved_by`,
    [approvedAt, approvedBy, sessionId]
  );
  res.json({ ok: true, session: updatedR.rows[0] });
});

function cleanupExpiredPdfPreviewEntries() {
  const now = Date.now();
  for (const [token, record] of pdfPreviewStore.entries()) {
    if (!record || Number(record.expiresAt || 0) <= now) {
      pdfPreviewStore.delete(token);
    }
  }
}
function sanitizePdfExportFileName(name, fallback = 'document') {
  const base = String(name || '').trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return (base || fallback).slice(0, 120);
}
async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (e) {
    return false;
  }
}
async function getUniqueDesktopPdfPath(fileName) {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  await fs.mkdir(desktopDir, { recursive: true });
  const safeBase = sanitizePdfExportFileName(fileName, 'document');
  let candidate = path.join(desktopDir, `${safeBase}.pdf`);
  let index = 2;
  while (await fileExists(candidate)) {
    candidate = path.join(desktopDir, `${safeBase}-${index}.pdf`);
    index += 1;
  }
  return candidate;
}
async function getTempPdfPath(fileName) {
  const tempDir = path.join(os.tmpdir(), 'ts-pdf-exports');
  await fs.mkdir(tempDir, { recursive: true });
  const safeBase = sanitizePdfExportFileName(fileName, 'document');
  return path.join(tempDir, `${safeBase}-${crypto.randomUUID()}.pdf`);
}
async function resolvePdfBrowserExecutable() {
  const absoluteCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const target of absoluteCandidates) {
    if (await fileExists(target)) return target;
  }
  const commandCandidates = ['google-chrome', 'chromium-browser', 'chromium'];
  for (const command of commandCandidates) {
    try {
      const { stdout } = await execFileAsync('which', [command]);
      const resolved = String(stdout || '').trim();
      if (resolved) return resolved;
    } catch (e) {
    }
  }
  return '';
}
app.get('/api/pdf-preview/:token', async (req, res) => {
  cleanupExpiredPdfPreviewEntries();
  const token = String(req.params.token || '').trim();
  const record = pdfPreviewStore.get(token);
  if (!record) return res.status(404).send('not_found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(String(record.html || ''));
});
app.post('/api/pdf-export-desktop', authRequired, async (req, res) => {
  cleanupExpiredPdfPreviewEntries();
  const html = String(req.body?.html || '').trim();
  const fileName = sanitizePdfExportFileName(req.body?.fileName || 'document', 'document');
  if (!html) return res.status(400).json({ error: 'bad_request' });
  const browserExecutable = await resolvePdfBrowserExecutable();
  if (!browserExecutable) return res.status(500).json({ error: 'pdf_browser_not_found' });
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  pdfPreviewStore.set(token, { html, expiresAt });
  const pdfPath = await getTempPdfPath(fileName);
  const previewUrl = `http://127.0.0.1:${PORT}/api/pdf-preview/${encodeURIComponent(token)}`;
  try {
    await execFileAsync(browserExecutable, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--virtual-time-budget=300',
      `--print-to-pdf=${pdfPath}`,
      previewUrl
    ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const pdfBuffer = await fs.readFile(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}.pdf`)}`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('pdf export failed', e);
    res.status(500).json({ error: 'pdf_export_failed' });
  } finally {
    pdfPreviewStore.delete(token);
    await fs.rm(pdfPath, { force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
