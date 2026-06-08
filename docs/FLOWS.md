# WhatsApp Flows en Punto Pago

## ¿El número de prueba lo permite?

**En gran parte, sí**, con matices:

| Acción | Número de prueba Meta |
|--------|------------------------|
| Crear Flows (API / Manager) | ✅ Sí |
| Listar y previsualizar Flows | ✅ Sí |
| Enviar Flow en **borrador** (`mode: draft`) | ✅ Sí, en ventana 24 h |
| Enviar Flow **publicado** en chat activo | ✅ Normalmente sí |
| Plantilla masiva con botón FLOW | ⚠️ Requiere Flow publicado + plantilla aprobada |
| Sin error **139000 Integrity** | ⚠️ A veces falla si el negocio/nombre no está verificado |

### Recomendación para probar hoy

1. Abre **Flows** en el rail del portal.
2. Crea el sample **punto_pago_hello** (se publica automáticamente).
3. Inicia conversación con el número de prueba (mensaje entrante o simular entrante).
4. Envía el Flow al teléfono desde la pantalla Flows (ventana 24 h activa).
5. Completa el formulario en el teléfono → la respuesta aparece en **Respuestas recibidas**.

Si Meta responde `139000 Blocked by Integrity`, completa la verificación del negocio en [Meta Business Suite](https://business.facebook.com/) y usa Flow en **borrador** mientras tanto.

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/flows/capability` | Compatibilidad y notas |
| GET | `/api/flows` | Listar Flows del WABA |
| POST | `/api/flows` | Crear sample `hello` o `lead` |
| POST | `/api/flows/:id/send` | Enviar a un teléfono |
| POST | `/api/flows/:id/publish` | Publicar borrador |
| GET | `/api/flows/responses` | Respuestas del webhook |

## Webhook

Al completar un Flow, Meta envía `interactive.type = nfm_reply` con `response_json`. Punto Pago lo guarda y lo muestra en el módulo Flows.

## Fase 2 (pendiente)

- Endpoint `data_exchange` cifrado para Flows dinámicos
- Plantillas con botón FLOW desde el modal de crear plantilla
- Integración API para disparar Flows desde CRM
