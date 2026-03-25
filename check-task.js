const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@ts-db:5432/komeya' });
pool.query("select id, title, length(completion_image) as len, left(completion_image, 100) as prefix from tasks where completion_image is not null and completion_image != '' order by id desc limit 5").then(res => { console.log(res.rows); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
