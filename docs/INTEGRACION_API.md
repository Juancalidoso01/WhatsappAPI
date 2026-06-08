# Integración por API — Eventos variables

Esta guía explica cómo conectar sistemas externos (CRM, ERP, cobranza, etc.) con **Punto Pago** para enviar plantillas de WhatsApp con **variables dinámicas por destinatario**.

## Concepto: dos fases

Cada plantilla de Meta tiene placeholders (`{{1}}`, `{{2}}`, …). En Punto Pago esos placeholders se exponen como **eventos variables** con claves legibles (`monto`, `fecha`, `nombre_cliente`, etc.).

| Fase | Qué haces | Estado de la fila |
|------|-----------|-------------------|
| **1. Registro** | Creas la campaña y agregas destinatarios (teléfono, nombre, `externalId`) **sin** variables | `awaiting_vars` |
| **2. Eventos** | Tu sistema envía las variables por destinatario vía API | `ready` (completo) o `awaiting_vars` (incompleto) |
| **3. Envío** | Inicias la campaña; solo se envían filas con variables completas | `pending` → `sent` → `delivered` / `read` |

Esto permite que tu backend calcule o reciba los datos (monto adeudado, fecha de vencimiento, etc.) **después** de registrar al contacto, en el momento que los tengas.

---

## Autenticación

Configura en el servidor (Vercel / `.env`):

```env
INTEGRATION_API_KEY=tu_clave_secreta_larga
```

En cada petición incluye el header:

```http
X-API-Key: tu_clave_secreta_larga
```

También se acepta `Authorization: Bearer tu_clave_secreta_larga`.

> Si `INTEGRATION_API_KEY` no está configurada, los endpoints de integración quedan abiertos (solo recomendado en desarrollo local).

**Base URL de producción:** `https://whatsapp-api-ten-tau.vercel.app`

---

## Paso 0 — Consultar el esquema de variables de una plantilla

Antes de integrar, obtén qué claves debes enviar para cada placeholder de la plantilla.

```http
GET /api/integrations/templates/{nombre_plantilla}/variables?language=es
X-API-Key: {tu_clave}
```

**Respuesta de ejemplo:**

```json
{
  "ok": true,
  "template": "recordatorio_pago",
  "language": "es",
  "category": "UTILITY",
  "eventVariables": [
    {
      "key": "monto",
      "index": 0,
      "component": "body",
      "placeholder": "{{1}}",
      "label": "Variable cuerpo {{1}}",
      "required": true
    },
    {
      "key": "fecha",
      "index": 1,
      "component": "body",
      "placeholder": "{{2}}",
      "label": "Variable cuerpo {{2}}",
      "required": true
    }
  ]
}
```

**Cómo se mapean las claves**

| Campo | Significado |
|-------|-------------|
| `key` | Nombre que usarás en `variables` al inyectar eventos |
| `index` | Posición interna (orden en el array enviado a Meta) |
| `placeholder` | Placeholder original en la plantilla (`{{1}}`, `{{2}}`) |
| `component` | `body` o `header` (texto) |

Puedes definir claves personalizadas al crear la campaña con el array `eventVariables` o `variableKeys` (ver paso 1).

---

## Paso 1 — Crear campaña con destinatarios (sin variables)

```http
POST /api/integrations/campaigns
Content-Type: application/json
X-API-Key: {tu_clave}
```

**Cuerpo:**

```json
{
  "name": "Recordatorios marzo 2026",
  "template": "recordatorio_pago",
  "language": "es",
  "recipients": [
    {
      "phone": "50761234567",
      "name": "Juan Pérez",
      "externalId": "cliente-001"
    },
    {
      "phone": "50769876543",
      "name": "Ana López",
      "externalId": "cliente-002"
    }
  ]
}
```

**Respuesta (201):**

```json
{
  "ok": true,
  "campaign": {
    "id": "cmp_1740000000_abc123",
    "status": "draft",
    "source": "api",
    "eventVariables": [ "... esquema ..." ],
    "totals": {
      "total": 2,
      "awaiting_vars": 2,
      "ready": 0,
      "pending": 0
    }
  },
  "nextStep": "POST /api/integrations/campaigns/cmp_.../events con las variables por destinatario."
}
```

Guarda `campaign.id` y usa `externalId` en tu sistema para correlacionar cada envío.

### Claves de variables personalizadas (opcional)

Si quieres nombres distintos a los auto-generados (`body_1`, `body_2`):

```json
{
  "template": "recordatorio_pago",
  "language": "es",
  "variableKeys": ["monto", "fecha"],
  "recipients": [ ... ]
}
```

O con etiquetas:

```json
{
  "eventVariables": [
    { "key": "monto", "label": "Monto adeudado" },
    { "key": "fecha", "label": "Fecha de vencimiento" }
  ],
  "recipients": [ ... ]
}
```

---

## Paso 2 — Inyectar eventos variables

Cuando tu sistema tenga los datos de cada cliente, envíalos en lote o uno a uno.

```http
POST /api/integrations/campaigns/{campaign_id}/events
Content-Type: application/json
X-API-Key: {tu_clave}
```

**Cuerpo:**

```json
{
  "events": [
    {
      "externalId": "cliente-001",
      "variables": {
        "monto": "125.50",
        "fecha": "15/03/2026"
      }
    },
    {
      "phone": "50769876543",
      "variables": {
        "monto": "89.00",
        "fecha": "20/03/2026"
      }
    }
  ]
}
```

