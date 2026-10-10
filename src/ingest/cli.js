// One-off sync of every enabled bulk source: `npm run ingest`
import { openDb } from '../db.js';
import { createIngestor, loadSourceConfig } from './index.js';

const db = openDb();
const ingestor = createIngestor(db, loadSourceConfig());
const results = await ingestor.syncAllBulk();
console.log(JSON.stringify(results, null, 2));
