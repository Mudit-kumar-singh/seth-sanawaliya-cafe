const Database = require("libsql");

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl || !dbToken) {
  throw new Error("TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing");
}

const db = new Database(dbUrl, {
  authToken: dbToken
});

db.pragma("foreign_keys = ON");

console.log("Connected to Turso database.");

module.exports = db;
