const tables = [
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
export async function supabaseStore({ url, key, secret }) {
  async function request(body) {
    const r = await fetch(
      url.replace(/\/$/, "") + "/functions/v1/kawsay-gateway",
      {
        method: "POST",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
          "X-Kawsay-Gateway": secret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await r.json();
    if (!r.ok) {
      const e = Object.assign(
        Error(
          data.code === "40001"
            ? "Conflicto de revisión"
            : "No se pudo acceder a la base de datos de Supabase.",
        ),
        { code: data.code },
      );
      throw e;
    }
    return data;
  }
  function memory(snapshot) {
    const maps = Object.fromEntries(
        tables.map((t) => [
          t,
          new Map(
            snapshot.documents
              .filter((d) => d.collection === t)
              .map((d) => [d.id, d.data]),
          ),
        ]),
      ),
      operations = [];
    const check = (t) => {
      if (!tables.includes(t)) throw Error("Tabla inválida");
    };
    return {
      operations,
      async all(t) {
        check(t);
        return structuredClone([...maps[t].values()]);
      },
      async get(t, id) {
        check(t);
        return structuredClone(maps[t].get(id) || null);
      },
      async put(t, data, { insert = false } = {}) {
        check(t);
        if ((insert || t === "audit") && maps[t].has(data.id))
          throw Error("Registro duplicado");
        const copy = structuredClone(data);
        maps[t].set(data.id, copy);
        operations.push({
          action: "put",
          collection: t,
          id: data.id,
          data: copy,
        });
        return data;
      },
      async remove(t, id) {
        check(t);
        if (t === "audit") throw Error("Historial de solo anexado");
        maps[t].delete(id);
        operations.push({ action: "remove", collection: t, id });
      },
    };
  }
  let queue = Promise.resolve();
  return {
    kind: "Supabase PostgreSQL",
    async all(t) {
      return memory(await request({})).all(t);
    },
    async get(t, id) {
      return memory(await request({})).get(t, id);
    },
    async put(t, data, options) {
      return this.tx((db) => db.put(t, data, options));
    },
    async remove(t, id) {
      return this.tx((db) => db.remove(t, id));
    },
    async tx(fn) {
      let release;
      const previous = queue;
      queue = new Promise((r) => (release = r));
      await previous;
      try {
        for (let n = 0; n < 5; n++) {
          const snapshot = await request({}),
            db = memory(snapshot),
            value = await fn(db);
          if (!db.operations.length) return value;
          try {
            await request({
              expected_revision: snapshot.revision,
              operations: db.operations,
            });
            return value;
          } catch (e) {
            if (e.code !== "40001" || n === 4) throw e;
          }
        }
      } finally {
        release();
      }
    },
    async close() {
      await queue;
    },
  };
}
