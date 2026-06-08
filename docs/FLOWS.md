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
| POST | `/api/flows` | Crear sample `hello`, `lead` o `quote` |
| POST | `/api/flows/:id/send` | Enviar a un teléfono |
| POST | `/api/flows/:id/publish` | Publicar borrador |
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
