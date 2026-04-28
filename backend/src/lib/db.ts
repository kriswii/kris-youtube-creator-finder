import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "../config/env.js";

export type SqliteDatabase = DatabaseSync;

export function resolveProjectPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

export function openDatabase(databasePath = env.DATABASE_PATH): SqliteDatabase {
  if (databasePath === ":memory:") {
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys = ON;");
    return db;
  }

  const resolved = resolveProjectPath(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function readSchemaSql(): string {
  return fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
}

export function initializeDatabase(db: SqliteDatabase): void {
  db.exec(readSchemaSql());
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN channel_country TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_avatar_url TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_description TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
  try {
    db.exec("ALTER TABLE results ADD COLUMN channel_country TEXT;");
  } catch {
    // Ignore when the column already exists.
  }
}
