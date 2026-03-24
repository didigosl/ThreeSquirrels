const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@ts-db:5432/komeya' });
async function run() {
  const res = await pool.query('select id, items from invoices');
  let fixed = 0;
  for (const row of res.rows) {
    const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
    const total = items.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      let taxRate = Number(item.tax_rate);
      if (isNaN(taxRate) || item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '') {
        taxRate = 0.10;
      }
      if (taxRate >= 1) taxRate = taxRate / 100;
      return sum + (qty * price) + (qty * price * taxRate);
    }, 0);
    
    await pool.query('update invoices set total_amount=$1 where id=$2', [total, row.id]);
    
    const invRes = await pool.query('select invoice_no from invoices where id=$1', [row.id]);
    if (invRes.rows[0]) {
       await pool.query("update payables set amount=$1, invoice_amount=$1 where doc=$2 and type='应收账款'", [total, invRes.rows[0].invoice_no]);
    }
    fixed++;
  }
  console.log('Fixed ' + fixed + ' invoices');
  process.exit(0);
}
run();
