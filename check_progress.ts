
import Database from "better-sqlite3";
const db = new Database("stocks.db");
const status = db.prepare("SELECT * FROM scan_status WHERE id = 1").get() as any;
console.log("Scan Status:", status);
const count = db.prepare("SELECT count(*) as count FROM filtered_stocks").get().count;
console.log("Filtered Stocks Count:", count);
const samples = db.prepare("SELECT symbol, industry FROM filtered_stocks LIMIT 5").all() as any[];
console.log("Samples:", samples);
