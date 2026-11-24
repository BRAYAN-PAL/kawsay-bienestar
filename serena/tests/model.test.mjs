import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, metrics, toCSV } from "../dist/model.js";
const base = {
  id: "1",
  name: "Prueba",
  contact: "prueba@example.com",
  date: "2026-11-23",
  time: "09:00",
  duration: 60,
  equipment: "Equipo térmico 1",
  phase: "post",
  status: "Confirmada",
  error: false,
  followup: true,
};
test("rechaza superposición y permite citas consecutivas, otros equipos y canceladas", () => {
  assert.match(
    validate({ ...base, id: "2", time: "09:30" }, [base]),
    /reservado/,
  );
  assert.equal(validate({ ...base, id: "2", time: "10:00" }, [base]), "");
  assert.equal(
    validate({ ...base, id: "2", equipment: "Equipo térmico 2" }, [base]),
    "",
  );
  assert.equal(validate({ ...base, id: "2", status: "Cancelada" }, [base]), "");
  assert.equal(validate({ ...base }, [base]), "");
});
test("valida fechas, duración y cierre", () => {
  assert.ok(validate({ ...base, date: "2026-02-30" }, []));
  assert.ok(validate({ ...base, duration: NaN }, []));
  assert.ok(validate({ ...base, time: "19:30" }, []));
  assert.equal(validate({ ...base, time: "19:00" }, []), "");
});
test("ausentismo usa solo citas resueltas y excluye canceladas", () => {
  const m = metrics([
    { ...base, status: "Asistió" },
    { ...base, status: "No asistió", error: true },
    { ...base, status: "Pendiente" },
    { ...base, status: "Cancelada", error: true },
  ]);
  assert.equal(m.total, 3);
  assert.equal(m.closed, 2);
  assert.equal(m.absenceRate, 50);
  assert.equal(m.errors, 1);
  assert.equal(m.traceRate, 100);
  assert.equal(metrics([]).absenceRate, null);
});
test("exportación escapa comillas y neutraliza fórmulas de Excel", () => {
  const csv = toCSV([["=1+1", 'María "M"', "hola;dos"]]);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"María ""M"""'));
  assert.ok(csv.includes('"hola;dos"'));
});
