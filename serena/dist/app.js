import { api, esc, download } from "./api.js";
import { localDate, minutes, metrics, toCSV, statuses } from "./model.js";
const $ = (s) => document.querySelector(s);
let state = null,
  date = localDate(),
  query = "",
  tab = "all",
  phase = "post",
  reportStart = "",
  reportEnd = "",
  lastReport = null,
  aiResult = null,
  aiText = "",
  userList = [];
const badge = (s) =>
  `<span class="badge ${["Asistió", "Confirmada", "delivered", "read", "done"].includes(s) ? "attended" : ["failed", "No asistió"].includes(s) ? "absent" : ""}">${esc({ blocked: "Sin API", queued: "En cola", accepted: "Aceptado por Meta", delivered: "Entregado", read: "Leído", failed: "Fallido", review: "Revisar envío", cancelled: "Cancelado", sending: "En proceso", done: "Completado", processing: "Interpretando" }[s] || s)}</span>`;
const pct = (v) => (v == null ? "—" : v.toFixed(1) + " %");
const heading = (title, description, actions = "") =>
  `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
const button = (action, text, cls = "") =>
  `<button data-action="${action}" class="${cls}">${text}</button>`;
const dateTime = (t) =>
  new Date(t).toLocaleString("es-PE", { timeZone: "America/Lima" });
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
const editable = () => state?.user.role !== "viewer";
async function load() {
  state = await api("/api/state");
  $("#user-name").textContent =
    state.user.name +
    " · " +
    { admin: "Administración", staff: "Recepción", viewer: "Consulta" }[
      state.user.role
    ];
  $("#center-name").textContent = state.config.name;
  $("#connection").textContent = state.storage;
  document.body.classList.remove("signed-out");
}
function showAuth(setup) {
  state = null;
  document.body.classList.add("signed-out");
  $("#connection").textContent = "Acceso protegido";
  $("#main").innerHTML =
    `<section class="auth-card"><div class="auth-mark">Kawsay Bienestar</div><h1>${setup ? "Crea tu administración" : "Inicia sesión"}</h1><p>${setup ? "Elige tus datos de acceso. La contraseña se guarda cifrada mediante hash." : "Gestiona las citas y los riesgos de tu centro."}</p><form id="auth-form" data-setup="${setup}" class="stack">${setup ? '<label>Tu nombre<input name="name" required autocomplete="name" value="Brayan"></label>' : ""}<label>Correo<input name="email" type="email" required autocomplete="username"></label><label>Contraseña<input name="password" type="password" required ${setup ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'} maxlength="128"></label>${setup ? '<small>Mínimo 12 caracteres. Créala tú y no la compartas por el chat.</small><label>Clave de instalación (solo al abrir desde Render)<input name="bootstrap" type="password" autocomplete="off"></label>' : ""}<p class="form-error" id="auth-error" role="alert"></p><button class="primary">${setup ? "Crear administración" : "Ingresar"}</button></form><a class="portal-link" href="reservar">Reservar una sesión como cliente</a></section>`;
}
function filteredRows() {
  return state.rows
    .filter(
      (a) =>
        a.date === date &&
        a.phase === phase &&
        (tab === "all" || a.status === tab) &&
        [a.name, a.contact, a.service]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}
function table(rows) {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Horario</th><th>Tratamiento y equipo</th><th>Estado</th><th class="num">Acciones</th></tr></thead><tbody>${rows.map((a) => `<tr><td>${esc(a.name)}<small>+${esc(a.contact)}${a.demo ? " · Demostración" : ""}</small></td><td>${esc(a.time)}<small>${esc(a.date)} · ${a.duration} min</small></td><td>${esc(a.service)}<small>${esc(a.equipment)}</small></td><td>${badge(a.status)}</td><td><div class="row-actions">${editable() ? `<button data-action="edit" data-id="${a.id}">Editar</button><button data-action="message" data-id="${a.id}">WhatsApp</button>` : "Consulta"}</div></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty"><h2>Sin citas en esta vista</h2><p>Prueba otra fecha o registra la primera sesión.</p></div>';
}
function agenda() {
  const cfg = state.config,
    rows = state.rows.filter(
      (a) => a.date === date && a.phase === phase && !a.demo,
    ),
    active = rows.filter((a) => a.status !== "Cancelada"),
    pending = active.filter((a) => a.status === "Pendiente"),
    span = minutes(cfg.close) - minutes(cfg.open);
  return (
    heading(
      "Agenda de citas",
      "Disponibilidad, reservas y atención en un solo lugar.",
      editable() ? button("new", "+ Nueva cita", "primary") : "",
    ) +
    `<div class="scope"><div class="tabs">${[
      ["all", "Todas"],
      ["Pendiente", "Pendientes"],
      ["Confirmada", "Confirmadas"],
      ["Asistió", "Atendidas"],
    ]
      .map(
        ([v, l]) =>
          `<button data-tab="${v}" class="${tab === v ? "active" : ""}">${l}</button>`,
      )
      .join(
        "",
      )}</div><label>Fecha<input type="date" id="agenda-date" value="${date}"></label><label>Periodo<select id="phase"><option value="post" ${phase === "post" ? "selected" : ""}>Después · Sistema</option><option value="pre" ${phase === "pre" ? "selected" : ""}>Antes · Manual</option></select></label></div><div class="stats">${[
      ["Citas programadas", active.length, "Sin cancelaciones"],
      ["Por confirmar", pending.length, "Requieren seguimiento"],
      [
        "Sesiones atendidas",
        active.filter((a) => a.status === "Asistió").length,
        "Asistencia registrada",
      ],
      [
        "Tiempo reservado",
        active.reduce((n, a) => n + a.duration, 0) + " min",
        "En todos los equipos",
      ],
    ]
      .map(
        ([l, n, c]) =>
          `<div class="stat"><span>${l}</span><strong>${n}</strong><small>${c}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>Disponibilidad de equipos</h2><small>${esc(cfg.open)} a ${esc(cfg.close)}</small></div>${cfg.equipment
      .map((e) => {
        const list = active.filter((a) => a.equipment === e);
        return `<div class="equipment"><div class="equipment-head"><strong>${esc(e)}</strong><span>${list.length} sesiones</span></div><div class="track">${list.map((a) => `<div class="slot" style="left:${Math.max(0, ((minutes(a.time) - minutes(cfg.open)) / span) * 100)}%;width:${(a.duration / span) * 100}%" title="${esc(a.time + " · " + a.name)}"></div>`).join("")}</div><div class="hours"><span>${esc(cfg.open)}</span><span>${esc(cfg.close)}</span></div></div>`;
      })
      .join(
        "",
      )}</section><section class="panel"><div class="panel-head"><h2>Próximas confirmaciones</h2><a href="#reminders">Ver flujos</a></div>${
      pending
        .slice(0, 3)
        .map(
          (a) =>
            `<div class="rail-row"><strong>${esc(a.name)}</strong><p>${esc(a.time)} · ${esc(a.service)}</p><button data-action="message" data-id="${a.id}">Abrir WhatsApp</button></div>`,
        )
        .join("") || "<p>No hay confirmaciones pendientes.</p>"
    }</section></div><div class="table-head"><h2>Citas del día</h2><input id="search" class="search" type="search" aria-label="Buscar citas" placeholder="Buscar cliente o tratamiento" value="${esc(query)}"></div>${table(filteredRows())}`
  );
}
function clients() {
  const grouped = new Map();
  for (const a of state.rows) {
    const c = grouped.get(a.contact) || {
      name: a.name,
      contact: a.contact,
      total: 0,
      attended: 0,
    };
    c.total++;
    if (a.status === "Asistió") c.attended++;
    grouped.set(a.contact, c);
  }
  return (
    heading("Clientes", "Historial de atención agrupado por celular.") +
    `<div class="table-head"><h2>${grouped.size} clientes</h2><input id="search" class="search" type="search" aria-label="Buscar clientes" placeholder="Buscar nombre o celular" value="${esc(query)}"></div><div class="client-grid">${[
      ...grouped.values(),
    ]
      .filter((c) =>
        (c.name + c.contact).toLowerCase().includes(query.toLowerCase()),
      )
      .map(
        (c) =>
          `<article class="panel"><h2>${esc(c.name)}</h2><p>+${esc(c.contact)}</p><p class="count">${c.total} citas · ${c.attended} asistencias</p></article>`,
      )
      .join("")}</div>` +
    (!grouped.size
      ? '<div class="empty">Los clientes aparecerán al registrar sus citas.</div>'
      : "")
  );
}
function reminders() {
  const jobs = state.jobs
    .filter((j) => j.kind !== "ai")
    .sort((a, b) => b.created.localeCompare(a.created));
  return (
    heading(
      "WhatsApp y flujos",
      "Confirmaciones y recordatorios con estado verificable.",
      state.user.role === "admin" ? button("run", "Ejecutar flujos ahora") : "",
    ) +
    `<div class="notice"><span>${state.integrations.whatsapp.enabled ? "WhatsApp Cloud API habilitada. «Aceptado» no significa «Entregado»: la entrega se actualiza mediante webhooks." : "WhatsApp del celular: abre el mensaje y pulsa Enviar. El envío automático queda bloqueado hasta conectar la API oficial de Meta; no se contabiliza como enviado."}</span></div><div class="grid"><section class="panel"><div class="panel-head"><h2>Flujo de atención</h2></div><ol class="flow-list"><li>Validar y registrar la reserva sin cruces.</li><li>Preparar la confirmación al registrar.</li><li>Programar el recordatorio ${state.config.reminderHours} horas antes.</li><li>Registrar aceptación y entrega informadas por Meta.</li><li>Generar un reporte diario y conservar la auditoría.</li></ol></section><section class="panel"><h2>Automatización activa</h2><p>El servidor revisa la cola cada 30 segundos mientras está en ejecución. No depende del navegador.</p><p>${state.snapshots.length} reportes diarios generados.</p></section></div><div class="table-head"><h2>Cola de mensajes</h2></div>${
      jobs.length
        ? `<div class="table-wrap"><table><thead><tr><th>Cita</th><th>Tipo</th><th>Programado · Lima</th><th>Estado</th></tr></thead><tbody>${jobs
            .map((j) => {
              const a = state.rows.find((a) => a.id === j.appointmentId);
              return `<tr><td>${esc(a?.name || "Cita archivada")}<small>${esc(j.error || "")}</small></td><td>${j.kind === "confirmation" ? "Confirmación" : "Recordatorio"}</td><td>${dateTime(j.due)}</td><td>${badge(j.status)}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : '<div class="empty">La cola se crea con citas futuras que tengan autorización de mensajes.</div>'
    }<div class="table-head"><h2>Citas pendientes de atención</h2></div>${table(state.rows.filter((a) => a.phase === "post" && ["Pendiente", "Confirmada"].includes(a.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)))}`
  );
}
function providerLabel() {
  const ai = state.integrations.ai;
  return (
    (ai.provider === "nvidia"
      ? ai.configured
        ? "NVIDIA · "
        : "NVIDIA: falta configurar la clave · "
      : "IA · ") + esc(ai.model)
  );
}
function ai() {
  const online =
    state.integrations.ai.provider !== "bridge" ||
    (state.heartbeat && Date.now() - Date.parse(state.heartbeat.time) < 60000);
  return (
    heading(
      "Asistente de reservas",
      "Convierte una solicitud en una propuesta de cita que tú revisas.",
    ) +
    `<div class="notice"><span>${state.integrations.ai.provider === "disabled" ? "IA pendiente de configuración." : state.integrations.ai.provider === "bridge" ? (online ? "Ollama conectado desde tu PC. No se abre el puerto de Ollama a internet." : "Esperando el enlace de Ollama. Enciende tu PC y ejecuta el enlace de IA.") : providerLabel()} La IA no confirma reservas ni cambia citas por sí sola.</span></div><div class="grid"><section class="panel"><form id="ai-form" class="stack"><label>Solicitud del cliente<textarea name="text" rows="6" maxlength="2000" required placeholder="Quiero un masaje térmico mañana a las 10 de la mañana.">${esc(aiText)}</textarea></label><small>Escribe solo los detalles de la reserva. No incluyas datos clínicos.</small><button class="primary">Interpretar solicitud</button><p class="form-error" id="ai-error" role="alert"></p></form></section><section class="panel"><h2>Propuesta para revisar</h2>${aiResult ? `<dl class="details"><dt>Intención</dt><dd>${esc(aiResult.intent)}</dd><dt>Fecha</dt><dd>${esc(aiResult.date || "Por definir")}</dd><dt>Hora</dt><dd>${esc(aiResult.time || "Por definir")}</dd><dt>Tratamiento</dt><dd>${esc(aiResult.service || "Por definir")}</dd></dl><p>${esc(aiResult.note)}</p>${button("use-ai", "Revisar y completar cita")}` : "<p>La interpretación aparecerá aquí. Los datos faltantes se muestran sin inventarlos.</p>"}</section></div>`
  );
}
function diff(a, b, type) {
  return a == null || b == null
    ? "—"
    : (b - a > 0 ? "+" : "") +
        (type === "rate" ? (b - a).toFixed(1) + " pp" : b - a);
}
function reportLines(r) {
  const x = r.pre,
    y = r.post;
  return [
    ["Citas evaluadas", x.total, y.total, "count"],
    ["Errores de registro", x.errors, y.errors, "count"],
    ["Citas con errores", x.errorRate, y.errorRate, "rate"],
    ["Citas duplicadas declaradas", x.duplicates, y.duplicates, "count"],
    ["Citas con asistencia resuelta", x.closed, y.closed, "count"],
    ["Inasistencias", x.absent, y.absent, "count"],
    ["Tasa de inasistencia", x.absenceRate, y.absenceRate, "rate"],
    ["Seguimiento completo", x.traceRate, y.traceRate, "rate"],
    ["Incidentes registrados", x.incidents, y.incidents, "count"],
    ["Reservas por autogestión web", x.automated, y.automated, "count"],
  ];
}
function reports() {
  const r = lastReport;
  return (
    heading(
      "Resultados y mediciones",
      "Evidencia descriptiva según las dimensiones de tu investigación.",
      button("report", "Actualizar comparativo"),
    ) +
    `<div class="filter-row"><label>Desde<input id="report-start" type="date" value="${reportStart}"></label><label>Hasta<input id="report-end" type="date" value="${reportEnd}"></label>${editable() ? button("manual", "+ Registro del pretest") + button("measure", "Registrar tiempo observado") : ""}</div>${
      r
        ? `<section class="panel"><div class="panel-head"><h2>Antes / después</h2>${button("report-export", "Exportar comparativo")}</div><div class="table-wrap"><table class="report-table"><thead><tr><th>Indicador</th><th class="num">Antes · Manual</th><th class="num">Después · Sistema</th><th class="num">Cambio</th></tr></thead><tbody>${reportLines(
            r,
          )
            .map(
              ([l, a, b, t]) =>
                `<tr><td>${l}</td><td class="num">${t === "rate" ? pct(a) : a}</td><td class="num">${t === "rate" ? pct(b) : b}</td><td class="num">${diff(a, b, t)}</td></tr>`,
            )
            .join(
              "",
            )}</tbody></table></div><p class="report-note">Inasistencia = No asistió / (Asistió + No asistió). Excluye pendientes y canceladas. Seguimiento = registros completos / citas no canceladas. «pp» = puntos porcentuales. Los registros de demostración están excluidos.</p></section><div class="grid section-space"><section class="panel"><h2>Notificaciones del postest</h2><dl class="details">${[
            ["Programadas", r.notifications.total],
            ["Aceptadas por Meta", r.notifications.accepted],
            ["Entregadas o leídas", r.notifications.delivered],
            ["Fallidas", r.notifications.failed],
            ["En cola o sin API", r.notifications.pending],
            ["En revisión", r.notifications.uncertain],
          ]
            .map(([l, v]) => `<dt>${l}</dt><dd>${v}</dd>`)
            .join(
              "",
            )}</dl></section><section class="panel"><h2>Tiempos observados</h2>${[
            "pre",
            "post",
          ]
            .map(
              (p) =>
                `<p><strong>${p === "pre" ? "Antes" : "Después"}</strong></p>${[
                  ["registro", "registrationTime"],
                  ["reporte", "reportTime"],
                ]
                  .map(
                    ([l, k]) =>
                      `<p>${l}: ${r[p][k] ? r[p][k].mean.toFixed(2) + " s · n=" + r[p][k].n : "Sin mediciones"}</p>`,
                  )
                  .join("")}`,
            )
            .join(
              "",
            )}<small>Consulta el método de cada observación antes de comparar.</small></section></div>`
        : '<div class="empty">Pulsa «Actualizar comparativo» para generar los resultados.</div>'
    }<p class="report-note">Los porcentajes describen los registros; no demuestran causalidad ni significancia estadística. Un cero en incidentes representa registros existentes, no una certificación de seguridad. Los duplicados históricos se ingresan como evidencia del pretest.</p><div class="table-head"><h2>Ficha de tiempos</h2>${button("measure-export", "Exportar ficha")}</div>${
      state.measurements.length
        ? `<div class="table-wrap"><table><thead><tr><th>Fecha / proceso</th><th>Periodo</th><th class="num">Segundos</th><th>Método</th></tr></thead><tbody>${state.measurements
            .slice(-30)
            .reverse()
            .map(
              (m) =>
                `<tr><td>${esc(m.date)}<small>${esc(m.kind)}</small></td><td>${m.phase === "pre" ? "Antes" : "Después"}</td><td class="num">${m.seconds.toFixed(3)}</td><td>${esc(m.method)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty">Sin mediciones de tiempo todavía.</div>'
    }<div class="data-actions">${button("export", "Exportar citas (CSV)")}${state.user.role === "admin" ? button("backup", "Descargar respaldo") : ""}</div>`
  );
}
function activity() {
  return (
    heading(
      "Auditoría e incidentes",
      "Cambios registrados por el servidor, con firma y secuencia.",
      (state.user.role === "admin"
        ? button("verify", "Verificar integridad")
        : "") + (editable() ? button("incident", "+ Registrar incidente") : ""),
    ) +
    `<div class="notice">El historial es de solo anexado en la base de datos. La firma detecta cambios dentro de la cadena; el propietario de la infraestructura conserva control técnico del sistema.</div><section class="panel"><div class="panel-head"><h2>Incidentes de seguridad</h2><small>${state.incidents.length} registrados</small></div>${state.incidents.map((i) => `<div class="rail-row"><strong>${esc(i.date)} · ${esc(i.severity)}</strong><p>${esc(i.description)}</p></div>`).join("") || "<p>No hay incidentes registrados. Esto no implica ausencia demostrada de incidentes.</p>"}</section><div class="table-head"><h2>Actividad reciente</h2>${button("logs-export", "Exportar historial")}</div><div class="table-wrap"><table><thead><tr><th>Fecha · Lima</th><th>Actividad</th><th>Responsable</th><th>Referencia</th></tr></thead><tbody>${state.logs.map((l) => `<tr><td>${dateTime(l.time)}</td><td>${esc(l.action)}</td><td>${esc(l.actor)}</td><td>${esc(l.detail?.id || l.detail?.jobId || l.detail?.date || "—")}</td></tr>`).join("")}</tbody></table></div>`
  );
}
function settings() {
  const c = state.config;
  if (state.user.role !== "admin")
    return (
      heading(
        "Configuración",
        "Solo la administración puede modificar el centro.",
      ) +
      `<section class="panel"><h2>${esc(c.name)}</h2><p>${esc(c.address)}</p></section>`
    );
  return (
    heading(
      "Configuración",
      "Datos de la sucursal, servicios y acceso del personal.",
    ) +
    `<div class="grid"><section class="panel"><form id="settings-form" class="stack"><label>Nombre del centro<input name="name" value="${esc(c.name)}" required></label><label>Dirección<input name="address" value="${esc(c.address)}"></label><label>Celular de atención<input name="phone" type="tel" value="${esc(c.phone)}"></label><div class="form-grid"><label>Apertura<input name="open" type="time" value="${esc(c.open)}" required></label><label>Cierre<input name="close" type="time" value="${esc(c.close)}" required></label></div><label>Equipos (uno por línea)<textarea name="equipment" rows="3" required>${esc(c.equipment.join("\n"))}</textarea></label><label>Tratamientos (nombre | minutos)<textarea name="services" rows="4" required>${esc(c.services.map((s) => s.name + " | " + s.duration).join("\n"))}</textarea></label><label>Anticipación del recordatorio (horas)<input name="reminderHours" type="number" min="1" max="72" value="${c.reminderHours}"></label><label class="inline-check"><input type="checkbox" name="publicBooking" ${c.publicBooking ? "checked" : ""}> Permitir reservas en línea</label><p id="settings-error" class="form-error" role="alert"></p><button class="primary">Guardar configuración</button></form></section><div><section class="panel"><div class="panel-head"><h2>Personal autorizado</h2>${button("users", "Actualizar")}</div>${userList.map((u) => `<div class="rail-row"><strong>${esc(u.name)}</strong><p>${esc(u.email)} · ${esc(u.role)}</p></div>`).join("")}${button("new-user", "Crear usuario")}</section></div></div>`
  );
}
const views = { agenda, clients, reminders, ai, reports, activity, settings };
const current = () =>
  Object.hasOwn(views, location.hash.slice(1))
    ? location.hash.slice(1)
    : "agenda";
function render() {
  if (!state) return;
  $("#main").innerHTML = views[current()]();
  document.querySelectorAll("[data-page]").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === current());
    if (a.dataset.page === current()) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
function appointment(id, pre = false, proposed = null) {
  const a = state.rows.find((x) => x.id === id),
    f = $("#appointment-form");
  f.reset();
  f.elements.equipment.innerHTML = state.config.equipment
    .map((s) => `<option>${esc(s)}</option>`)
    .join("");
  f.elements.service.innerHTML = state.config.services
    .map((s) => `<option>${esc(s.name)}</option>`)
    .join("");
  f.elements.status.innerHTML = statuses
    .map((s) => `<option>${s}</option>`)
    .join("");
  const values = a || {
    id: "",
    version: "",
    date,
    time: "09:00",
    phase: pre ? "pre" : "post",
    status: "Pendiente",
    duration: state.config.services[0].duration,
    followup: true,
    ...proposed,
  };
  for (const [k, v] of Object.entries(values)) {
    const el = f.elements.namedItem(k);
    if (!el || v == null) continue;
    if (el.type === "checkbox") el.checked = Boolean(v);
    else {
      if (
        el.tagName === "SELECT" &&
        ![...el.options].some((o) => o.value === String(v))
      )
        el.add(new Option(v, v));
      el.value = v;
    }
  }
  $("#form-title").textContent = a
    ? "Editar cita"
    : pre
      ? "Registro del pretest"
      : "Nueva cita";
  $("#form-error").textContent = "";
  $("#appointment").showModal();
}
function extra(title, html) {
  $("#extra-title").textContent = title;
  $("#extra-body").innerHTML = html;
  $("#extra").showModal();
}
const periodOptions =
  '<option value="pre">Antes · Manual</option><option value="post">Después · Sistema</option>';
async function updateReport() {
  lastReport = (
    await api(
      "/api/report?" +
        new URLSearchParams({ start: reportStart, end: reportEnd }),
    )
  ).report;
  await load();
  render();
}
const actions = {
  new: () => appointment(),
  edit: (id) => appointment(id),
  manual: () => appointment(null, true),
  refresh: async () => {
    await load();
    render();
  },
  report: updateReport,
  "use-ai": () =>
    appointment(
      null,
      false,
      aiResult
        ? {
            date: aiResult.date || date,
            time: aiResult.time || "09:00",
            service: aiResult.service || state.config.services[0].name,
          }
        : null,
    ),
  message: (id) => {
    const a = state.rows.find((x) => x.id === id);
    if (!a) return;
    const text = `Hola, ${a.name}. ${state.config.name} te recuerda tu cita de ${a.service} el ${a.date} a las ${a.time} (${a.duration} minutos), en Los Olivos. Por favor confirma tu asistencia o avísanos si necesitas reprogramar.`;
    $("#message-text").value = text;
    $("#whatsapp-link").href =
      "https://wa.me/" + a.contact + "?text=" + encodeURIComponent(text);
    $("#message").showModal();
  },
  run: async () => {
    await api("/api/automation/run", { method: "POST", body: {} });
    await load();
    render();
    toast("Flujos revisados. Consulta el estado de cada mensaje.");
  },
  verify: async () => {
    const r = await api("/api/audit/verify");
    toast(
      r.valid
        ? `Integridad verificada: ${r.count} eventos firmados.`
        : "La cadena de auditoría presenta una inconsistencia.",
    );
  },
  users: async () => {
    userList = (await api("/api/users")).users;
    render();
  },
  "new-user": () =>
    extra(
      "Crear usuario",
      `<form id="user-form" class="stack"><label>Nombre<input name="name" required></label><label>Correo<input name="email" type="email" required></label><label>Contraseña inicial<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>Rol<select name="role"><option value="staff">Recepción</option><option value="viewer">Solo consulta</option><option value="admin">Administración</option></select></label><p class="form-error" role="alert"></p><button class="primary">Crear usuario</button></form>`,
    ),
  measure: () =>
    extra(
      "Registrar tiempo observado",
      `<form id="measurement-form" class="stack"><label>Fecha<input type="date" name="date" value="${localDate()}" required></label><label>Periodo<select name="phase">${periodOptions}</select></label><label>Proceso<select name="kind"><option value="registro">Registro de cita</option><option value="reporte">Generación de reporte</option></select></label><label>Tiempo observado (segundos)<input name="seconds" type="number" min="0.001" step="0.001" required></label><label>Método de observación<textarea name="method" required placeholder="Ejemplo: cronómetro, desde iniciar el registro hasta confirmar la cita."></textarea></label><p class="form-error" role="alert"></p><button class="primary">Guardar medición</button></form>`,
    ),
  incident: () =>
    extra(
      "Registrar incidente",
      `<form id="incident-form" class="stack"><label>Fecha<input type="date" name="date" required value="${localDate()}"></label><label>Periodo<select name="phase">${periodOptions}</select></label><label>Gravedad<select name="severity"><option>baja</option><option>media</option><option>alta</option></select></label><label>Descripción<textarea name="description" rows="4" required maxlength="1500"></textarea></label><p class="form-error" role="alert"></p><button class="primary">Registrar incidente</button></form>`,
    ),
  backup: async () =>
    download(
      "kawsay-respaldo.json",
      JSON.stringify(await api("/api/backup"), null, 2),
      "application/json",
    ),
  export: () =>
    download(
      "kawsay-citas.csv",
      toCSV([
        [
          "ID",
          "Nombre",
          "Celular",
          "Fecha",
          "Hora",
          "Duración min",
          "Equipo",
          "Tratamiento",
          "Estado",
          "Periodo",
          "Error original",
          "Duplicado original",
          "Seguimiento completo",
          "Fuente",
          "Demo",
        ],
        ...state.rows.map((a) => [
          a.id,
          a.name,
          a.contact,
          a.date,
          a.time,
          a.duration,
          a.equipment,
          a.service,
          a.status,
          a.phase,
          a.error,
          a.duplicate,
          a.followup,
          a.source,
          a.demo,
        ]),
      ]),
    ),
  "report-export": () => {
    if (!lastReport) return;
    download(
      "kawsay-resultados.csv",
      toCSV([
        ["Periodo inicial", reportStart || "Sin límite"],
        ["Periodo final", reportEnd || "Sin límite"],
        ["Indicador", "Antes", "Después", "Cambio"],
        ...reportLines(lastReport).map(([l, a, b, t]) => [
          l,
          t === "rate" ? pct(a) : a,
          t === "rate" ? pct(b) : b,
          diff(a, b, t),
        ]),
        [
          "Nota",
          "Comparación descriptiva. Inasistencia sobre citas resueltas; excluye canceladas y pendientes. No es prueba de significancia.",
        ],
      ]),
    );
  },
  "logs-export": () =>
    download(
      "kawsay-auditoria.csv",
      toCSV([
        [
          "Secuencia",
          "Fecha UTC",
          "Actividad",
          "Responsable",
          "Detalle",
          "Firma",
          "Firma anterior",
        ],
        ...state.logs.map((l) => [
          l.seq,
          l.time,
          l.action,
          l.actor,
          JSON.stringify(l.detail),
          l.signature,
          l.previous,
        ]),
      ]),
    ),
  "measure-export": () =>
    download(
      "kawsay-tiempos.csv",
      toCSV([
        ["Fecha", "Proceso", "Periodo", "Segundos", "Método"],
        ...state.measurements.map((m) => [
          m.date,
          m.kind,
          m.phase,
          m.seconds,
          m.method,
        ]),
      ]),
    ),
};
document.addEventListener("click", async (e) => {
  const close = e.target.closest("[data-close]");
  if (close) {
    close.closest("dialog").close();
    return;
  }
  const t = e.target.closest("[data-tab]");
  if (t) {
    tab = t.dataset.tab;
    render();
    return;
  }
  const a = e.target.closest("[data-action]");
  if (a) {
    a.disabled = true;
    try {
      await actions[a.dataset.action]?.(a.dataset.id);
    } catch (err) {
      toast(err.message);
      if (err.status === 401) showAuth(false);
    } finally {
      a.disabled = false;
    }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "agenda-date") {
    date = e.target.value;
    render();
  }
  if (e.target.id === "phase") {
    phase = e.target.value;
    render();
  }
  if (e.target.id === "report-start") reportStart = e.target.value;
  if (e.target.id === "report-end") reportEnd = e.target.value;
  if (e.target.name === "service" && e.target.closest("#appointment-form"))
    $("#appointment-form").elements.duration.value =
      state.config.services.find((s) => s.name === e.target.value)?.duration ||
      30;
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    b = Object.fromEntries(new FormData(f)),
    submit = f.querySelector('button[type="submit"],button.primary');
  if (submit) submit.disabled = true;
  const error = f.querySelector(".form-error");
  if (error) error.textContent = "";
  try {
    if (f.id === "auth-form") {
      await api(
        "/api/auth/" + (f.dataset.setup === "true" ? "setup" : "login"),
        { method: "POST", body: b },
      );
      await load();
      render();
    } else if (f.id === "appointment-form") {
      b.duration = Number(b.duration);
      b.version = Number(b.version);
      for (const k of ["error", "duplicate", "followup", "consent"])
        b[k] = f.elements[k].checked;
      if (!b.id) delete b.id;
      await api("/api/appointments", { method: "POST", body: b });
      $("#appointment").close();
      date = b.date;
      phase = b.phase;
      await load();
      render();
      toast("Cita guardada en la base de datos.");
    } else if (f.id === "settings-form") {
      b.equipment = b.equipment
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      b.services = b.services
        .split("\n")
        .filter((x) => x.trim())
        .map((x) => {
          const [name, duration] = x.split("|");
          return { name: name.trim(), duration: Number(duration) };
        });
      b.publicBooking = f.elements.publicBooking.checked;
      b.reminderHours = Number(b.reminderHours);
      await api("/api/settings", { method: "POST", body: b });
      await load();
      render();
      toast("Configuración actualizada.");
    } else if (
      ["measurement-form", "incident-form", "user-form"].includes(f.id)
    ) {
      await api(
        "/api/" +
          {
            "measurement-form": "measurements",
            "incident-form": "incidents",
            "user-form": "users",
          }[f.id],
        { method: "POST", body: b },
      );
      $("#extra").close();
      await load();
      render();
      toast("Registro guardado.");
    } else if (f.id === "ai-form") {
      aiText = b.text;
      const r = await api("/api/ai", { method: "POST", body: b });
      if (r.result) {
        aiResult = r.result;
        render();
      } else {
        toast("Solicitud enviada a tu PC. Esperando a Ollama…");
        let done = false;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const j = await api("/api/ai/" + r.jobId);
          if (j.status === "done") {
            aiResult = j.result;
            done = true;
            render();
            break;
          }
          if (j.status === "failed")
            throw Error(j.error || "La IA no completó la tarea.");
        }
        if (!done)
          throw Error(
            "La tarea sigue pendiente. Revisa que tu PC y el enlace de IA estén encendidos.",
          );
      }
    }
  } catch (err) {
    if (error) error.textContent = err.message;
    else toast(err.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});
$("#copy-message").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("#message-text").value);
    toast("Mensaje copiado.");
  } catch {
    $("#message-text").select();
    toast("Copia el texto seleccionado con Ctrl+C.");
  }
};
$("#message-text").oninput = () => {
  const current = new URL($("#whatsapp-link").href);
  current.searchParams.set("text", $("#message-text").value);
  $("#whatsapp-link").href = current.toString();
};
$("#menu").onclick = () => {
  $("#menu").setAttribute(
    "aria-expanded",
    String($("#sidebar").classList.toggle("open")),
  );
};
$("#logout").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
    showAuth(false);
  } catch (e) {
    toast(e.message);
  }
};
window.addEventListener("hashchange", () => {
  query = "";
  $("#sidebar").classList.remove("open");
  $("#menu").setAttribute("aria-expanded", "false");
  render();
});
async function init() {
  try {
    const auth = await api("/api/auth/status");
    if (auth.user) {
      await load();
      render();
    } else showAuth(auth.setup);
  } catch (e) {
    $("#main").innerHTML =
      `<div class="empty"><h1>No se pudo conectar</h1><p>${esc(e.message)}</p><button data-action="refresh">Reintentar</button></div>`;
  }
}
init();
