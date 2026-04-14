import { Database } from "bun:sqlite";
import { join } from "path";
import { readFileSync } from "fs";

const DB_PATH = join(process.cwd(), "data", "wealth_agent.sqlite");
const db = new Database(DB_PATH, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

// Initialize schema immediately
function initializeSchema() {
    // User goals table
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goal TEXT NOT NULL,
            target_amount REAL NOT NULL,
            current_savings REAL NOT NULL,
            time_horizon_months INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Traditional Finance metrics
    db.exec(`
        CREATE TABLE IF NOT EXISTS tradfi_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            currency TEXT NOT NULL,
            inflation_rate REAL NOT NULL,
            bank_rate REAL NOT NULL
        );
    `);

    // DeFi metrics with product column
    db.exec(`
        CREATE TABLE IF NOT EXISTS defi_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            protocol TEXT NOT NULL,
            asset TEXT NOT NULL,
            apy REAL NOT NULL,
            product TEXT DEFAULT 'Lending'
        );
    `);

    // FTS5 knowledge base
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS agent_knowledge USING fts5(
            title, content, category, tokenize='porter'
        );
    `);

    // Seed knowledge base if empty
    const count = db.prepare("SELECT COUNT(*) as cnt FROM agent_knowledge").get() as { cnt: number };
    if (count.cnt === 0) {
        const knowledgePath = join(process.cwd(), "data", "knowledge_base.json");
        try {
            const data = JSON.parse(readFileSync(knowledgePath, "utf-8"));
            const insert = db.prepare("INSERT INTO agent_knowledge (title, content, category) VALUES (?, ?, ?)");
            for (const item of data) {
                insert.run(item.title, item.content, item.category);
            }
            console.log(" Seeded agent_knowledge");
        } catch (e) {
            console.warn(" Could not seed knowledge base:", e);
        }
    }

    console.log(" Database initialized (bun:sqlite)");
}

// Run initialization now
initializeSchema();

export default db;
export { initializeSchema }; // useful for backward compatibility