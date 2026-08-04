import 'dotenv/config';
import fs from 'fs';
import { createDatabaseBackup } from '../src/lib/database-maintenance';

async function main() {
  const p = await createDatabaseBackup();
  if (!p) {
    console.error('NO_BACKUP');
    process.exit(1);
  }
  const st = fs.statSync(p);
  console.log(JSON.stringify({ path: p, bytes: st.size, exists: true }));
  if (st.size <= 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
