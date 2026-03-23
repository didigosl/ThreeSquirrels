import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { query } from './db.js';

async function migrate() {
  console.log('Fetching products with base64 images...');
  const res = await query("SELECT id, image FROM products WHERE image LIKE 'data:image/%'");
  console.log(`Found ${res.rows.length} products to migrate.`);
  
  const uploadDir = path.join(process.cwd(), '..', 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  for (const row of res.rows) {
    const matches = row.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, buffer);
      
      const newUrl = '/uploads/' + filename;
      await query("UPDATE products SET image = $1 WHERE id = $2", [newUrl, row.id]);
      console.log(`Migrated product ${row.id} -> ${newUrl}`);
    }
  }
  
  console.log('Migration completed.');
  process.exit(0);
}

migrate().catch(console.error);
