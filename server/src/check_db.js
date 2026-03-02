
import { query } from './db.js';

async function check() {
  try {
    console.log('Checking roles...');
    const r = await query('select * from roles');
    console.log('Roles:', JSON.stringify(r.rows, null, 2));
    
    console.log('Checking users...');
    const u = await query('select * from users');
    console.log('Users:', JSON.stringify(u.rows, null, 2));
  } catch (e) {
    console.error(e);
  }
}

check();
