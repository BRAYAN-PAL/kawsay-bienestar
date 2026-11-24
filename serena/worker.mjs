import { createStore, loadAuditSecret } from "./lib/store.mjs";
import { runAutomation } from "./lib/providers.mjs";
const db = await createStore();
try {
  await runAutomation(db, loadAuditSecret());
  console.log("Ciclo de automatización completado.");
} finally {
  await db.close();
}
