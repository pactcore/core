import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export function openSQLiteDataDatabase(filePath: string): Database {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}
