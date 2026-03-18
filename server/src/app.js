import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { query } from './db.js';
import crypto from 'crypto';

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
  await query('alter table products add column if not exists spec text', []);
  await query('alter table products add column if not exists stock numeric default 0', []);
  await query('alter table products add column if not exists notes text', []);
  await query('alter table products add column if not exists created_at bigint', []);
  await query('alter table products add column if not exists created_by text', []);

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
    create table if not exists daily_orders (
      id serial primary key,
      customer text,
      sales text,
      items jsonb default '[]'::jsonb,
      status text default 'new', -- new, allocated, shipped
      created_by text,
      created_at bigint,
      invoice_id int,
      date text
    );
    create table if not exists inventory_batches (
      id serial primary key,
      product_id int,
      quantity numeric default 0,
      expiration_date text,
      created_at bigint
    );
    create table if not exists inventory_logs (
      id serial primary key,
      product_id int,
      quantity numeric,
      type text, -- 'in', 'out'
      created_at bigint,
      created_by text,
      notes text
    );
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
  `);
  // Migrations
  try { await query('alter table tasks add column completion_image text'); } catch {}
  try { await query('alter table tasks add column completion_desc text'); } catch {}
  try { await query('alter table tasks add column time_limit int default 0'); } catch {}
}
// Ensure schema then defaults sequentially to avoid race
(async () => {
  try {
    if (await waitForDb()) {
      await ensureSchema();
      await ensureDefaults();
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

  const u = await query('select count(*)::int as c from users where name=$1', ['aaaaaa']);
  if (u.rows[0].c === 0) {
    console.log('Inserting missing user: aaaaaa');
    await query('insert into users(name, role, created, enabled, password) values($1,$2,$3,true,$4)', ['aaaaaa','超级管理员', now, '999000']);
  }
  await query("update users set enabled=true where name=$1 and enabled is null", ['aaaaaa']);
  await query("update users set password_hash=password where name=$1 and (password_hash is null or password_hash='')", ['aaaaaa']);
  
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

function ensureAllow(module, action) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error:'unauthorized' });
    const roleName = req.user.role || '';
    if (roleName === '超级管理员') return next();
    
    let perms = rolePermsCache.get(roleName);
    if (!perms) {
      const r = await query('select perms from roles where name=$1', [roleName]);
      perms = (r.rows[0]?.perms) || {};
      rolePermsCache.set(roleName, perms);
    }
    
    if (perms[module] && perms[module][action]) return next();
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
  const stored = (u?.password && String(u.password)) || (u?.password_hash && String(u.password_hash)) || '';
  if (!u || !u.enabled || stored !== String(password||'')) return res.status(401).json({ error:'bad_credentials' });
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
  const stored = (u?.password && String(u.password)) || (u?.password_hash && String(u.password_hash)) || '';
  if (stored !== String(oldPassword)) return res.status(401).json({ error:'bad_credentials' });
  await query('update users set password=$1, password_hash=$1 where id=$2', [String(newPassword), Number(u.id||0)]);
  res.json({ ok: true });
});
app.get('/api/auth/me', authRequired, async (req, res) => {
  res.json({ user: req.user });
});

function normalizePayable(rec) {
  const now = Date.now();
  const paid = Math.min(Number(rec.paid || 0), Number(rec.amount || 0));
  const settled = Number(rec.amount || 0) > 0 && paid >= Number(rec.amount || 0);
  const history = Array.isArray(rec.history) ? rec.history : [];
  return {
    type: String(rec.type || ''),
    partner: String(rec.partner || ''),
    doc: String(rec.doc || ''),
    amount: Number(rec.amount || 0),
    paid,
    settled,
    trust_days: rec.trustDays ?? null,
    notes: String(rec.notes || ''),
    invoice_no: String(rec.invoiceNo || ''),
    invoice_date: String(rec.invoiceDate || ''),
    invoice_amount: Number(rec.invoiceAmount || 0),
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

app.get('/api/ledger', authRequired, ensureAllow('ledger','view'), async (req, res) => {
  const r = await query('select * from ledger order by created_at desc nulls last, id desc');
  res.json(r.rows);
});
async function applyLedgerEffects(x) {
  if (x.doc && x.type) {
    if (x.type === '收入') {
      await query(`update payables set paid = least(coalesce(paid,0) + $1, amount), settled = (least(coalesce(paid,0) + $1, amount) >= amount),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where doc=$7 and type='应收账款'`, [Number(x.amount||0), x.date_time||x.date||'', x.created_by||'', '收款', x.notes||'', x.method||'', x.doc]);
      if (x.method) await query(`update accounts set balance = coalesce(balance,0) + $1 where name=$2`, [Number(x.amount||0), x.method||'']);
    } else if (x.type === '支出' || x.type === '开支') {
      await query(`update payables set paid = least(coalesce(paid,0) + $1, amount), settled = (least(coalesce(paid,0) + $1, amount) >= amount),
        history = coalesce(history,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',$2::text,'user',$3::text,'kind',$4::text,'amount',$1::numeric,'partner',partner,'doc',doc,'notes',$5::text,'method',$6::text))
        where doc=$7 and type='应付账款'`, [Number(x.amount||0), x.date_time||x.date||'', x.created_by||'', '付款', x.notes||'', x.method||'', x.doc]);
      if (x.method) await query(`update accounts set balance = coalesce(balance,0) - $1 where name=$2`, [Number(x.amount||0), x.method||'']);
    }
  }
}
app.post('/api/ledger', authRequired, ensureAllow('ledger','create'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const confirmed = x.confirmed === false ? false : true;
  const r = await query(`
    insert into ledger(type,category,doc,client,amount,method,file,notes,date,date_time,created_at,created_by,confirmed)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    returning id
  `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', now, x.createdBy||'', confirmed]);
  if (confirmed) await applyLedgerEffects({ type:x.type, doc:x.doc, amount:x.amount, method:x.method, date_time:x.dateTime, date:x.date, created_by:x.createdBy, notes:x.notes });
  res.json({ id: r.rows[0].id });
});
app.put('/api/ledger/:id', authRequired, ensureAllow('ledger','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  const r = await query(`
    update ledger set
      type=$1, category=$2, doc=$3, client=$4, amount=$5, method=$6, file=$7, notes=$8,
      date=$9, date_time=$10, created_by=$11
    where id=$12 and confirmed=false
    returning id
  `, [x.type||'', x.category||'', x.doc||'', x.client||'', Number(x.amount||0), x.method||'', x.file||'', x.notes||'', x.date||'', x.dateTime||'', x.createdBy||'', id]);
  if (!r.rows[0]) return res.status(400).json({ error:'not_editable' });
  res.json({ ok: true });
});
app.put('/api/ledger/:id/confirm', authRequired, ensureAllow('ledger','create'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r0 = await query('select * from ledger where id=$1 and confirmed=false', [id]);
  const row = r0.rows[0];
  if (!row) return res.status(404).json({ error:'not_found' });
  await applyLedgerEffects(row);
  await query('update ledger set confirmed=true where id=$1', [id]);
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
  const pageSize = Math.max(1, Math.min(500, parseInt(size, 10) || 100));
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
      insert into contacts(name, contact, phone, city, remark, owner, created, company, code, country, address, zip, sales, use_price, is_iva, email, province, ship_address, ship_zip, ship_city, ship_province, ship_country, ship_phone, ship_contact)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning id
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', owner, x.created||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva, x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'']);
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
      email=$14, province=$15, ship_address=$16, ship_zip=$17, ship_city=$18, ship_province=$19, ship_country=$20, ship_phone=$21, ship_contact=$22
      where id=$23
    `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
        x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
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
    email=$13, province=$14, ship_address=$15, ship_zip=$16, ship_city=$17, ship_province=$18, ship_country=$19, ship_phone=$20, ship_contact=$21
    where owner=$22 and name=$23
  `, [x.contact||'', x.phone||'', x.city||'', x.remark||'', x.company||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
      x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
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
    email=$13, province=$14, ship_address=$15, ship_zip=$16, ship_city=$17, ship_province=$18, ship_country=$19, ship_phone=$20, ship_contact=$21
    where id=$22
  `, [x.name||'', x.contact||'', x.phone||'', x.city||'', x.remark||'', x.code||'', x.country||'', x.address||'', x.zip||'', x.sales||'', x.use_price||'price1', isIva,
      x.email||'', x.province||'', x.ship_address||'', x.ship_zip||'', x.ship_city||'', x.ship_province||'', x.ship_country||'', x.ship_phone||'', x.ship_contact||'',
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
  await query('update users set role=$1, enabled=$2 where id=$3', [x.role||'', !!x.enabled, id]);
  res.json({ ok: true });
});
app.post('/api/users/:id/reset-password', authRequired, ensureAllow('user_accounts','reset_password'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const { password = '111111' } = req.body || {};
  await query('update users set password=$1, password_hash=$1 where id=$2', [password, id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authRequired, ensureAllow('user_accounts','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === 1) return res.status(403).json({ error: 'cannot_delete_superadmin' });
  await query('delete from users where id=$1', [id]);
  res.json({ ok: true });
});

app.get('/api/analytics/ledger-summary', authRequired, ensureAllow('ledger','view'), async (req, res) => {
  const { period='month', range='12' } = req.query;
  const n = Math.max(1, Math.min(365, parseInt(range, 10) || 12));
  const now = new Date();
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
    const income = Number((r.rows.find(x => x.type === '收入')?.total) || 0);
    const expense = Number((r.rows.find(x => x.type === '开支')?.total) || 0);
    out.push({ label, income, expense });
  }
  res.json(out);
});

app.get('/api/analytics/sales-summary', authRequired, async (req, res) => {
  const { period='month', range='12' } = req.query;
  const n = Math.max(1, Math.min(365, parseInt(range, 10) || 12));
  const now = new Date();
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
app.get('/api/products', authRequired, ensureAllow('sales_products','view'), async (req, res) => {
  const { q='', page='1', size='50' } = req.query;
  const p = [];
  let sql = 'select * from products';
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
  try {
    const r = await query(`
      insert into products(sku, barcode, name, name_cn, image, description, price1, price2, price3, price4, tax_rate, spec, stock, notes, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id
    `, [x.sku||'', x.barcode||'', x.name||'', x.name_cn||'', x.image||'', x.description||'', 
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0), 
        x.spec||'', Number(x.stock||0), x.notes||'', now, req.user.name||'']);
    res.json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'duplicate_sku' });
    throw e;
  }
});

app.put('/api/products/:id', authRequired, ensureAllow('sales_products','edit'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const x = req.body || {};
  try {
    const r = await query(`
      update products set sku=$1, barcode=$2, name=$3, name_cn=$4, image=$5, description=$6, 
      price1=$7, price2=$8, price3=$9, price4=$10, tax_rate=$11, spec=$12, stock=$13, notes=$14
      where id=$15 returning id
    `, [x.sku||'', x.barcode||'', x.name||'', x.name_cn||'', x.image||'', x.description||'', 
        Number(x.price1||0), Number(x.price2||0), Number(x.price3||0), Number(x.price4||0), Number(x.tax_rate||0), 
        x.spec||'', Number(x.stock||0), x.notes||'', id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'duplicate_sku' });
    throw e;
  }
});

app.delete('/api/products/:id', authRequired, ensureAllow('sales_products','delete'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  await query('delete from products where id=$1', [id]);
  res.json({ ok: true });
});

// Invoices endpoints
app.get('/api/invoices', authRequired, ensureAllow('sales_invoice','view'), async (req, res) => {
  const { q='', page='1', size='100' } = req.query;
  const p = [];
  let sql = `
    select i.*, 
    (select coalesce(sum(paid),0) from payables where doc=i.invoice_no and type='应收账款') as paid_amount
    from invoices i
  `;
  const conds = [];
  if (q && q.trim()) {
    conds.push(`(i.invoice_no ilike $${p.length+1} or i.customer ilike $${p.length+1})`);
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
  const year = new Date().getFullYear();
  const prefix = String(year);
  const rMax = await query('select invoice_no from invoices where invoice_no like $1 order by invoice_no desc limit 1', [prefix + '%']);
  let nextSeq = 1;
  if (rMax.rows[0]) {
    const lastNo = rMax.rows[0].invoice_no;
    const seqPart = lastNo.slice(4); // remove YYYY
    if (/^\d+$/.test(seqPart)) {
      nextSeq = parseInt(seqPart, 10) + 1;
    }
  }
  const nextNo = prefix + String(nextSeq).padStart(5, '0');
  res.json({ nextNo });
});

app.post('/api/invoices', authRequired, ensureAllow('sales_order','view'), async (req, res) => {
  const x = req.body || {};
  const now = Date.now();
  const dateObj = new Date();
  const year = dateObj.getFullYear();
  
  // Use provided invoice_no or generate new one
  let invoiceNo = x.invoice_no;
  if (!invoiceNo) {
    const prefix = String(year);
    const rMax = await query('select invoice_no from invoices where invoice_no like $1 order by invoice_no desc limit 1', [prefix + '%']);
    let nextSeq = 1;
    if (rMax.rows[0]) {
      const lastNo = rMax.rows[0].invoice_no;
      const seqPart = lastNo.slice(4); // remove YYYY
      if (/^\d+$/.test(seqPart)) {
        nextSeq = parseInt(seqPart, 10) + 1;
      }
    }
    invoiceNo = prefix + String(nextSeq).padStart(5, '0');
  }

  const items = Array.isArray(x.items) ? x.items : [];
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
    const rowVal = qty * price;
    const rowTax = rowVal * taxRate;
    return sum + rowVal + rowTax;
  }, 0);

  // Update Stock
  for (const item of items) {
    const qty = Number(item.qty || 0);
    if (qty > 0) {
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
        // 1. Update total stock
        await query('update products set stock = stock - $1 where id=$2', [qty, pid]);
        
        // 2. Deduct from batches (FIFO)
        let remaining = qty;
        const batches = await query('select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc', [pid]);
        
        item.deductions = []; // Store deduction info
        
        for (const b of batches.rows) {
          if (remaining <= 0) break;
          const take = Math.min(Number(b.quantity), remaining);
          
          if (Number(b.quantity) === take) {
            await query('update inventory_batches set quantity = 0 where id=$1', [b.id]);
          } else {
            await query('update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
          }
          
          item.deductions.push({
            batch_id: b.id,
            qty: take,
            expiry: b.expiration_date
          });
          
          remaining -= take;
        }
      }
    }
  }

  const r = await query(`
    insert into invoices(invoice_no, customer, date, items, total_amount, notes, sales, created_at, created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, invoice_no
  `, [invoiceNo, x.customer||'', x.date||'', JSON.stringify(items), total, x.notes||'', x.sales||'', now, req.user.name||'']);

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

  // Restore Stock
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  for (const item of items) {
    const qty = Number(item.qty || 0);
    if (qty > 0) {
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
        await query('update products set stock = stock + $1 where id=$2', [qty, pid]);
        
        // Restore batches if deduction info exists
        if (item.deductions && Array.isArray(item.deductions)) {
           for (const d of item.deductions) {
              const b = await query('select id from inventory_batches where id=$1', [d.batch_id]);
              if (b.rows[0]) {
                 await query('update inventory_batches set quantity = quantity + $1 where id=$2', [d.qty, d.batch_id]);
              } else {
                 // Recreate batch
                 await query('insert into inventory_batches(product_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
                      [pid, d.qty, d.expiry, Date.now()]);
              }
           }
        }
      }
    }
  }

  // Delete Payable
  await query("delete from payables where doc=$1 and type='应收账款'", [inv.invoice_no]);
  
  // Delete Invoice
  await query('delete from invoices where id=$1', [id]);
  
  res.json({ ok: true });
});

