import http from "node:http";
import { simulatedReportStore } from "./lib/report-demo.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, loadAuditSecret } from "./lib/store.mjs";
import {
  defaults,
  id,
  now,
  hash,
  same,
  fail,
  safeUser,
  passwordHash,
  passwordValid,
  checkPassword,
  audit,
  verifyAudit,
  center,
  saveAppointment,
  availableSlots,
  bookingToken,
  report,
  saveSettings,
} from "./lib/core.mjs";
import {
  integrationStatus,
  parseRequest,
  runAutomation,
  validSignature,
  receiveWebhook,
} from "./lib/providers.mjs";
import { localDate } from "./dist/model.js";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
export async function createApp({
  store: providedStore,
  secret: providedSecret,
  background = true,
} = {}) {
  const db = providedStore || (await createStore()),
    secret = providedSecret || loadAuditSecret();
  const limits = new Map();
  let working = false;
  async function cycle() {
    if (working) return;
    working = true;
    try {
      await runAutomation(db, secret);
    } catch {
      console.error(
        "Ciclo de automatización pendiente; se reintentará en el siguiente ciclo.",
      );
    } finally {
      working = false;
    }
  }
  const timer = background ? setInterval(cycle, 30000) : null;
  timer?.unref();
  function rate(req, bucket, max = 20, period = 900000) {
    const key = bucket + (req.socket.remoteAddress || "local"),
      time = Date.now(),
      old = limits.get(key);
    if (!old || old.until < time) {
      limits.set(key, { count: 1, until: time + period });
      return;
    }
    if (++old.count > max)
      fail(429, "Demasiados intentos. Espera unos minutos.");
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until < time) limits.delete(k);
  }
  async function read(req) {
    const chunks = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > 1_000_000) fail(413, "La solicitud es demasiado grande.");
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  const tokenFrom = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("kawsay_session="))
      ?.slice(15);
  async function session(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const s = await db.get("sessions", hash(token));
    if (!s || Date.parse(s.expires) < Date.now()) return null;
    const u = await db.get("users", s.userId);
    return u?.active ? u : null;
  }
  const cookie = (token, clear = false) =>
    `kawsay_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 28800}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  const auth = (u) => {
      if (!u) fail(401, "Inicia sesión para continuar.");
      return u;
    },
    admin = (u) => {
      auth(u);
      if (u.role !== "admin")
        fail(403, "Esta acción requiere una cuenta administradora.");
    },
    write = (u) => {
      auth(u);
      if (u.role === "viewer") fail(403, "Tu rol solo permite consultar.");
    };
  async function createSession(u, res) {
    const token = id() + id();
    await db.put("sessions", {
      id: hash(token),
      userId: u.id,
      created: now(),
      expires: new Date(Date.now() + 8 * 3600000).toISOString(),
    });
    res.setHeader("Set-Cookie", cookie(token));
    return safeUser(u);
  }
  const server = http.createServer(async (req, res) => {
    const started = performance.now();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname,
        method = req.method;
      if (p === "/health") {
        await center(db);
        send(200, { status: "ok" });
        return;
      }
      if (p === "/webhooks/whatsapp" && method === "GET") {
        if (
          !process.env.WHATSAPP_VERIFY_TOKEN ||
          url.searchParams.get("hub.mode") !== "subscribe" ||
          !same(
            url.searchParams.get("hub.verify_token") || "",
            process.env.WHATSAPP_VERIFY_TOKEN,
          )
        )
          fail(403, "Verificación rechazada.");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(url.searchParams.get("hub.challenge") || "");
        return;
      }
      if (p === "/webhooks/whatsapp" && method === "POST") {
        const raw = await read(req);
        if (
          !validSignature(
            raw,
            req.headers["x-hub-signature-256"],
            process.env.WHATSAPP_APP_SECRET,
          )
        )
          fail(403, "Firma inválida.");
        await receiveWebhook(db, secret, JSON.parse(raw));
        send(200, { ok: true });
        return;
      }
      if (!p.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(method))
          fail(405, "Método no permitido.");
        const decoded = decodeURIComponent(p),
          requested =
            decoded === "/reservar"
              ? "/portal.html"
              : decoded === "/"
                ? "/index.html"
                : decoded;
        const file = path.resolve(root, "." + requested);
        if (!file.startsWith(root + path.sep)) fail(403, "Ruta no permitida.");
        let data;
        try {
          data = await fs.readFile(file);
        } catch {
          fail(404, "No encontrado.");
        }
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
            }[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        res.end(method === "HEAD" ? undefined : data);
        return;
      }
      if (p.startsWith("/api/bridge/")) {
        if (
          !process.env.AI_BRIDGE_SECRET ||
          !same(
            req.headers.authorization || "",
            "Bearer " + process.env.AI_BRIDGE_SECRET,
          )
        )
          fail(401, "Acceso denegado.");
        if (method !== "POST") fail(405, "Método no permitido.");
        const b = JSON.parse((await read(req)).toString() || "{}");
        if (p === "/api/bridge/claim") {
          const task = await db.tx(async (tx) => {
            const cfg = await center(tx);
            const jobs = (await tx.all("jobs"))
              .filter(
                (j) =>
                  j.kind === "ai" &&
                  (j.status === "queued" ||
                    (j.status === "processing" &&
                      Date.parse(j.claimed) < Date.now() - 180000)),
              )
              .sort((a, b) => a.created.localeCompare(b.created));
            const j = jobs[0];
            if (j) {
              j.status = "processing";
              j.claimed = now();
              j.lease = id();
              await tx.put("jobs", j);
            }
            await tx.put("settings", { id: "ai-heartbeat", time: now() });
            return j ? { ...j, config: cfg } : null;
          });
          send(200, { task });
          return;
        }
        if (p === "/api/bridge/result") {
          await db.tx(async (tx) => {
            const j = await tx.get("jobs", b.id);
            if (
              !j ||
              j.kind !== "ai" ||
              j.status !== "processing" ||
              j.lease !== b.lease
            )
              fail(409, "La tarea ya no está asignada a este proceso.");
            j.status = b.error ? "failed" : "done";
            j.result = b.error ? null : b.result;
            j.error = b.error ? "El modelo local no completó la tarea." : null;
            j.updated = now();
            await tx.put("jobs", j);
            await audit(tx, secret, null, "Interpretación con IA local", {
              jobId: j.id,
              status: j.status,
            });
          });
          send(200, { ok: true });
          return;
        }
        fail(404, "Ruta no encontrada.");
      }
      if (p === "/api/cron") {
        if (
          method !== "POST" ||
          !process.env.CRON_SECRET ||
          !same(
            req.headers.authorization || "",
            "Bearer " + process.env.CRON_SECRET,
          )
        )
          fail(401, "Acceso denegado.");
        await cycle();
        send(200, { ok: true });
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        if (req.headers["x-kawsay"] !== "1")
          fail(403, "Solicitud no permitida.");
        const origin = req.headers.origin;
        if (origin) {
          const allowed = new Set([
            process.env.APP_URL,
            `http://${req.headers.host}`,
          ]);
          if (!allowed.has(origin)) fail(403, "Origen no permitido.");
        }
      }
      const body = ["POST", "PATCH", "PUT"].includes(method)
        ? JSON.parse((await read(req)).toString() || "{}")
        : {};
      if (p === "/api/public/config" && method === "GET") {
        send(200, { config: await center(db) });
        return;
      }
      if (p === "/api/public/slots" && method === "GET") {
        rate(req, "slots", 240);
        if (!(await center(db)).publicBooking)
          fail(403, "Reservas en línea desactivadas.");
        send(200, {
          slots: await availableSlots(
            db,
            url.searchParams.get("date"),
            url.searchParams.get("service"),
          ),
        });
        return;
      }
      if (p === "/api/public/book" && method === "POST") {
        rate(req, "book", 12, 3600000);
        if (!(await center(db)).publicBooking)
          fail(403, "Reservas en línea desactivadas.");
        const a = await saveAppointment(
          db,
          secret,
          body,
          { id: "portal", name: "Cliente · Reserva web" },
          { publicBooking: true },
        );
        send(201, { appointment: a, token: bookingToken(a, secret) });
        return;
      }
      if (p === "/api/public/manage" && ["GET", "POST"].includes(method)) {
        rate(req, "manage", 100);
        const a = await db.get("appointments", url.searchParams.get("id"));
        if (
          !a ||
          !same(url.searchParams.get("token") || "", bookingToken(a, secret))
        )
          fail(404, "Enlace de cita no válido.");
        if (method === "GET") {
          send(200, {
            appointment: {
              id: a.id,
              name: a.name,
              date: a.date,
              time: a.time,
              service: a.service,
              status: a.status,
              duration: a.duration,
              equipment: a.equipment,
            },
          });
          return;
        }
        if (!["Confirmada", "Cancelada"].includes(body.status))
          fail(400, "Acción no válida.");
        if (!["Pendiente", "Confirmada"].includes(a.status))
          fail(409, "Esta cita ya no se puede modificar por este enlace.");
        if (Date.parse(a.date + "T" + a.time + ":00-05:00") < Date.now())
          fail(409, "Esta cita ya comenzó. Contacta al centro.");
        const updated = await saveAppointment(
          db,
          secret,
          { ...a, status: body.status },
          { id: "portal", name: "Cliente · Enlace de cita" },
        );
        send(200, { appointment: updated });
        return;
      }
      const user = await session(req);
      if (p === "/api/auth/status") {
        send(200, {
          user: user ? safeUser(user) : null,
          setup: (await db.all("users")).length === 0,
        });
        return;
      }
      if (p === "/api/auth/setup" && method === "POST") {
        rate(req, "setup", 8);
        checkPassword(body.password);
        const password = await passwordHash(body.password);
        if (
          process.env.NODE_ENV === "production" &&
          (!process.env.BOOTSTRAP_TOKEN ||
            !same(body.bootstrap || "", process.env.BOOTSTRAP_TOKEN))
        )
          fail(403, "Escribe la clave de instalación configurada en Render.");
        const u = await db.tx(async (tx) => {
          if ((await tx.all("users")).length)
            fail(409, "La administración ya está configurada.");
          if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || "") ||
            !String(body.name || "").trim()
          )
            fail(400, "Completa nombre y correo.");
          const u = {
            id: id(),
            name: String(body.name).slice(0, 90),
            email: body.email.toLowerCase().trim(),
            password,
            role: "admin",
            active: true,
            created: now(),
          };
          await tx.put("users", u);
          await tx.put("settings", defaults);
          await audit(tx, secret, u, "Administración creada", {
            email: u.email,
          });
          return u;
        });
        send(201, { user: await createSession(u, res) });
        return;
      }
      if (p === "/api/auth/login" && method === "POST") {
        rate(req, "login", 15);
        const u = (await db.all("users")).find(
          (u) =>
            u.email ===
            String(body.email || "")
              .toLowerCase()
              .trim(),
        );
        if (typeof body.password !== "string" || body.password.length > 128)
          fail(400, "Datos de acceso inválidos.");
        const valid = await passwordValid(
          body.password,
          u?.password || "00000000000000000000000000000000:00",
        );
        if (!u || !u.active || !valid)
          fail(401, "Correo o contraseña incorrectos.");
        await db.tx((tx) => audit(tx, secret, u, "Inicio de sesión", {}));
        send(200, { user: await createSession(u, res) });
        return;
      }
      if (p === "/api/auth/logout" && method === "POST") {
        auth(user);
        const token = tokenFrom(req);
        if (token) await db.remove("sessions", hash(token));
        res.setHeader("Set-Cookie", cookie("", true));
        send(200, { ok: true });
        return;
      }
      auth(user);
      if (!["GET", "HEAD"].includes(method)) write(user);
      if (p === "/api/state" && method === "GET") {
        const [rows, logs, jobs, incidents, measurements, snapshots, inbox] =
          await Promise.all(
            [
              "appointments",
              "audit",
              "jobs",
              "incidents",
              "measurements",
              "snapshots",
              "inbox",
            ].map((t) => db.all(t)),
          );
        send(200, {
          user: safeUser(user),
          config: await center(db),
          rows,
          logs: logs.sort((a, b) => b.seq - a.seq).slice(0, 500),
          jobs: jobs.map(({ text, result, lease, ...j }) => j),
          incidents,
          measurements,
          snapshots,
          inbox,
          integrations: integrationStatus(),
          storage: db.kind,
          heartbeat: await db.get("settings", "ai-heartbeat"),
        });
        return;
      }
      if (p === "/api/appointments" && method === "POST") {
        const a = await saveAppointment(db, secret, body, user);
        send(body.id ? 200 : 201, {
          appointment: a,
          token: bookingToken(a, secret),
        });
        return;
      }
      if (p === "/api/settings" && method === "POST") {
        admin(user);
        send(200, { config: await saveSettings(db, secret, body, user) });
        return;
      }
      if (p === "/api/report" && method === "GET") {
        const start = url.searchParams.get("start") || "",
          end = url.searchParams.get("end") || "";
        if (start && end && start > end)
          fail(400, "El inicio debe ser anterior al final.");
        const demo = url.searchParams.get("demo") === "true";
        const result = await report(demo ? simulatedReportStore : db, {
          start,
          end,
          demo,
        });
        if (demo) {
          send(200, { report: result });
          return;
        }
        const seconds = (performance.now() - started) / 1000;
        await db.tx(async (tx) => {
          await tx.put("measurements", {
            id: id(),
            kind: "reporte",
            phase: "post",
            date: localDate(),
            seconds,
            method: "Procesamiento del servidor; excluye red y trabajo humano",
            demo: false,
          });
          await audit(tx, secret, user, "Reporte generado", {
            start,
            end,
            seconds,
          });
        });
        send(200, { report: result });
        return;
      }
      if (p === "/api/incidents" && method === "POST") {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ||
          !String(body.description || "").trim() ||
          !["pre", "post"].includes(body.phase)
        )
          fail(400, "Completa fecha, periodo y descripción.");
        const row = {
          id: id(),
          date: body.date,
          phase: body.phase,
          description: String(body.description).slice(0, 1500),
          severity: ["baja", "media", "alta"].includes(body.severity)
            ? body.severity
            : "media",
          demo: false,
          created: now(),
          actor: user.id,
        };
        await db.tx(async (tx) => {
          await tx.put("incidents", row);
          await audit(tx, secret, user, "Incidente registrado", {
            id: row.id,
            severity: row.severity,
          });
        });
        send(201, { incident: row });
        return;
      }
      if (p === "/api/measurements" && method === "POST") {
        if (
          !["pre", "post"].includes(body.phase) ||
          !["registro", "reporte"].includes(body.kind) ||
          !Number.isFinite(Number(body.seconds)) ||
          Number(body.seconds) <= 0 ||
          Number(body.seconds) > 86400 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ||
          !String(body.method || "").trim()
        )
          fail(
            400,
            "Completa fecha, proceso, periodo, segundos y método de observación.",
          );
        const row = {
          id: id(),
          phase: body.phase,
          kind: body.kind,
          date: body.date,
          seconds: Number(body.seconds),
          method: String(body.method).slice(0, 500),
          demo: false,
          created: now(),
        };
        await db.tx(async (tx) => {
          await tx.put("measurements", row);
          await audit(tx, secret, user, "Medición registrada", { id: row.id });
        });
        send(201, { measurement: row });
        return;
      }
      if (p === "/api/audit/verify") {
        admin(user);
        send(200, await verifyAudit(db, secret));
        return;
      }
      if (p === "/api/users" && method === "GET") {
        admin(user);
        send(200, { users: (await db.all("users")).map(safeUser) });
        return;
      }
      if (p === "/api/users" && method === "POST") {
        admin(user);
        checkPassword(body.password);
        if (
          !["admin", "staff", "viewer"].includes(body.role) ||
          !String(body.name || "").trim() ||
          !/^\S+@\S+\.\S+$/.test(body.email || "")
        )
          fail(400, "Completa nombre, correo y rol.");
        const u = {
          id: id(),
          name: String(body.name).slice(0, 90),
          email: body.email.toLowerCase().trim(),
          password: await passwordHash(body.password),
          role: body.role,
          active: true,
          created: now(),
        };
        await db.tx(async (tx) => {
          if ((await tx.all("users")).some((x) => x.email === u.email))
            fail(409, "Ese correo ya está registrado.");
          await tx.put("users", u);
          await audit(tx, secret, user, "Usuario creado", safeUser(u));
        });
        send(201, { user: safeUser(u) });
        return;
      }
      if (p === "/api/backup" && method === "GET") {
        admin(user);
        await db.tx((tx) => audit(tx, secret, user, "Respaldo exportado", {}));
        send(200, {
          format: "kawsay-v2",
          config: await center(db),
          appointments: await db.all("appointments"),
          incidents: await db.all("incidents"),
          measurements: await db.all("measurements"),
          audit: await db.all("audit"),
          created: now(),
        });
        return;
      }
      if (p === "/api/automation/run" && method === "POST") {
        admin(user);
        await cycle();
        send(200, { ok: true });
        return;
      }
      if (p === "/api/ai" && method === "POST") {
        rate(req, "ai", 30);
        if (
          typeof body.text !== "string" ||
          !body.text.trim() ||
          body.text.length > 2000
        )
          fail(400, "Escribe una solicitud de hasta 2000 caracteres.");
        if (process.env.AI_PROVIDER === "bridge") {
          const job = {
            id: id(),
            kind: "ai",
            text: body.text,
            status: "queued",
            created: now(),
            userId: user.id,
          };
          await db.put("jobs", job);
          send(202, { jobId: job.id });
          return;
        }
        const result = await parseRequest(body.text, await center(db));
        await db.tx((tx) =>
          audit(tx, secret, user, "Solicitud interpretada por IA", {
            intent: result.intent,
          }),
        );
        send(200, { result });
        return;
      }
      if (p.startsWith("/api/ai/") && method === "GET") {
        const task = await db.get("jobs", p.split("/").at(-1));
        if (!task || task.kind !== "ai" || task.userId !== user.id)
          fail(404, "Solicitud no encontrada.");
        send(200, {
          status: task.status,
          result: task.result,
          error: task.error,
        });
        return;
      }
      fail(404, "Ruta no encontrada.");
    } catch (e) {
      if (e instanceof SyntaxError)
        send(400, { error: "Solicitud JSON no válida." });
      else
        send(e.status || 500, {
          error: e.status
            ? e.message
            : "No se pudo completar la operación. Revisa la conexión y vuelve a intentar.",
        });
    }
  });
  return {
    server,
    db,
    close: async () => {
      clearInterval(timer);
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const app = await createApp();
  const port = Number(process.env.PORT) || 4173;
  app.server.listen(
    port,
    process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
    () => console.log(`Kawsay Bienestar: http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
