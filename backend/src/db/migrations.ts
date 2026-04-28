import { openDatabase, initializeDatabase } from "../lib/db.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runMigrations(databasePath?: string): void {
  const db = openDatabase(databasePath);
  try {
    initializeDatabase(db);
  } finally {
    db.close();
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (currentFile === invokedFile) {
  runMigrations(process.env.DATABASE_PATH);
  console.log("Database initialized");
}
