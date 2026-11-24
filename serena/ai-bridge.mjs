import { parseRequest } from "./lib/providers.mjs";
const base = process.env.RENDER_APP_URL || process.env.APP_URL;
if (!base || !process.env.AI_BRIDGE_SECRET)
  throw Error("Configura RENDER_APP_URL y AI_BRIDGE_SECRET.");
process.env.AI_PROVIDER = "ollama";
let stopped = false;
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => (stopped = true));
async function call(path, body) {
  const r = await fetch(new URL(path, base), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.AI_BRIDGE_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("No se pudo conectar al servidor.");
  return r.json();
}
console.log(
  "Enlace de IA local activo. Ollama permanece accesible solo desde esta computadora.",
);
while (!stopped) {
  try {
    const { task } = await call("/api/bridge/claim", {});
    if (task) {
      let result, error;
      try {
        result = await parseRequest(task.text, task.config);
      } catch {
        error = true;
      }
      await call("/api/bridge/result", {
        id: task.id,
        lease: task.lease,
        result,
        error,
      });
    }
  } catch {
    console.log("Servidor temporalmente no disponible; reintentando.");
  }
  await new Promise((r) => setTimeout(r, 10000));
}
