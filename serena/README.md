# Kawsay Bienestar

Aplicación para el informe «Automatización robótica de procesos con inteligencia artificial cognitiva y gestión de riesgos en un centro de bienestar, Los Olivos, 2026».

## Ejecutar

Node.js 24 o posterior. Desde esta carpeta ejecuta `npm ci`, copia `.env.example` a `.env`, configura los servicios y ejecuta `npm start`. Abre http://127.0.0.1:4173 para crear la administración o iniciar sesión. Portal de clientes: `/reservar`.

Una vez creada la cuenta se cierra la instalación inicial. Contraseñas de 12 caracteres como mínimo, hash scrypt con sal aleatoria, sesiones HttpOnly/SameSite=Strict y cookie Secure en producción. Roles: administración, recepción y consulta.

Sin Supabase configurado, el desarrollo local usa SQLite en `data/`. Producción exige Supabase o PostgreSQL, evitando los discos efímeros de Render.

## Funcionalidad

- Reservas por equipo con validación transaccional. Dos solicitudes simultáneas no pueden ocupar el mismo equipo. Cancelaciones, reprogramaciones y asistencia; control de versiones para evitar sobrescribir cambios de otro usuario.
- Portal con disponibilidad, consentimiento y enlace privado para confirmar/cancelar. El token del enlace debe conservarse en privado.
- Registro individual de la agenda manual del pretest, incluidos errores y duplicados históricos.
- Agenda diaria, clientes, periodos antes/después y exportaciones CSV para Excel.
- Historial de solo anexado con firmas HMAC verificables. El propietario de la infraestructura conserva control técnico; no es una auditoría externa.
- Incidentes y mediciones con método de observación, segundos, media, desviación estándar y tamaño de muestra.
- Cola persistente de confirmaciones y recordatorios revisada cada 30 segundos por el servidor. Reporte diario del día anterior.
- Asistente real con Ollama para extraer fecha, hora y tratamiento. La recepción revisa la propuesta antes de crear una cita.
- Respaldo JSON de evidencia sin contraseñas, sesiones ni claves de servicios.

## Supabase

El adaptador recomendado usa la Data API sin compartir la contraseña administradora de PostgreSQL. Ejecuta `supabase/migrations/001_kawsay.sql` en tu proyecto. Crea el esquema privado `kawsay_private` con RLS y sin acceso directo para `anon` o `authenticated`. Solo una función RPC accede a los documentos mediante un secreto exclusivo del servidor.

