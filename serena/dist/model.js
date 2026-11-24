export const equipment = [
  "Equipo térmico 1",
  "Equipo térmico 2",
  "Equipo térmico 3",
];
export const statuses = [
  "Pendiente",
  "Confirmada",
  "Asistió",
  "No asistió",
  "Cancelada",
];
export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export const minutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
export function validate(a, rows) {
  if (!a.name?.trim() || !a.contact?.trim())
    return "Completa el nombre y el contacto.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
    Number.isNaN(Date.parse(a.date + "T12:00:00")) ||
    new Date(a.date + "T12:00:00Z").toISOString().slice(0, 10) !== a.date
  )
    return "Selecciona una fecha válida.";
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) ||
    !Number.isFinite(a.duration) ||
    a.duration < 15 ||
    a.duration > 120
  )
    return "Revisa la hora y duración (15 a 120 minutos).";
  if (
    !equipment.includes(a.equipment) ||
    !statuses.includes(a.status) ||
    !["pre", "post"].includes(a.phase)
  )
    return "Revisa el equipo, estado y periodo.";
  const start = minutes(a.time),
    end = start + a.duration;
  if (start < 8 * 60 || end > 20 * 60)
    return "El horario de atención es de 08:00 a 20:00.";
  if (
    a.status !== "Cancelada" &&
    rows.some(
      (b) =>
        b.id !== a.id &&
        b.date === a.date &&
        b.equipment === a.equipment &&
        b.status !== "Cancelada" &&
        b.phase === a.phase &&
        start < minutes(b.time) + b.duration &&
        end > minutes(b.time),
    )
  )
    return "Este equipo ya está reservado en ese horario. Elige otro horario o equipo.";
  return "";
}
export function metrics(rows) {
  const active = rows.filter((a) => a.status !== "Cancelada"),
    closed = active.filter((a) => ["Asistió", "No asistió"].includes(a.status));
  const rate = (n, d) => (d ? (n / d) * 100 : null);
  return {
    total: active.length,
    closed: closed.length,
    errors: active.filter((a) => a.error).length,
    errorRate: rate(active.filter((a) => a.error).length, active.length),
    absent: closed.filter((a) => a.status === "No asistió").length,
    absenceRate: rate(
      closed.filter((a) => a.status === "No asistió").length,
      closed.length,
    ),
    traceRate: rate(active.filter((a) => a.followup).length, active.length),
  };
}
export function toCSV(rows) {
  return (
    "\ufeff" +
    rows
      .map((r) =>
        r
          .map(
            (v) =>
              '"' +
              String(v ?? "")
                .replace(/^[=+@\-\t\r]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n")
  );
}
