create table if not exists users(
  id serial primary key,
  name text unique not null,
  role text,
  created text,
  enabled boolean not null default true,
  password text
);
create table if not exists ledger(
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
  created_by text,
  confirmed boolean default true
);
create table if not exists contacts(
  id serial primary key,
  type text default '客户',
  name text not null,
  contact text,
  phone text,
  city text,
  remark text,
  owner text not null,
  created text,
  company text,
  code text,
  country text,
  address text,
  zip text,
  sales text
);
create table if not exists payables(
  id serial primary key,
  type text not null,
  partner text not null,
  doc text not null,
  amount numeric not null default 0,
  paid numeric default 0,
  settled boolean default false,
  trust_days int default 30,
  notes text,
  invoice_no text,
  invoice_date text,
  invoice_amount numeric,
  sales text,
  date text,
  created_at bigint,
  batch_at bigint,
  batch_order int,
  source text,
  history jsonb default '[]'::jsonb,
  confirmed boolean default true
);
