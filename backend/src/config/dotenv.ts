import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseDotEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equalsAt = trimmed.indexOf("=");
  if (equalsAt <= 0) return null;

  const key = trimmed.slice(0, equalsAt).trim();
  let value = trimmed.slice(equalsAt + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function loadDotEnvFiles(cwd = process.cwd()): void {
  const paths = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "..", ".env")
  ];

  for (const filePath of [...new Set(paths)]) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseDotEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
