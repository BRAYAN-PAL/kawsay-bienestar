import crypto from "node:crypto";
import { promisify } from "node:util";
import { localDate, minutes, metrics } from "../dist/model.js";
const scrypt = promisify(crypto.scrypt);
export const defaults = {
  id: "center",
  name: "Kawsay Bienestar",
  district: "Los Olivos, Lima, Perú",
  address: "Dirección por confirmar · Los Olivos",
  phone: "",
  open: "08:00",
  close: "20:00",
  equipment: ["Equipo térmico 1", "Equipo térmico 2", "Equipo térmico 3"],
  services: [
    { name: "Masaje térmico", duration: 30 },
    { name: "Masaje relajante", duration: 45 },
    { name: "Sesión de bienestar", duration: 60 },
  ],
  reminderHours: 24,
  publicBooking: true,
};
export const id = () => crypto.randomUUID(),
  now = () => new Date().toISOString();
export function fail(status, message) {
  throw Object.assign(Error(message), { status });
}
export const same = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
export const phone = (s) => {
  const p = String(s || "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  return /^9\d{8}$/.test(p) ? "51" + p : p;
};
export async function passwordHash(
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) {
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
export async function passwordValid(password, stored) {
  const salt = stored.split(":")[0];
  return same(await passwordHash(password, salt), stored);
}
export function safeUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
  };
}
function text(v, max = 200) {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}
export function checkPassword(v) {
  if (typeof v !== "string" || v.length < 12 || v.length > 128)
    fail(400, "Usa una contraseña de 12 a 128 caracteres.");
}
export const canonical = (v) =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          )
      : v,
  );
export async function audit(db, secret, actor, action, detail) {
  const rows = (await db.all("audit")).sort((a, b) => a.seq - b.seq),
    last = rows.at(-1);
  const row = {
    id: id(),
    seq: (last?.seq || 0) + 1,
    time: now(),
    actor: actor?.name || "Sistema",
    actorId: actor?.id || "system",
    action,
    detail,
    previous: last?.signature || "GENESIS",
  };
  row.signature = crypto
    .createHmac("sha256", secret)
    .update(canonical(row))
    .digest("hex");
  await db.put("audit", row, { insert: true });
  return row;
}
export async function verifyAudit(db, secret) {
  const rows = (await db.all("audit")).sort((a, b) => a.seq - b.seq);
  let previous = "GENESIS";
  for (let i = 0; i < rows.length; i++) {
    const { signature, ...row } = rows[i];
    if (
      row.seq !== i + 1 ||
      row.previous !== previous ||
      !same(
        signature,
        crypto
          .createHmac("sha256", secret)
          .update(canonical(row))
          .digest("hex"),
      )
    )
      return { valid: false, count: rows.length };
    previous = signature;
  }
  return { valid: true, count: rows.length };
}
export async function center(db) {
  return (await db.get("settings", "center")) || defaults;
}
export function cleanAppointment(input, config, previous = null) {
  const a = {
    id: previous?.id || id(),
    name: text(input.name, 90),
    contact: phone(input.contact),
    date: text(input.date, 10),
    time: text(input.time, 5),
    duration: Number(input.duration),
    equipment: text(input.equipment, 90),
    service: text(input.service, 90),
    status: input.status || "Pendiente",
    phase: input.phase || "post",
    error: input.error === true,
    duplicate: input.duplicate === true,
    followup: input.followup !== false,
    consent: input.consent === true,
    demo: previous?.demo || input.demo === true,
    source: previous?.source || "staff",
    version: (previous?.version || 0) + 1,
    created: previous?.created || now(),
    updated: now(),
  };
  if (!a.name || !/^51[9]\d{8}$/.test(a.contact))
    fail(
      400,
      "Escribe el nombre y un celular peruano de 9 dígitos, comenzando por 9.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
    !Number.isFinite(Date.parse(a.date + "T12:00Z")) ||
    new Date(a.date + "T12:00Z").toISOString().slice(0, 10) !== a.date
  )
    fail(400, "Fecha inválida.");
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ||
    !Number.isFinite(a.duration) ||
    a.duration < 15 ||
    a.duration > 120
  )
    fail(400, "Revisa la hora y duración.");
  if (
    !["Pendiente", "Confirmada", "Asistió", "No asistió", "Cancelada"].includes(
      a.status,
    ) ||
    !["pre", "post"].includes(a.phase)
  )
    fail(400, "Estado o periodo inválido.");
  if (
    a.phase === "post" &&
    (!config.equipment.includes(a.equipment) ||
      !config.services.some((s) => s.name === a.service))
  )
    fail(400, "Selecciona un equipo y tratamiento disponible.");
  if (
    a.phase === "post" &&
    (minutes(a.time) < minutes(config.open) ||
      minutes(a.time) + a.duration > minutes(config.close))
  )
    fail(400, "La sesión queda fuera del horario de atención.");
  if (["Asistió", "No asistió"].includes(a.status) && a.date > localDate())
    fail(400, "No se registra asistencia de fechas futuras.");
  if (
    a.phase === "post" &&
    a.status === "No asistió" &&
    Date.parse(a.date + "T" + a.time + ":00-05:00") + a.duration * 60000 >
      Date.now()
  )
    fail(400, "Registra la inasistencia después del final de la sesión.");
  return a;
}
export function overlap(a, rows) {
  return (
    a.phase === "post" &&
    a.status !== "Cancelada" &&
    rows.some(
      (b) =>
        b.id !== a.id &&
        b.phase === "post" &&
        b.demo === a.demo &&
        b.date === a.date &&
        b.equipment === a.equipment &&
        b.status !== "Cancelada" &&
        minutes(a.time) < minutes(b.time) + b.duration &&
        minutes(a.time) + a.duration > minutes(b.time),
    )
  );
}
export const bookingToken = (a, secret) =>
  crypto
    .createHmac("sha256", secret)
    .update("booking:" + a.id)
    .digest("hex");
