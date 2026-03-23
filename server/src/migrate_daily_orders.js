import { query } from './db.js';

async function migrate() {
  console.log('Fetching daily_orders...');
  const res = await query("SELECT id, items FROM daily_orders");
  for (const row of res.rows) {
    let changed = false;
    let items;
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    } catch(e) { continue; }
    
    if (Array.isArray(items)) {
      items.forEach(item => {
        if (item.image && item.image.startsWith('data:image/')) {
          item.image = ''; // just clear it or we can map it to the new URL if we can find it. But clearing is easiest, or we can look up the product.
          changed = true;
        }
      });
      if (changed) {
        // Look up new product images
        for (const item of items) {
          if (!item.image) {
            const pRes = await query('SELECT image FROM products WHERE name = $1', [item.name]);
            if (pRes.rows.length > 0 && pRes.rows[0].image && !pRes.rows[0].image.startsWith('data:image/')) {
               item.image = pRes.rows[0].image;
            }
          }
        }
        await query('UPDATE daily_orders SET items = $1 WHERE id = $2', [JSON.stringify(items), row.id]);
        console.log(`Fixed daily_order ${row.id}`);
      }
    }
  }

  console.log('Fetching invoices...');
  const invRes = await query("SELECT id, items FROM invoices");
  for (const row of invRes.rows) {
    let changed = false;
    let items;
    try {
      items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    } catch(e) { continue; }
    
    if (Array.isArray(items)) {
      items.forEach(item => {
        if (item.image && item.image.startsWith('data:image/')) {
          item.image = '';
          changed = true;
        }
      });
      if (changed) {
        for (const item of items) {
          if (!item.image) {
            const pRes = await query('SELECT image FROM products WHERE name = $1', [item.name]);
            if (pRes.rows.length > 0 && pRes.rows[0].image && !pRes.rows[0].image.startsWith('data:image/')) {
               item.image = pRes.rows[0].image;
            }
          }
        }
        await query('UPDATE invoices SET items = $1 WHERE id = $2', [JSON.stringify(items), row.id]);
        console.log(`Fixed invoice ${row.id}`);
      }
    }
  }
  
  console.log('Migration completed.');
  process.exit(0);
}

migrate().catch(console.error);
