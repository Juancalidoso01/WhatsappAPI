# WhatsApp Flows en Punto Pago

## ¿El número de prueba lo permite?

**En gran parte, sí**, con matices:

| Acción | Número de prueba Meta |
|--------|------------------------|
| Crear Flows (API / Manager) | ✅ Sí |
| Listar y previsualizar Flows | ✅ Sí |
| Enviar Flow en **borrador** (`mode: draft`) | ✅ Sí, en ventana 24 h |
| Enviar Flow **publicado** en chat activo | ✅ Normalmente sí |
| Flow dinámico con **endpoint** (`data_exchange`) | ✅ Sí, con `PUBLIC_BASE_URL` |
| Plantilla masiva con botón FLOW | ⚠️ Requiere Flow publicado + plantilla aprobada |
| Sin error **139000 Integrity** | ⚠️ A veces falla si el negocio/nombre no está verificado |

### Recomendación para probar hoy

1. Configura `PUBLIC_BASE_URL` (ej. `https://whatsapp-api-ten-tau.vercel.app`).
2. Abre **Flows** → **Registrar clave en Meta**.
3. Crea el sample **punto_pago_cotizacion** (Flow dinámico con endpoint).
4. Inicia conversación con el número de prueba (ventana 24 h).
5. Envía el Flow → elige producto y monto → el endpoint calcula la cuota.
6. Confirma → la respuesta aparece en **Respuestas recibidas**.

Si Meta responde `139000 Blocked by Integrity`, completa la verificación del negocio en [Meta Business Suite](https://business.facebook.com/) y usa Flow en **borrador** mientras tanto.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/flows/capability` | Compatibilidad y notas |
| GET | `/api/flows` | Listar Flows del WABA |
| POST | `/api/flows/build` | **Constructor:** crear Flow estático o dinámico desde Studio |

### Flows dinámicos desde Studio (P1)

En **Crea tu Flow**, activa **Flow dinámico** y elige un handler:

| Handler | Comportamiento |
|---------|----------------|
| `generic` | Eco de campos del formulario → pantalla resultado vía endpoint |
| `quote` | Lista producto + monto → calcula cuota (como sample cotización) |
| `booking` | Despliega estructura de reservas Punto Pago (calendario + horarios) |

Al crear, se registra `data_api_version: 4.0`, `endpoint_uri` y la clave pública en Meta (`PUBLIC_BASE_URL` obligatorio).

Los borradores dinámicos creados en Studio se pueden **editar** si la definición está guardada en Redis (`FlowStudioStore`).
| GET | `/api/flows/:id/studio` | Definición editable para el Flow Studio |
| PUT | `/api/flows/:id` | Actualizar borrador (`DRAFT`); dinámicos con definición en Studio |
| GET | `/api/flows/builder/schema` | Tipos de campo y categorías del constructor |
| POST | `/api/flows/:id/send` | Enviar a un teléfono |
| POST | `/api/flows/:id/publish` | Publicar borrador |
| GET | `/api/flows/:id/export-json` | Descargar flow.json desde Meta |
| POST | `/api/flows/studio/preview-json` | Generar JSON desde definición del Studio |
| POST | `/api/flows/studio/import-json` | Importar JSON a definición del Studio |
| GET | `/api/flows/responses` | Respuestas del webhook |
| POST | `/api/flows/endpoint` | Endpoint cifrado para Meta (`data_exchange`) |
| GET | `/api/flows/endpoint/setup` | Estado del endpoint y claves |
| POST | `/api/flows/endpoint/setup` | Subir clave pública a Meta |

## Endpoint dinámico

Meta envía peticiones cifradas (RSA-OAEP + AES-128-GCM) a `POST /api/flows/endpoint`. Punto Pago:

1. Descifra la petición con la clave privada.
2. Ejecuta la lógica (`ping`, `INIT`, `data_exchange`).
3. Responde cifrado en base64 (text/plain).

El sample **quote** implementa una cotización simple: producto + monto → cuota estimada a 12 meses.

## Facturación

En la pantalla **Facturación** verás métricas internas de Flows:

- **Flows enviados** — contador al enviar desde Punto Pago
- **Respuestas completadas** — cuando el usuario confirma el Flow
- **Llamadas al endpoint** — pings e intercambios `data_exchange`

Los Flows enviados **dentro de la ventana de 24 h** son mensajes interactivos de **servicio (gratis)**. Si abres la conversación con plantilla, se factura como la categoría de esa plantilla.

## Webhook

Al completar un Flow, Meta envía `interactive.type = nfm_reply` con `response_json`. Punto Pago lo guarda y lo muestra en el módulo Flows.
