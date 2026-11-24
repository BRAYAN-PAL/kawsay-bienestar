import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

export const tables = [
  "appointments",
  "users",
  "sessions",
  "jobs",
  "audit",
  "settings",
  "incidents",
  "measurements",
  "snapshots",
  "inbox",
];
export async function createStore({
  url = process.env.DATABASE_URL,
  filename = process.env.SQLITE_PATH || "data/kawsay.sqlite",
} = {}) {
  if (process.env.SUPABASE_URL && process.env.KAWSAY_DB_SECRET) {
    const { supabaseStore } = await import("./supabase-store.mjs");
    return supabaseStore({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_PUBLISHABLE_KEY,
      secret: process.env.KAWSAY_DB_SECRET,
    });
  }
  let pool, sqlite;
  if (url) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 10000,
    });
  } else {
    if (process.env.NODE_ENV === "production")
      throw Error("DATABASE_URL de Supabase es obligatoria en producción.");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    sqlite = new DatabaseSync(filename);
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  const table = (t) => {
    if (!tables.includes(t)) throw Error("Tabla inválida");
    return "kawsay_" + t;
  };
  const query = async (sql, args = [], client = pool) =>
    pool
      ? client.query(sql, args)
      : { rows: sqlite.prepare(sql.replace(/\$\d+/g, "?")).all(...args) };
  for (const t of tables) {
    const name = table(t);
    if (pool) {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${name} (id text PRIMARY KEY, data jsonb NOT NULL)`,
      );
      await pool.query(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
      await pool.query(`REVOKE ALL ON ${name} FROM anon, authenticated`);
    } else
      sqlite.exec(
        `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
  }
  if (pool) {
    await pool.query(
      `CREATE OR REPLACE FUNCTION kawsay_protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'El historial es de solo anexado'; END $$`,
    );
    await pool.query(
      "DROP TRIGGER IF EXISTS kawsay_audit_no_change ON kawsay_audit",
    );
    await pool.query(
      "CREATE TRIGGER kawsay_audit_no_change BEFORE UPDATE OR DELETE ON kawsay_audit FOR EACH ROW EXECUTE FUNCTION kawsay_protect_audit()",
    );
  } else
    sqlite.exec(
      "CREATE TRIGGER IF NOT EXISTS kawsay_audit_no_update BEFORE UPDATE ON kawsay_audit BEGIN SELECT RAISE(ABORT,'Historial de solo anexado'); END; CREATE TRIGGER IF NOT EXISTS kawsay_audit_no_delete BEFORE DELETE ON kawsay_audit BEGIN SELECT RAISE(ABORT,'Historial de solo anexado'); END;",
    );
  function api(client) {
    return {
      async all(t) {
        return (
          await query(`SELECT data FROM ${table(t)}`, [], client)
        ).rows.map((r) =>
          typeof r.data === "string" ? JSON.parse(r.data) : r.data,
        );
      },
      async get(t, id) {
        const r = (
          await query(`SELECT data FROM ${table(t)} WHERE id=$1`, [id], client)
        ).rows[0];
        return r
          ? typeof r.data === "string"
            ? JSON.parse(r.data)
            : r.data
          : null;
      },
      async put(t, obj, { insert = false } = {}) {
        const sql = `INSERT INTO ${table(t)}(id,data) VALUES($1,$2)${insert ? "" : " ON CONFLICT(id) DO UPDATE SET data=excluded.data"}`;
        if (pool) await client.query(sql, [obj.id, JSON.stringify(obj)]);
        else
          sqlite
            .prepare(sql.replace(/\$\d+/g, "?"))
            .run(obj.id, JSON.stringify(obj));
        return obj;
      },
      async remove(t, id) {
        if (t === "audit") throw Error("Historial de solo anexado");
        const sql = `DELETE FROM ${table(t)} WHERE id=$1`;
        if (pool) await client.query(sql, [id]);
        else sqlite.prepare(sql.replace(/\$\d+/g, "?")).run(id);
      },
    };
  }
  let queue = Promise.resolve();
  const store = {
    ...api(pool),
    kind: pool ? "Supabase PostgreSQL" : "SQLite local",
    async tx(fn) {
      let release;
      const previous = queue;
      queue = new Promise((r) => (release = r));
      await previous;
      const c = pool ? await pool.connect() : null;
      try {
        if (pool) {
          await c.query("BEGIN");
          await c.query("SELECT pg_advisory_xact_lock(61427419)");
        } else sqlite.exec("BEGIN IMMEDIATE");
        const result = await fn(api(c));
        if (pool) await c.query("COMMIT");
        else sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        if (pool) await c.query("ROLLBACK");
        else sqlite.exec("ROLLBACK");
        throw e;
      } finally {
        c?.release();
        release();
      }
    },
    async close() {
      await queue;
      if (pool) await pool.end();
      else sqlite.close();
    },
  };
  return store;
}
export function loadAuditSecret() {
  if (process.env.AUDIT_SECRET) return process.env.AUDIT_SECRET;
  if (process.env.NODE_ENV === "production")
    throw Error("AUDIT_SECRET es obligatoria en producción.");
  fs.mkdirSync("data", { recursive: true });
  const file = "data/audit.key";
  if (!fs.existsSync(file))
    fs.writeFileSync(file, crypto.randomBytes(48).toString("hex"), {
      mode: 0o600,
    });
  return fs.readFileSync(file, "utf8");
}