export async function scheduleJobs(db, a, config) {
  for (const j of await db.all("jobs"))
    if (j.appointmentId === a.id && ["queued", "blocked"].includes(j.status)) {
      j.status = "cancelled";
      await db.put("jobs", j);
    }
  if (
    a.phase !== "post" ||
    a.demo ||
    !a.consent ||
    !["Pendiente", "Confirmada"].includes(a.status)
  )
    return;
  const appointmentTime = Date.parse(a.date + "T" + a.time + ":00-05:00");
  if (appointmentTime <= Date.now()) return;
  for (const kind of ["confirmation", "reminder"]) {
    if (kind === "reminder" && appointmentTime - Date.now() < 60 * 60000)
      continue;
    const due =
      kind === "confirmation"
        ? Date.now()
        : Math.max(
            Date.now() + 60000,
            appointmentTime - config.reminderHours * 3600000,
          );
    await db.put("jobs", {
      id: id(),
      appointmentId: a.id,
      version: a.version,
      kind,
      status: "queued",
      due: new Date(due).toISOString(),
      attempts: 0,
      created: now(),
      providerId: null,
      error: null,
    });
  }
}
export async function saveAppointment(
  store,
  secret,
  input,
  user,
  { publicBooking = false } = {},
) {
  return store.tx(async (db) => {
    if (publicBooking) input = { ...input, id: undefined };
    const config = await center(db),
      previous = input.id ? await db.get("appointments", input.id) : null;
    if (input.id && !previous) fail(404, "Cita no encontrada.");
    if (previous && Number(input.version) !== previous.version)
      fail(
        409,
        "Esta cita cambió en otra sesión. Recarga y revisa los cambios.",
      );
    if (publicBooking) {
      input = {
        ...input,
        id: undefined,
        phase: "post",
        status: "Pendiente",
        followup: true,
        error: false,
        duplicate: false,
        demo: false,
      };
      if (!input.consent)
        fail(
          400,
          "Debes aceptar el uso de tus datos para la reserva y los mensajes de la cita.",
        );
      if (
        input.date < localDate() ||
        Date.parse(input.date + "T" + input.time + ":00-05:00") <
          Date.now() + 30 * 60000
      )
        fail(400, "Reserva con al menos 30 minutos de anticipación.");
      if (Date.parse(input.date + "T12:00Z") > Date.now() + 90 * 86400000)
        fail(
          400,
          "La reserva está disponible hasta con 90 días de anticipación.",
        );
      const service = config.services.find((s) => s.name === input.service);
      if (!service) fail(400, "Tratamiento inválido.");
      input.duration = service.duration;
    }
    const a = cleanAppointment(input, config, previous);
    if (overlap(a, await db.all("appointments")))
      fail(409, "Ese equipo ya está reservado. Elige otro horario o equipo.");
    if (publicBooking) a.source = "portal";
    await db.put("appointments", a);
    await scheduleJobs(db, a, config);
    await audit(
      db,
      secret,
      user,
      previous ? "Cita actualizada" : "Cita registrada",
      { id: a.id, before: previous, after: a },
    );
    return a;
  });
}
export async function availableSlots(db, date, service) {
  const cfg = await center(db),
    s = cfg.services.find((s) => s.name === service);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    fail(400, "Selecciona fecha y tratamiento.");
  const rows = await db.all("appointments"),
    slots = [];
  for (
    let start = minutes(cfg.open);
    start + s.duration <= minutes(cfg.close);
    start += 15
  ) {
    const time =
      String(Math.floor(start / 60)).padStart(2, "0") +
      ":" +
      String(start % 60).padStart(2, "0");
    if (Date.parse(date + "T" + time + ":00-05:00") < Date.now() + 30 * 60000)
      continue;
    for (const equipment of cfg.equipment)
      if (
        !overlap(
          {
            phase: "post",
            status: "Pendiente",
            date,
            time,
            duration: s.duration,
            equipment,
            demo: false,
          },
          rows,
        )
      )
        slots.push({ time, equipment, duration: s.duration });
  }
  return slots;
}
export async function report(db, { start = "", end = "", demo = false } = {}) {
  const all = (await db.all("appointments")).filter(
    (a) =>
      a.demo === demo && (!start || a.date >= start) && (!end || a.date <= end),
  );
  const jobs = (await db.all("jobs")).filter((j) =>
    all.some((a) => a.id === j.appointmentId),
  );
  const incidents = (await db.all("incidents")).filter(
    (i) =>
      (!start || i.date >= start) && (!end || i.date <= end) && i.demo === demo,
  );
  const measurements = (await db.all("measurements")).filter(
    (i) =>
      (!start || i.date >= start) && (!end || i.date <= end) && i.demo === demo,
  );
  const summarize = (phase) => {
    const rows = all.filter((a) => a.phase === phase),
      m = metrics(rows),
      active = rows.filter((a) => a.status !== "Cancelada"),
      mean = (k) => {
        const vals = measurements
          .filter((x) => x.phase === phase && x.kind === k)
          .map((x) => x.seconds);
        return vals.length
          ? {
              n: vals.length,
              mean: vals.reduce((s, v) => s + v, 0) / vals.length,
              sd:
                vals.length > 1
                  ? Math.sqrt(
                      vals.reduce(
                        (s, v) =>
                          s +
                          (v - vals.reduce((s, v) => s + v, 0) / vals.length) **
                            2,
                        0,
                      ) /
                        (vals.length - 1),
                    )
                  : null,
            }
          : null;
      };
    return {
      ...m,
      duplicates: active.filter((a) => a.duplicate).length,
      automated: rows.filter((a) => a.source === "portal").length,
      incidents: incidents.filter((i) => i.phase === phase).length,
      registrationTime: mean("registro"),
      reportTime: mean("reporte"),
    };
  };
  return {
    pre: summarize("pre"),
    post: summarize("post"),
    notifications: {
      total: jobs.length,
      accepted: jobs.filter((j) =>
        ["accepted", "delivered", "read"].includes(j.status),
      ).length,
      delivered: jobs.filter((j) => ["delivered", "read"].includes(j.status))
        .length,
      failed: jobs.filter((j) => j.status === "failed").length,
      pending: jobs.filter((j) => ["queued", "blocked"].includes(j.status))
        .length,
      uncertain: jobs.filter((j) => ["sending", "review"].includes(j.status))
        .length,
    },
    total: all.length,
    generatedAt: now(),
    demo,
    start,
    end,
  };
}
export async function saveSettings(store, secret, input, user) {
  return store.tx(async (db) => {
    const old = await center(db),
      cfg = {
        ...old,
        name: text(input.name, 90),
        address: text(input.address, 150),
        phone: phone(input.phone),
        open: input.open,
        close: input.close,
        equipment: Array.isArray(input.equipment)
          ? [
              ...new Set(
                input.equipment.map((x) => text(x, 90)).filter(Boolean),
              ),
            ]
          : [],
        services: input.services,
        publicBooking: input.publicBooking === true,
        reminderHours: Number(input.reminderHours),
      };
    if (
      !cfg.name ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.open) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.close) ||
      minutes(cfg.open) >= minutes(cfg.close) ||
      !cfg.equipment.length ||
      cfg.equipment.length > 20 ||
      !Array.isArray(cfg.services) ||
      !cfg.services.length ||
      cfg.services.length > 30 ||
      cfg.services.some(
        (s) =>
          typeof s.name !== "string" ||
          !s.name.trim() ||
          s.name.length > 90 ||
          !Number.isInteger(s.duration) ||
          s.duration < 15 ||
          s.duration > 120,
      ) ||
      !Number.isFinite(cfg.reminderHours) ||
      cfg.reminderHours < 1 ||
      cfg.reminderHours > 72
    )
      fail(
        400,
        "Revisa nombre, horario, equipos, tratamientos y anticipación.",
      );
    await db.put("settings", cfg);
    await audit(db, secret, user, "Configuración actualizada", {
      before: old,
      after: cfg,
    });
    return cfg;
  });
}
