import { api, esc } from "./api.js";
import { localDate } from "./model.js";
const main = document.querySelector("#portal-main");
let cfg,
  slots = [];
const params = new URLSearchParams(location.search),
  manageId = params.get("cita"),
  token = params.get("token");
function message(text) {
  const el = document.querySelector("#portal-error");
  if (el) el.textContent = text;
}
async function updateSlots() {
  const f = document.querySelector("#booking-form");
  const area = document.querySelector("#slot-area");
  area.textContent = "Consultando horarios disponibles…";
  try {
    const r = await api(
      "/api/public/slots?" +
        new URLSearchParams({
          date: f.elements.date.value,
          service: f.elements.service.value,
        }),
    );
    slots = r.slots;
    area.innerHTML = slots.length
      ? `<label>Horario y equipo<select name="slot" required>${slots.map((s, i) => `<option value="${i}">${esc(s.time)} · ${esc(s.equipment)} · ${s.duration} min</option>`).join("")}</select></label>`
      : '<div class="notice">No hay horarios disponibles en esta fecha. Prueba otro día.</div>';
    document.querySelector("#reserve-button").disabled = !slots.length;
  } catch (e) {
    area.textContent = e.message;
    document.querySelector("#reserve-button").disabled = true;
  }
}
function booking() {
  main.innerHTML = `<div class="portal-intro"><div><h1>Tu momento de bienestar.</h1><p>Elige un tratamiento y reserva un horario disponible en ${esc(cfg.name)}.</p></div><div class="portal-location"><strong>Los Olivos, Lima</strong><p>${esc(cfg.open)} a ${esc(cfg.close)}</p><p>${esc(cfg.address)}</p></div></div>${!cfg.publicBooking ? '<div class="empty">Las reservas en línea están temporalmente desactivadas.</div>' : `<div class="booking-grid"><section class="panel"><h2>Reserva tu sesión</h2><form id="booking-form" class="stack"><label>Tratamiento<select name="service">${cfg.services.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} · ${s.duration} minutos</option>`).join("")}</select></label><label>Fecha<input name="date" type="date" min="${localDate()}" value="${localDate()}" required></label><div id="slot-area"></div><label>Nombre y apellidos<input name="name" required autocomplete="name" maxlength="90"></label><label>Celular peruano<input name="contact" type="tel" required autocomplete="tel" placeholder="987 654 321" maxlength="18"></label><label class="inline-check"><input type="checkbox" name="consent" required> Autorizo el uso de mi nombre y celular para gestionar esta reserva y recibir sus confirmaciones o recordatorios.</label><small>El personal autorizado del centro podrá consultar estos datos para atender tu cita. No incluyas información clínica.</small><p id="portal-error" class="form-error" role="alert"></p><button id="reserve-button" class="primary" type="submit">Reservar sesión</button></form></section><section class="booking-aside"><h2>Una reserva sin cruces.</h2><p>Los horarios se consultan en tiempo real y el equipo se bloquea al confirmar el registro.</p><h2>Control sobre tu cita.</h2><p>Al finalizar obtendrás un enlace privado para confirmar o cancelar. Guárdalo y no lo compartas.</p><h2>Si necesitas cambiar de horario.</h2><p>Cancela tu cita con el enlace y realiza una nueva reserva, o comunícate con el centro.</p>${cfg.phone ? `<a class="button" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(cfg.phone)}">Contactar al centro</a>` : ""}</section></div>`}`;
  if (cfg.publicBooking) updateSlots();
}
async function manage() {
  const { appointment: a } = await api(
    "/api/public/manage?" + new URLSearchParams({ id: manageId, token }),
  );
  main.innerHTML = `<section class="auth-card"><div class="auth-mark">Tu cita en ${esc(cfg.name)}</div><h1>${esc(a.status)}</h1><p>Hola, ${esc(a.name)}.</p><dl class="details"><dt>Tratamiento</dt><dd>${esc(a.service)}</dd><dt>Fecha</dt><dd>${esc(a.date)}</dd><dt>Hora · Perú</dt><dd>${esc(a.time)}</dd><dt>Duración</dt><dd>${a.duration} min</dd></dl><p id="portal-error" class="form-error" role="alert"></p>${["Pendiente", "Confirmada"].includes(a.status) ? `<div class="dialog-actions"><button id="cancel-booking">Cancelar cita</button><button id="confirm-booking" class="primary">Confirmar asistencia</button></div><p id="cancel-warning" class="muted"></p>` : "<p>Para otra sesión, realiza una nueva reserva.</p>"}<a class="portal-link" href="reservar">Reservar otra sesión</a></section>`;
}
document.addEventListener("change", (e) => {
  if (e.target.name === "date" || e.target.name === "service") updateSlots();
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "booking-form") return;
  e.preventDefault();
  const f = e.target,
    button = document.querySelector("#reserve-button");
  button.disabled = true;
  message("");
  try {
    const s = slots[Number(f.elements.slot?.value)];
    if (!s) throw Error("Selecciona un horario disponible.");
    const r = await api("/api/public/book", {
      method: "POST",
      body: {
        name: f.elements.name.value,
        contact: f.elements.contact.value,
        date: f.elements.date.value,
        service: f.elements.service.value,
        ...s,
        consent: f.elements.consent.checked,
      },
    });
    const link = new URL("/reservar", location.origin);
    link.searchParams.set("cita", r.appointment.id);
    link.searchParams.set("token", r.token);
    main.innerHTML = `<section class="auth-card"><div class="auth-mark">Reserva registrada</div><h1>Te esperamos.</h1><p>${esc(r.appointment.service)} · ${esc(r.appointment.date)} · ${esc(r.appointment.time)}</p><p>Tu cita quedó pendiente de confirmación. Guarda este enlace privado para confirmar o cancelar:</p><a class="button primary portal-link" href="${esc(link.toString())}">Administrar mi cita</a><p>La reserva está guardada aunque todavía no hayas recibido un mensaje de WhatsApp.</p></section>`;
  } catch (e) {
    message(e.message);
    button.disabled = false;
  }
});
let cancelArmed = false;
document.addEventListener("click", async (e) => {
  if (!["confirm-booking", "cancel-booking"].includes(e.target.id)) return;
  if (e.target.id === "cancel-booking" && !cancelArmed) {
    cancelArmed = true;
    document.querySelector("#cancel-warning").textContent =
      "Pulsa «Cancelar cita» de nuevo para confirmar la cancelación.";
    return;
  }
  e.target.disabled = true;
  try {
    await api(
      "/api/public/manage?" + new URLSearchParams({ id: manageId, token }),
      {
        method: "POST",
        body: {
          status: e.target.id === "cancel-booking" ? "Cancelada" : "Confirmada",
        },
      },
    );
    cancelArmed = false;
    await manage();
  } catch (e) {
    message(e.message);
    e.target.disabled = false;
  }
});
try {
  cfg = (await api("/api/public/config")).config;
  document.title = cfg.name + " · Reservas";
  if (manageId && token) await manage();
  else booking();
} catch (e) {
  main.innerHTML = `<section class="empty"><h1>No se pudo abrir la reserva</h1><p>${esc(e.message)}</p><a class="button" href="reservar">Volver a reservas</a></section>`;
}
