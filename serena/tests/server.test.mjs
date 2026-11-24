import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../lib/store.mjs";
import { createApp } from "../server.mjs";
import {
  audit,
  verifyAudit,
  bookingToken,
  saveAppointment,
  defaults,
  canonical,
} from "../lib/core.mjs";
import { validSignature } from "../lib/providers.mjs";
import crypto from "node:crypto";

test("API: acceso, roles, concurrencia, pretest, privacidad, cancelación y auditoría", async () => {
  const store = await createStore({ url: null, filename: ":memory:" }),
    secret = "test-secret",
    app = await createApp({ store, secret, background: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "";
  const call = async (path, body, { auth = true, csrf = true } = {}) => {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-Kawsay": "1" } : {}),
        ...(auth ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  try {
    assert.equal((await call("/api/state")).status, 401);
    assert.equal(
      (
        await call(
          "/api/auth/setup",
          {
            name: "Prueba",
            email: "test@example.com",
            password: "contraseña-de-prueba",
          },
          { csrf: false },
        )
      ).status,
      403,
    );
    const setup = await call("/api/auth/setup", {
      name: "Prueba",
      email: "test@example.com",
      password: "contraseña-de-prueba",
    });
    assert.equal(setup.status, 201);
    assert.equal(setup.data.user.password, undefined);
    cookie = setup.headers.get("set-cookie").split(";")[0];
    assert.ok(cookie.startsWith("kawsay_session="));
    assert.equal(
      (
        await call("/api/auth/setup", {
          name: "Otra",
          email: "otra@example.com",
          password: "contraseña-de-prueba",
        })
      ).status,
      409,
    );
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      a = {
        name: "Cliente de prueba",
        contact: "987654321",
        date,
        time: "10:00",
        duration: 30,
        service: "Masaje térmico",
        equipment: defaults.equipment[0],
        status: "Pendiente",
        phase: "post",
        consent: true,
        followup: true,
      };
    const created = await Promise.all([
      call("/api/appointments", a),
      call("/api/appointments", { ...a, name: "Segundo cliente" }),
    ]);
    assert.deepEqual(created.map((r) => r.status).sort(), [201, 409]);
    const one = created.find((r) => r.status === 201).data.appointment;
    const state = (await call("/api/state")).data;
    assert.equal(state.rows.length, 1);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.rows[0].contact, "51987654321");
    const change = await call("/api/appointments", {
      ...one,
      status: "Confirmada",
    });
    assert.equal(change.status, 200);
    assert.equal(
      (await call("/api/appointments", { ...one, status: "Cancelada" })).status,
      409,
    );
    assert.equal(
      (
        await call("/api/public/manage?id=" + one.id + "&token=bad", null, {
          auth: false,
        })
      ).status,
      404,
    );
    const publicAttempt = await call(
      "/api/public/book",
      { ...a, id: one.id, version: 2, name: "No puede sobrescribir" },
      { auth: false },
    );
    assert.equal(publicAttempt.status, 409);
    const cancel = await call(
      "/api/public/manage?" +
        new URLSearchParams({ id: one.id, token: bookingToken(one, secret) }),
      { status: "Cancelada" },
      { auth: false },
    );
    assert.equal(cancel.status, 200);
    assert.equal(
      (
        await call(
          "/api/public/book",
          { ...a, name: "Reserva portal" },
          { auth: false },
        )
      ).status,
      201,
    );
    const pre = {
      ...a,
      date: "2026-01-01",
      phase: "pre",
      consent: false,
      duplicate: true,
      error: true,
      status: "No asistió",
    };
    assert.equal((await call("/api/appointments", pre)).status, 201);
    assert.equal((await call("/api/appointments", pre)).status, 201);
    const result = (await call("/api/report")).data.report;
    assert.equal(result.pre.duplicates, 2);
    assert.equal(result.pre.absenceRate, 100);
    assert.equal(result.post.absenceRate, null);
    assert.equal((await call("/api/audit/verify")).data.valid, true);
    const history = await store.all("audit");
    await assert.rejects(() =>
      store.put("audit", { ...history[0], action: "Alterado" }),
    );
    assert.equal(
      (
        await call("/api/users", {
          name: "Consulta",
          email: "viewer@example.com",
          password: "contraseña-de-prueba",
          role: "viewer",
        })
      ).status,
      201,
    );
    const login = await call("/api/auth/login", {
      email: "viewer@example.com",
      password: "contraseña-de-prueba",
    });
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("/api/state")).status, 200);
    assert.equal((await call("/api/appointments", a)).status, 403);
    assert.equal((await call("/api/backup")).status, 403);
  } finally {
    await app.close();
  }
});
test("firma canónica resiste cambios en orden de claves y detecta manipulación", async () => {
  const db = await createStore({ url: null, filename: ":memory:" });
  try {
    await audit(db, "key", null, "Prueba", { z: 1, a: { b: 2, a: 1 } });
    assert.equal((await verifyAudit(db, "key")).valid, true);
    assert.equal((await verifyAudit(db, "otra")).valid, false);
    assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  } finally {
    await db.close();
  }
});
test("verifica firma original del webhook y rechaza cuerpos o firmas distintos", () => {
  const raw = Buffer.from('{"a":1}'),
    secret = "meta-secret",
    signature =
      "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(validSignature(raw, signature, secret), true);
  assert.equal(validSignature(Buffer.from("{}"), signature, secret), false);
  assert.equal(validSignature(raw, signature, ""), false);
  assert.equal(validSignature(raw, "sha256=x", secret), false);
});
