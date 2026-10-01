const Database = require('better-sqlite3'), fs = require('fs'), path = require('path');
const file = path.resolve(process.env.DATABASE_PATH || './data/homefinance.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')); // migrasi otomatis
module.exports = db;
