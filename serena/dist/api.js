export async function api(path, { method = "GET", body } = {}) {
  let r;
  try {
    r = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Kawsay": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Error("No se pudo conectar al servidor. Revisa tu conexión.");
  }
  const data = await r
    .json()
    .catch(() => ({ error: "El servidor no respondió con datos válidos." }));
  if (!r.ok) {
    const e = Error(data.error || "No se pudo completar la operación.");
    e.status = r.status;
    throw e;
  }
  return data;
}
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function download(name, content, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
