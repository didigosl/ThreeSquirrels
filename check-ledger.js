const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@ts-db:5432/komeya' });
pool.query("select id, amount, type, method, doc from ledger where confirmed=true and (doc is null or doc='') and method is not null and method != ''").then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(console.error);
