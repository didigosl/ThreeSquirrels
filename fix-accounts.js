const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@ts-db:5432/komeya' });

async function run() {
  const res = await pool.query("select amount, type, method from ledger where confirmed=true and (doc is null or doc='') and method is not null and method != ''");
  
  for (const row of res.rows) {
    const amt = Number(row.amount);
    const method = row.method.trim();
    if (row.type === '收入') {
      await pool.query('update accounts set balance = coalesce(balance,0) + $1 where trim(name) = $2', [amt, method]);
      console.log(`Added ${amt} to ${method}`);
    } else if (row.type === '支出' || row.type === '开支') {
      await pool.query('update accounts set balance = coalesce(balance,0) - $1 where trim(name) = $2', [amt, method]);
      console.log(`Deducted ${amt} from ${method}`);
    }
  }
  console.log('Done.');
  process.exit(0);
}
run().catch(console.error);
