import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localDataDir } from "./localRealtime";

let database: DatabaseSync | undefined;
export function integrationDb() {
  if (!database) {
    mkdirSync(localDataDir(), { recursive: true, mode: 0o700 });
    database = new DatabaseSync(path.join(localDataDir(), "integrations.sqlite"));
    database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS github_connections (project TEXT PRIMARY KEY, repo TEXT NOT NULL, login TEXT NOT NULL, encrypted TEXT NOT NULL, connected_by TEXT NOT NULL, updated INTEGER NOT NULL)");
  }
  return database;
}
const db = integrationDb;
function key() {
  mkdirSync(localDataDir(), { recursive: true, mode: 0o700 });
  const file = path.join(localDataDir(), "integrations.key");
  try { writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const value = readFileSync(file);
  if (value.length !== 32) throw new Error("GitHub connection storage is unavailable");
  return value;
}
export function saveGitHubConnection(project: string, repo: string, login: string, token: string, connectedBy: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${project}:${repo}`));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  db().prepare("INSERT INTO github_connections VALUES(?,?,?,?,?,?) ON CONFLICT(project) DO UPDATE SET repo=excluded.repo,login=excluded.login,encrypted=excluded.encrypted,connected_by=excluded.connected_by,updated=excluded.updated").run(project, repo, login, encrypted, connectedBy, Date.now());
}
export function githubConnectionInfo(project: string, repo: string) {
  const row = db().prepare("SELECT login,updated,connected_by FROM github_connections WHERE project=? AND repo=?").get(project, repo) as { login: string; updated: number; connected_by: string } | undefined;
  return row ? { login: row.login, updatedAt: row.updated, connectedBy: row.connected_by } : null;
}
export function githubConnectionToken(project: string, repo: string) {
  const row = db().prepare("SELECT encrypted FROM github_connections WHERE project=? AND repo=?").get(project, repo) as { encrypted: string } | undefined;
  if (!row) return undefined;
  const value = Buffer.from(row.encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), value.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${project}:${repo}`));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
}
export function deleteGitHubConnection(project: string) { db().prepare("DELETE FROM github_connections WHERE project=?").run(project); }

export function sealIntegration(value: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function openIntegration(value: string, purpose: string) {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
