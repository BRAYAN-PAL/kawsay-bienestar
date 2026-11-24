import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../lib/providers.mjs";
import { defaults } from "../lib/core.mjs";
test("NVIDIA: extracción estructurada, revisión humana y rechazo de límite y salida incompleta", async () => {
  const before = {
    provider: process.env.AI_PROVIDER,
    key: process.env.NVIDIA_API_KEY,
  };
  process.env.AI_PROVIDER = "nvidia";
  process.env.NVIDIA_API_KEY = "dummy-test-key";
  try {
    let sent;
    const result = await parseRequest(
      "Masaje térmico mañana a las 10",
      defaults,
      async (url, options) => {
        assert.equal(
          url,
          "https://integrate.api.nvidia.com/v1/chat/completions",
        );
        sent = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    intent: "reservar",
                    date: "2026-11-27",
                    time: "10:00",
                    service: "Masaje térmico",
                    duration: 30,
                    note: "Comentario no fundamentado",
                  }),
                },
              },
            ],
          }),
        };
      },
    );
    assert.equal(sent.chat_template_kwargs.enable_thinking, false);
    assert.equal(sent.response_format.type, "json_schema");
    assert.equal(result.time, "10:00");
    assert.equal(result.note.includes("Comentario"), false);
    await assert.rejects(
      () =>
        parseRequest("cita", defaults, async () => ({
          status: 429,
          ok: false,
        })),
      (e) => e.status === 429,
    );
    await assert.rejects(
      () =>
        parseRequest("cita", defaults, async () => ({
          status: 200,
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: "length", message: { content: "{}" } }],
          }),
        })),
      (e) => e.status === 502,
    );
  } finally {
    if (before.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = before.provider;
    if (before.key === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = before.key;
  }
});
