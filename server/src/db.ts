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

/**
 * Dubai time, on every connection.
 *
 * The institute is in Dubai (UTC+4), but nothing else here was: the database
 * machine runs on India time (+05:30) and Vercel runs on UTC, so `NOW()`, the
 * 23 columns that stamp themselves, and anything the app worked out could be
 * 1.5 hours ahead or 4 hours behind the clock on the wall. A class at 11 PM
 * was recorded as half past midnight the next day.
 *
 * `+04:00` rather than 'Asia/Dubai' because this MySQL has no named-zone table
 * installed; the UAE has no daylight saving, so the offset is right all year.
 * It is a session setting, so it changes nothing for anything else using that
 * server, and no stored data moves: those columns are TIMESTAMP, which MySQL
 * keeps internally as UTC and simply reads back in whatever zone is asked for.
 */
export const DB_TIME_ZONE = '+04:00';
pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${DB_TIME_ZONE}'`);
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




















