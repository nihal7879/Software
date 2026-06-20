import mysql from 'mysql2/promise';
import { config } from './config';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true,
  // The DB is remote (over the public internet), so reconnecting on every
  // request is the main latency cost. Keep sockets alive and a few idle
  // connections warm so back-to-back requests reuse an open connection
  // instead of paying a fresh TCP + MySQL auth handshake each time.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  maxIdle: 10,
  idleTimeout: 60_000,
  connectTimeout: 10_000,
});

// Small typed query helper
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