**Identificación del destinatario** (usa uno de los dos):

- `externalId` — recomendado; ID de tu CRM/ERP
- `phone` — número sin `+`, solo dígitos (ej. `50761234567`)

**Respuesta:**

```json
{
  "ok": true,
  "results": [
    {
      "phone": "50761234567",
      "externalId": "cliente-001",
      "ok": true,
      "status": "ready",
      "complete": true
    },
    {
      "phone": "50769876543",
      "externalId": "cliente-002",
      "ok": true,
      "status": "ready",
      "complete": true
    }
  ],
  "campaign": {
    "totals": {
      "awaiting_vars": 0,
      "ready": 2,
      "pending": 0
    },
    "progress": {
      "varsPercent": 100
    }
  }
}
```

| `status` tras el evento | Significado |
|-------------------------|-------------|
| `ready` | Todas las variables requeridas están completas |
| `awaiting_vars` | Faltan una o más variables obligatorias |

Puedes llamar a `/events` varias veces (actualización parcial) hasta completar cada fila.

### Agregar más destinatarios después

```http
POST /api/integrations/campaigns/{campaign_id}/recipients
```

```json
{
  "recipients": [
    { "phone": "50765551234", "name": "Carlos", "externalId": "cliente-003" }
  ]
}
```

Los nuevos contactos quedan en `awaiting_vars` hasta que envíes sus eventos.

---

## Paso 3 — Iniciar el envío

Solo cuando `totals.awaiting_vars` sea **0**:

```http
POST /api/integrations/campaigns/{campaign_id}/start
X-API-Key: {tu_clave}
```

**Errores comunes:**

| Error | Causa |
|-------|-------|
| `N destinatario(s) aún sin variables completas` | Hay filas en `awaiting_vars` |
| `Plantilla no disponible o no aprobada` | La plantilla no está `APPROVED` en Meta |
| `401 API key inválida` | Falta o incorrecto `X-API-Key` |

---

## Paso 4 — Monitorear progreso

```http
GET /api/integrations/campaigns/{campaign_id}
X-API-Key: {tu_clave}
```

La respuesta incluye:

- `totals` — contadores por estado
- `progress.percent` — % de mensajes enviados/procesados
- `progress.varsPercent` — % de destinatarios con variables completas
- `costEstimate` — estimación de costo según categoría de plantilla

También puedes usar la pantalla **Cargas masivas** en la interfaz web.

---

## Flujo recomendado para tu sistema

```
┌─────────────┐     GET /templates/:name/variables     ┌──────────────┐
│   Tu CRM    │ ──────────────────────────────────────►│  Punto Pago  │
└─────────────┘                                        └──────────────┘
       │
       │ 1. Clientes con deuda detectada
       ▼
 POST /integrations/campaigns  (recipients sin variables)
       │
       │ 2. Por cada cliente, cuando tengas monto/fecha
       ▼
 POST /integrations/campaigns/:id/events  (variables por externalId)
       │
       │ 3. Cuando todas las filas estén ready
       ▼
 POST /integrations/campaigns/:id/start
       │
       │ 4. Webhooks de Meta actualizan delivered/read
       ▼
 GET /integrations/campaigns/:id  (seguimiento)
```

---

## Ejemplo completo con cURL

```bash
export BASE="https://whatsapp-api-ten-tau.vercel.app"
export KEY="tu_clave_secreta"

# 1. Esquema
curl -s "$BASE/api/integrations/templates/recordatorio_pago/variables?language=es" \
  -H "X-API-Key: $KEY" | jq .

# 2. Crear campaña
curl -s -X POST "$BASE/api/integrations/campaigns" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Cobranza semanal",
    "template": "recordatorio_pago",
    "language": "es",
    "recipients": [
      { "phone": "50761234567", "name": "Juan", "externalId": "INV-1001" }
    ]
  }' | jq .

# 3. Inyectar variables (reemplaza CAMPAIGN_ID)
curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/events" \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "externalId": "INV-1001",
        "variables": { "monto": "150.00", "fecha": "30/03/2026" }
      }
    ]
  }' | jq .

# 4. Iniciar
curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/start" \
  -H "X-API-Key: $KEY" | jq .
```

---

## Endpoints de referencia

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/integrations/templates/:name/variables` | Esquema de eventos variables |
| `POST` | `/api/integrations/campaigns` | Crear campaña API |
| `POST` | `/api/integrations/campaigns/:id/recipients` | Agregar destinatarios |
| `POST` | `/api/integrations/campaigns/:id/events` | Inyectar variables |
| `POST` | `/api/integrations/campaigns/:id/start` | Iniciar envío |
| `GET` | `/api/integrations/campaigns/:id` | Estado y progreso |

Endpoints equivalentes sin autenticación (solo UI interna):

- `GET /api/templates/:name/variables`

---

## Notas importantes

1. **Ventana de 24 h:** Fuera de la ventana de servicio solo se pueden enviar plantillas aprobadas (este flujo ya las usa).
2. **Límite diario:** Meta limita usuarios únicos por 24 h según el tier de tu línea (`GET /api/line-health`).
3. **Plantillas multimedia:** Encabezados IMAGE/VIDEO/DOCUMENT no están soportados en cargas masivas (fase actual).
4. **CSV vs API:** El CSV sigue disponible con variables en el archivo; la API es para integración en dos fases.
5. **Reintentos:** Si un evento falla (`ok: false` en `results`), corrige el `externalId`/`phone` o agrega el destinatario con `/recipients`.
