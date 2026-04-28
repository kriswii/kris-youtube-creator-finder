import http from "node:http";
import { env } from "./config/env.js";
import { openDatabase, initializeDatabase } from "./lib/db.js";
import { routeRequest } from "./routes/index.js";

const db = openDatabase();
initializeDatabase(db);

const server = http.createServer((req, res) => {
  routeRequest(req, res, db).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: message }));
  });
});

server.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});

process.on("SIGINT", () => {
  db.close();
  server.close(() => process.exit(0));
});
