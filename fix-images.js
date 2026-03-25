const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({ connectionString: 'postgres://postgres:postgres@ts-db:5432/komeya' });

async function run() {
  const r = await pool.query("select id, image from products where image like 'data:image/%'");
  let count = 0;
  for (const row of r.rows) {
    if (row.image && row.image.length > 1000) {
      const match = row.image.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
        const filepath = path.join('/app/uploads', filename);
        
        fs.writeFileSync(filepath, buffer);
        
        const newUrl = '/uploads/' + filename;
        await pool.query('update products set image=$1 where id=$2', [newUrl, row.id]);
        count++;
        console.log(`Converted image for product ${row.id} -> ${newUrl}`);
      }
    }
  }
  console.log(`Finished converting ${count} images.`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