Genera un secreto aleatorio largo para `KAWSAY_DB_SECRET`. Inserta **su hash SHA-256**, nunca el secreto original, en `kawsay_private.control(id,revision,secret_hash)` con id=1 y revision=0. Configura `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `KAWSAY_DB_SECRET` en el servidor. El secreto no se incluye en frontend ni GitHub.

La RPC aplica revisión y bloqueo transaccional; el adaptador reintenta conflictos. La RPC está revocada para visitantes y usuarios de Supabase Auth. El servidor la alcanza mediante la Edge Function `supabase/functions/kawsay-gateway/index.ts`, que valida el hash del secreto y usa la credencial de servicio interna de Supabase. Despliega esa función sustituyendo el marcador por el hash SHA-256 del secreto, o configura `KAWSAY_GATEWAY_SECRET_SHA256` en sus secretos. El JWT de plataforma queda desactivado porque la función realiza su propia autenticación; una llamada sin el secreto se rechaza antes de consultar la base. Usa documentos JSONB y carga colecciones completas para este piloto de una sucursal. Para grandes volúmenes se requiere paginar y normalizar.

Alternativa: `DATABASE_URL` de Supabase con pooler y TLS. Ese adaptador crea tablas `kawsay_*` con RLS. No mezcles adaptadores en un despliegue: usan estructuras separadas.

## Render

`render.yaml` de la raíz declara un Web Service con raíz `serena`, Node 24, `npm ci`, `npm start` y `/health`. Configura las variables de `.env.example` en Render. En producción se requieren secretos estables de auditoría e instalación. Si ya creaste tu cuenta local con la misma base Supabase, inicia sesión en Render con esa contraseña: no crees otra cuenta.

GitHub conserva el código; GitHub Pages no ejecuta este backend. El plan gratuito de Render puede suspenderse por inactividad y no garantiza la puntualidad de recordatorios. Operación continua requiere un servicio siempre activo o ejecutor independiente. No se contrató un plan pagado. `worker.mjs` ejecuta un ciclo; `/api/cron` lo dispara usando `CRON_SECRET`.

## Ollama local y Render

Modelo previsto: `qwen2.5:3b` (aproximadamente 1.9 GB). Descárgalo con `ollama pull qwen2.5:3b`.

En esta PC usa `AI_PROVIDER=ollama`. En Render configura `AI_PROVIDER=bridge` y el mismo `AI_BRIDGE_SECRET` en ambos entornos. Añade `RENDER_APP_URL` a `.env` con la URL de Render y ejecuta `node --env-file=.env ai-bridge.mjs`, o abre `iniciar-ia.cmd`.

El enlace hace consultas salientes; no publica el puerto de Ollama. La PC y Ollama deben estar encendidos para interpretar nuevas solicitudes. Si no están disponibles, la cola queda pendiente y el resto del sistema funciona. La página muestra la conexión reciente. La extracción puede equivocarse: revisa cada propuesta.

Existe un adaptador opcional OpenAI Responses con claves solo en servidor. No está activado ni se requiere para Ollama.

## WhatsApp

WhatsApp del celular: abre `wa.me` con el mensaje preparado y el personal realiza el envío. Abrir/copiar no se registra como entrega.

El envío automático está implementado para la **Cloud API oficial de Meta** y necesita número de API habilitado, token, app secret, verify token y plantilla aprobada. No funciona automáticamente con WhatsApp normal. Activa `WHATSAPP_ENABLED=true` solo al completar credenciales. Citas de demostración o sin consentimiento no generan mensajes. Cancelar o modificar invalida trabajos anteriores.

La plantilla `WHATSAPP_TEMPLATE`, en `WHATSAPP_LANGUAGE`, debe tener cinco parámetros en este orden: cliente, centro, fecha, hora y enlace privado. Ejemplo: «Hola {{1}}. {{2}} te recuerda tu cita del {{3}} a las {{4}}. Gestiona tu cita aquí: {{5}}». Nombre e idioma deben coincidir con lo aprobado por Meta.

Webhook: `https://TU-APP.onrender.com/webhooks/whatsapp`, con verificación y firma HMAC SHA-256 del cuerpo original. Aceptación de la API y entrega al cliente son estados distintos. La entrega depende del webhook. Fallos ambiguos de red quedan «Revisar», sin reintento automático que duplique mensajes.

La respuesta exacta «confirmo», «confirmar», «sí» o «si» confirma solo si hay una única cita pendiente del remitente. Otros mensajes se conservan para revisión.

## Evidencia de resultados

Comparación sin datos de demostración. Citas evaluadas excluyen canceladas. Inasistencia = No asistió / (Asistió + No asistió); excluye pendientes. Alinea la definición con la ficha validada.

Seguimiento completo es una marca operacional, no una certificación de seguridad. Cero incidentes registrados no demuestra ausencia de incidentes. Duplicados del pretest son observados; el postest impide nuevas superposiciones.

Cada tiempo observado conserva su método. Los tiempos automáticos de reportes miden procesamiento del servidor y excluyen red/trabajo humano; no los compares con un cronómetro del proceso completo sin igualar el instrumento. El sistema no inventa valores p ni prueba causalidad: el contraste inferencial requiere definir unidad de análisis y emparejamiento real.

## Validar

`npm test` y `npm run check`.

Pruebas de horarios, concurrencia, acceso, roles, sesiones, versiones, cancelación, privacidad de enlaces, pretest, denominadores, CSV, webhooks y auditoría. Los tests no suben datos ficticios a producción.

Documentación: [Supabase](https://supabase.com/docs/guides/api), [Render](https://render.com/docs/deploy-node-express-app), [Ollama](https://docs.ollama.com/api/chat), [WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