app.put('/api/invoices/:id/print-shipping', authRequired, ensureAllow('sales_order','view'), async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const r = await query('update invoices set shipping_printed=true where id=$1 returning id', [id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

app.put('/api/invoices/:id', authRequired, ensureAllow('sales_order','view'), async (req, res) => {
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
  if (paid >= oldTotal && oldTotal > 0) {
    return res.status(400).json({ error: 'cannot_edit_paid_invoice' });
  }

  // Restore Old Stock
  const oldItems = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  for (const item of oldItems) {
    const qty = Number(item.qty || 0);
    if (qty > 0) {
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
        await query('update products set stock = stock + $1 where id=$2', [qty, pid]);
        
        if (item.deductions && Array.isArray(item.deductions)) {
           for (const d of item.deductions) {
              const b = await query('select id from inventory_batches where id=$1', [d.batch_id]);
              if (b.rows[0]) {
                 await query('update inventory_batches set quantity = quantity + $1 where id=$2', [d.qty, d.batch_id]);
              } else {
                 await query('insert into inventory_batches(product_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
                      [pid, d.qty, d.expiry, Date.now()]);
              }
           }
        }
      }
    }
  }

  const items = Array.isArray(x.items) ? x.items : [];
  // Deduct New Stock
  for (const item of items) {
    const qty = Number(item.qty || 0);
    if (qty > 0) {
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
        await query('update products set stock = stock - $1 where id=$2', [qty, pid]);
        
        let remaining = qty;
        const batches = await query('select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc', [pid]);
        
        item.deductions = [];
        
        for (const b of batches.rows) {
          if (remaining <= 0) break;
          const take = Math.min(Number(b.quantity), remaining);
          
          if (Number(b.quantity) === take) {
            await query('update inventory_batches set quantity = 0 where id=$1', [b.id]);
          } else {
            await query('update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
          }
          
          item.deductions.push({
            batch_id: b.id,
            qty: take,
            expiry: b.expiration_date
          });
          
          remaining -= take;
        }
      }
    }
  }

  // Recalculate total
  const total = items.reduce((sum, item) => {
    const qty = Number(item.qty||0);
    const price = Number(item.price||0);
    let taxRate = Number(item.tax_rate);
    if (isNaN(taxRate) || item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '') {
      taxRate = 0.10;
    }
    const rowVal = qty * price;
    const rowTax = rowVal * taxRate;
    return sum + rowVal + rowTax;
  }, 0);

  // Update invoice
  await query(`
    update invoices set customer=$1, date=$2, items=$3, total_amount=$4, notes=$5, sales=$6
    where id=$7
  `, [x.customer||'', x.date||'', JSON.stringify(items), total, x.notes||'', x.sales||'', id]);
  
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

app.get('/api/company-info', authRequired, ensureAllow('system','view'), async (req, res) => {
  const r = await query('select * from company_info limit 1');
  res.json(r.rows[0] || {});
});

app.post('/api/company-info', authRequired, ensureAllow('system','edit'), async (req, res) => {
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

app.get('/api/tasks', authRequired, async (req, res) => {
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
app.post('/api/tasks', authRequired, async (req, res) => {
  const x = req.body || {};
  const timeLimit = parseInt(x.timeLimit, 10) || 0;
  const r = await query(`insert into tasks(title,description,created_by,created_at,assigned_to,time_limit) values($1,$2,$3,$4,$5,$6) returning id`,
    [x.title||'', x.desc||'', req.user.name, Date.now(), x.assign||'', timeLimit]);
  res.json({ id: r.rows[0].id });
});
app.put('/api/tasks/:id/complete', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { image, desc } = req.body;
  await query('update tasks set status=$1, completed_by=$2, completed_at=$3, completion_image=$4, completion_desc=$5 where id=$6', ['waiting_audit', req.user.name, Date.now(), image||'', desc||'', id]);
  res.json({ ok: true });
});
app.put('/api/tasks/:id/audit', authRequired, async (req, res) => {
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
  if (status) { sql += ' where d.status=$1'; p.push(status); }
  sql += ' order by d.created_at desc';
  const r = await query(sql, p);
  res.json(r.rows);
});
app.post('/api/daily-orders', authRequired, async (req, res) => {
  const x = req.body || {};
  const items = Array.isArray(x.items) ? x.items : [];
  const r = await query(`insert into daily_orders(customer,sales,items,created_by,created_at,date) values($1,$2,$3,$4,$5,$6) returning id`,
    [x.customer||'', x.sales||'', JSON.stringify(items), req.user.name, Date.now(), x.date||'']);
  res.json({ id: r.rows[0].id });
});
app.put('/api/daily-orders/:id/allocate', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { items } = req.body; // updated items with allocated_qty
  
  // 1. Update order
  await query('update daily_orders set items=$1, status=$2 where id=$3', [JSON.stringify(items), 'allocated', id]);
  
  res.json({ ok: true });
});
app.put('/api/daily-orders/:id/ship', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await query('update daily_orders set status=$1 where id=$2', ['shipped', id]);
  
  // Auto Create Invoice & Deduct Stock
  const ord = (await query('select * from daily_orders where id=$1', [id])).rows[0];
  if (!ord.invoice_id) {
    const items = typeof ord.items === 'string' ? JSON.parse(ord.items) : (ord.items || []);
    
    // Generate invoice logic
    const year = new Date().getFullYear();
    const prefix = String(year);
    const rMax = await query('select invoice_no from invoices where invoice_no like $1 order by invoice_no desc limit 1', [prefix + '%']);
    let nextSeq = 1;
    if (rMax.rows[0]) {
      const lastNo = rMax.rows[0].invoice_no;
      const seqPart = lastNo.slice(4);
      if (/^\d+$/.test(seqPart)) nextSeq = parseInt(seqPart, 10) + 1;
    }
    const invoiceNo = prefix + String(nextSeq).padStart(5, '0');
    
    // Use allocated_qty for invoice items
    const invoiceItems = items.map(item => {
      const shipQty = Number(item.allocated_qty !== undefined ? item.allocated_qty : (item.qty || 0));
      return { ...item, qty: shipQty, original_qty: item.qty };
    });
    
    // Calculate total
    const total = invoiceItems.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      let taxRate = Number(item.tax_rate);
      if (isNaN(taxRate)) taxRate = 0.10;
      return sum + (qty * price * (1 + taxRate));
    }, 0);

    const now = Date.now();

    // Deduct Stock (FIFO Logic) & populate deductions
    for (const item of invoiceItems) {
      const qty = Number(item.qty || 0);
      let pid = item.productId;
      if (!pid && item.name) {
        const p = await query('select id from products where name=$1', [item.name]);
        if (p.rows[0]) pid = p.rows[0].id;
      }

      if (qty > 0 && pid) {
         // Update total stock
         await query('update products set stock = stock - $1 where id=$2', [qty, pid]);

         // Deduct from batches
         let remaining = qty;
         const batches = await query('select * from inventory_batches where product_id=$1 and quantity > 0 order by expiration_date asc', [pid]);
         
         item.deductions = [];
         
         for (const b of batches.rows) {
           if (remaining <= 0) break;
           const take = Math.min(Number(b.quantity), remaining);
           
           if (Number(b.quantity) === take) {
             await query('update inventory_batches set quantity = 0 where id=$1', [b.id]);
           } else {
             await query('update inventory_batches set quantity = quantity - $1 where id=$2', [take, b.id]);
           }
           
           item.deductions.push({
             batch_id: b.id,
             qty: take,
             expiry: b.expiration_date
           });
           
           remaining -= take;
         }
      }
    }

    // Insert Invoice
    const inv = await query(`
      insert into invoices(invoice_no, customer, date, items, total_amount, sales, created_at, created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id
    `, [invoiceNo, ord.customer, ord.date, JSON.stringify(invoiceItems), total, ord.sales, now, 'system']);
    
    // Create Payable
    await query(`
      insert into payables(type, partner, doc, amount, paid, settled, trust_days, invoice_no, invoice_date, invoice_amount, sales, date, created_at, batch_at, source)
      values($1,$2,$3,$4,0,false,30,$5,$6,$7,$8,$9,$10,$11,'sales_order')
    `, ['应收账款', ord.customer, invoiceNo, total, invoiceNo, ord.date, total, ord.sales, ord.date, now, now]);
    
    await query('update daily_orders set invoice_id=$1 where id=$2', [inv.rows[0].id, id]);
  }

  res.json({ ok: true });
});

// Inventory (Finished)
app.get('/api/inventory/finished', authRequired, async (req, res) => {
  // Aggregate by product
  // Show image, name, expiry (nearest?), total qty
  // User asked for "List products sorted by qty desc... show expiry". If multiple batches, maybe show nearest expiry?
  // Let's return list of products with their batches or flattened?
  // User: "List shows product image, name, expiry time, stock qty".
  // Let's join products and batches.
  const r = await query(`
    select p.id, p.name, p.name_cn, p.image, p.stock as total_stock,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date) order by expiration_date asc)
      from inventory_batches
      where product_id=p.id and quantity>0
    ) as batches
    from products p
    order by length(p.sku) asc, p.sku asc
  `);
  res.json(r.rows);
});
app.post('/api/inventory/finished', authRequired, async (req, res) => {
  const { productId, qty, expiry } = req.body;
  
  const p = await query('select stock from products where id=$1', [productId]);
  const currentStock = Number(p.rows[0]?.stock || 0);
  let batchQty = Number(qty);
  
  if (currentStock <= 0) {
    // Clean up any ghost batches from before FIFO was implemented
    await query('update inventory_batches set quantity = 0 where product_id=$1', [productId]);
  }
  
  if (currentStock < 0) {
    const deficit = Math.abs(currentStock);
    if (batchQty > deficit) {
      batchQty -= deficit;
    } else {
      batchQty = 0;
    }
  }
  
  if (batchQty > 0) {
    await query('insert into inventory_batches(product_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
      [productId, batchQty, expiry, Date.now()]);
  }
  
  await query('update products set stock = stock + $1 where id=$2', [qty, productId]);
  
  // Log addition
  await query('insert into inventory_logs(product_id, quantity, type, created_at, created_by) values($1,$2,$3,$4,$5)',
    [productId, qty, 'in', Date.now(), req.user.name]);
    
  res.json({ ok: true });
});

app.get('/api/inventory/finished/:id/logs', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  
  // 1. Get Additions (In)
  const ins = await query('select * from inventory_logs where product_id=$1 and type=\'in\' order by created_at desc', [id]);
  
  // 2. Get Sales (Out) from invoices
  const outs = await query(`
    select i.created_at, i.created_by, i.invoice_no, (item->>'qty')::numeric as qty
    from invoices i, jsonb_array_elements(i.items) as item
    where (item->>'productId')::int = $1
    order by i.created_at desc
  `, [id]);
  
  const logs = [
    ...ins.rows.map(x => ({
      type: 'in',
      date: Number(x.created_at),
      qty: Number(x.quantity),
      user: x.created_by
    })),
    ...outs.rows.map(x => ({
      type: 'out',
      date: Number(x.created_at),
      qty: Number(x.qty),
      user: x.created_by,
      ref: x.invoice_no
    }))
  ].sort((a,b) => b.date - a.date);
  
  res.json(logs);
});

// Inventory (Raw)
app.get('/api/inventory/raw', authRequired, async (req, res) => {
  const r = await query(`
    select m.*,
    (
      select json_agg(json_build_object('qty', quantity, 'expiry', expiration_date) order by expiration_date asc)
      from material_batches
      where material_id=m.id and quantity>0
    ) as batches
    from materials m
    order by m.stock desc
  `);
  res.json(r.rows);
});
app.post('/api/inventory/raw', authRequired, async (req, res) => {
  const { name, qty, expiry } = req.body;
  // Check if material exists
  let mid;
  const exist = await query('select id, stock from materials where name=$1', [name]);
  
  let currentStock = 0;
  if (exist.rows[0]) {
    mid = exist.rows[0].id;
    currentStock = Number(exist.rows[0].stock || 0);
    await query('update materials set stock = stock + $1 where id=$2', [qty, mid]);
  } else {
    const n = await query('insert into materials(name, stock) values($1,$2) returning id', [name, qty]);
    mid = n.rows[0].id;
  }
  
  let batchQty = Number(qty);
  
  if (currentStock <= 0) {
    // Clean up ghost batches
    if (mid) await query('update material_batches set quantity = 0 where material_id=$1', [mid]);
  }
  
  if (currentStock < 0) {
    const deficit = Math.abs(currentStock);
    if (batchQty > deficit) {
      batchQty -= deficit;
    } else {
      batchQty = 0;
    }
  }
  
  if (batchQty > 0) {
    await query('insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
      [mid, batchQty, expiry, Date.now()]);
  }
  
  res.json({ ok: true });
});
app.put('/api/inventory/raw/audit', authRequired, async (req, res) => {
  const { name, qty } = req.body; // Overwrite
  // Clear batches
  let mid;
  const exist = await query('select id from materials where name=$1', [name]);
  if (exist.rows[0]) {
    mid = exist.rows[0].id;
    await query('delete from material_batches where material_id=$1', [mid]);
    await query('update materials set stock=$1 where id=$2', [qty, mid]);
  } else {
    const n = await query('insert into materials(name, stock) values($1,$2) returning id', [name, qty]);
    mid = n.rows[0].id;
  }
  // Create a single batch for current audit
  const today = new Date().toISOString().slice(0,10);
  await query('insert into material_batches(material_id, quantity, expiration_date, created_at) values($1,$2,$3,$4)',
    [mid, qty, today, Date.now()]);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
