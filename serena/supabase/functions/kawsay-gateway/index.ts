// Sustituir el marcador por el hash SHA-256 del secreto del servidor al desplegar.
const configuredHash =
  Deno.env.get("KAWSAY_GATEWAY_SECRET_SHA256") || "__GATEWAY_SECRET_SHA256__";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (request: Request) => {
  if (request.method !== "POST")
    return json(405, { error: "Método no permitido." });
  const secret = request.headers.get("x-kawsay-gateway") || "";
  if (!/^[a-f0-9]{96}$/.test(secret))
    return json(403, { error: "Acceso denegado." });
  const hashed = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  let difference = hashed.length ^ configuredHash.length;
  for (let i = 0; i < hashed.length; i++)
    difference |= hashed.charCodeAt(i) ^ (configuredHash.charCodeAt(i) || 0);
  if (difference !== 0) return json(403, { error: "Acceso denegado." });
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000)
      return json(413, { error: "Lote demasiado grande." });
    const body = JSON.parse(raw),
      supabaseUrl = Deno.env.get("SUPABASE_URL"),
      serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey)
      return json(503, { error: "Servicio no configurado." });
    const response = await fetch(supabaseUrl + "/rest/v1/rpc/kawsay_gateway", {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret,
        expected_revision: body.expected_revision ?? null,
        operations: body.operations ?? null,
      }),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return json(502, { error: "No se pudo procesar el acceso a los datos." });
  }
});
