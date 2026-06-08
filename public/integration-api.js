/**
 * Módulo de documentación: Integración por API y eventos variables.
 * Pantalla independiente accesible desde el rail de navegación.
 */
(function () {
  const BASE = window.location.origin;

  const SECTIONS = [
    {
      id: "concepto",
      title: "Concepto: integración en dos fases",
      html: `
        <p>Cada plantilla de WhatsApp tiene placeholders (<code>{{1}}</code>, <code>{{2}}</code>…). Punto Pago los expone como <strong>eventos variables</strong> con claves legibles (<code>monto</code>, <code>fecha</code>, etc.).</p>
        <table class="api-ref-table">
          <thead><tr><th>Fase</th><th>Acción</th><th>Estado de fila</th></tr></thead>
          <tbody>
            <tr><td>1. Registro</td><td>Crear campaña + destinatarios <em>sin</em> variables</td><td><code>awaiting_vars</code></td></tr>
            <tr><td>2. Eventos</td><td>Tu sistema envía variables por contacto</td><td><code>ready</code> o <code>awaiting_vars</code></td></tr>
            <tr><td>3. Envío</td><td>Iniciar campaña (solo filas completas)</td><td><code>pending</code> → <code>sent</code> → <code>delivered</code></td></tr>
          </tbody>
        </table>
        <p class="muted">Esto permite registrar contactos primero y conectar las variables cuando tu CRM/ERP las calcule o las reciba.</p>`,
    },
    {
      id: "auth",
      title: "Autenticación",
      html: `
        <p>Configura en el servidor la variable de entorno <code>INTEGRATION_API_KEY</code> y envía el header en cada petición:</p>
        <pre class="api-code">X-API-Key: tu_clave_secreta</pre>
        <p class="muted">También: <code>Authorization: Bearer tu_clave_secreta</code>. Sin clave configurada, los endpoints quedan abiertos (solo desarrollo).</p>
        <p><strong>Base URL:</strong> <code id="apiBaseUrl">${BASE}</code></p>`,
    },
    {
      id: "paso0",
      title: "Paso 0 — Esquema de variables por plantilla",
      html: `
        <p>Consulta qué claves debes enviar para cada placeholder antes de integrar.</p>
        <pre class="api-code">GET /api/integrations/templates/{nombre}/variables?language=es
X-API-Key: {clave}</pre>
        <p>Respuesta: array <code>eventVariables</code> con <code>key</code> (nombre para tu JSON), <code>placeholder</code> (<code>{{1}}</code>…), <code>index</code> y si es <code>required</code>.</p>
        <div id="apiLiveSchema" class="api-live-box muted">Selecciona una plantilla abajo para ver su esquema en vivo.</div>`,
    },
    {
      id: "paso1",
      title: "Paso 1 — Crear campaña (destinatarios sin variables)",
      html: `
        <pre class="api-code">POST /api/integrations/campaigns
Content-Type: application/json
X-API-Key: {clave}</pre>
        <pre class="api-code">{
  "name": "Recordatorios marzo",
  "template": "recordatorio_pago",
  "language": "es",
  "recipients": [
    {
      "phone": "50761234567",
      "name": "Juan Pérez",
      "externalId": "cliente-001"
    }
  ]
}</pre>
        <p>Guarda <code>campaign.id</code>. Usa <code>externalId</code> para correlacionar con tu sistema. Opcional: <code>variableKeys: ["monto","fecha"]</code> para nombrar las claves.</p>`,
    },
    {
      id: "paso2",
      title: "Paso 2 — Conectar variables (eventos)",
      html: `
        <p>Cuando tengas los datos de cada cliente, inyéctalos. Identifica por <code>externalId</code> (recomendado) o <code>phone</code>.</p>
        <pre class="api-code">POST /api/integrations/campaigns/{campaign_id}/events
Content-Type: application/json
X-API-Key: {clave}</pre>
        <pre class="api-code">{
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
}</pre>
        <p>Las claves en <code>variables</code> deben coincidir con <code>eventVariables[].key</code> del paso 0. Puedes llamar varias veces hasta completar cada fila.</p>
        <table class="api-ref-table">
          <thead><tr><th>status</th><th>Significado</th></tr></thead>
          <tbody>
            <tr><td><code>ready</code></td><td>Variables completas, listo para enviar</td></tr>
            <tr><td><code>awaiting_vars</code></td><td>Faltan variables obligatorias</td></tr>
          </tbody>
        </table>`,
    },
    {
      id: "paso3",
      title: "Paso 3 — Iniciar envío y monitorear",
      html: `
        <pre class="api-code">POST /api/integrations/campaigns/{campaign_id}/start
X-API-Key: {clave}</pre>
        <p>Solo funciona si <code>totals.awaiting_vars === 0</code>. Para seguimiento:</p>
        <pre class="api-code">GET /api/integrations/campaigns/{campaign_id}
X-API-Key: {clave}</pre>
        <p>La respuesta incluye <code>progress.percent</code>, <code>progress.varsPercent</code> y <code>costEstimate</code>.</p>
        <p>Agregar destinatarios después: <code>POST .../recipients</code> con el mismo formato que en el paso 1.</p>`,
    },
    {
      id: "curl",
      title: "Ejemplo cURL completo",
      html: `<pre class="api-code" id="apiCurlExample"></pre>`,
    },
    {
      id: "ref",
      title: "Referencia de endpoints",
      html: `
        <table class="api-ref-table">
          <thead><tr><th>Método</th><th>Ruta</th><th>Uso</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/api/integrations/templates/:name/variables</code></td><td>Esquema de variables</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns</code></td><td>Crear campaña</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns/:id/recipients</code></td><td>Agregar contactos</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns/:id/events</code></td><td>Conectar variables</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns/:id/start</code></td><td>Iniciar envío</td></tr>
            <tr><td>GET</td><td><code>/api/integrations/campaigns/:id</code></td><td>Estado y progreso</td></tr>
          </tbody>
        </table>
        <p class="muted">Documentación completa en el repositorio: <code>docs/INTEGRACION_API.md</code></p>`,
    },
  ];

  function renderGuide(root) {
    if (!root) return;
    root.innerHTML = `
      <header class="pane-header">
        <div>
          <h1>Integración API</h1>
          <p class="muted integration-intro">Guía para conectar tu sistema con cargas masivas y <strong>eventos variables</strong> en dos fases.</p>
        </div>
      </header>
      <div class="integration-toolbar">
        <label>Probar esquema en vivo
          <select id="apiTplSelect"><option value="">— plantilla aprobada —</option></select>
        </label>
        <a class="btn-ghost sm" href="/docs/INTEGRACION_API.md" target="_blank" rel="noopener">Descargar MD</a>
      </div>
      <div class="integration-sections">
        ${SECTIONS.map((s) => `
          <article class="integration-section" id="api-${s.id}">
            <h2>${s.title}</h2>
            ${s.html}
          </article>
        `).join("")}
      </div>`;
    bindLiveSchema();
    renderCurlExample("recordatorio_pago", "es", [
      { key: "monto" },
      { key: "fecha" },
    ]);
  }

  function renderCurlExample(template, language, eventVariables) {
    const pre = document.getElementById("apiCurlExample");
    if (!pre) return;
    const keys = (eventVariables || []).map((e) => e.key);
    const varsObj = keys.reduce((o, k, i) => ({ ...o, [k]: i === 0 ? "150.00" : "30/03/2026" }), {});
    pre.textContent = `export BASE="${BASE}"
export KEY="tu_clave_secreta"

# 0. Esquema de variables
curl -s "$BASE/api/integrations/templates/${template}/variables?language=${language}" \\
  -H "X-API-Key: $KEY"

# 1. Crear campaña (sin variables)
curl -s -X POST "$BASE/api/integrations/campaigns" \\
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{
  "name": "Cobranza semanal",
  "template": "${template}",
  "language": "${language}",
  "recipients": [
    { "phone": "50761234567", "name": "Juan", "externalId": "INV-1001" }
  ]
}'

# 2. Conectar variables
curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/events" \\
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{
  "events": [
    { "externalId": "INV-1001", "variables": ${JSON.stringify(varsObj)} }
  ]
}'

# 3. Iniciar envío
curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/start" \\
  -H "X-API-Key: $KEY"`;
  }

  async function bindLiveSchema() {
    const sel = document.getElementById("apiTplSelect");
    const box = document.getElementById("apiLiveSchema");
    if (!sel || !box) return;

    const templates = (window.__integrationTemplates || []).filter(
      (t) => (t.status || "").toLowerCase() === "approved"
    );
    sel.innerHTML = `<option value="">— plantilla aprobada —</option>` + templates
      .map((t) => `<option value="${t.name}" data-lang="${t.language}">${t.name} · ${t.language}</option>`)
      .join("");

    sel.addEventListener("change", async () => {
      const opt = sel.options[sel.selectedIndex];
      const name = sel.value;
      const lang = opt ? opt.dataset.lang : "es";
      if (!name) {
        box.className = "api-live-box muted";
        box.textContent = "Selecciona una plantilla para ver su esquema en vivo.";
        return;
      }
      box.textContent = "Cargando esquema…";
      try {
        const res = await fetch(`/api/templates/${encodeURIComponent(name)}/variables?language=${encodeURIComponent(lang)}`);
        const data = await res.json();
        if (!data.ok || !data.eventVariables || !data.eventVariables.length) {
          box.className = "api-live-box";
          box.innerHTML = `<strong>${name}</strong> — sin variables requeridas.`;
          renderCurlExample(name, lang, []);
          return;
        }
        box.className = "api-live-box";
        box.innerHTML = `<strong>${name}</strong> (${data.language}) — ${data.eventVariables.length} variable(s):<ul>${
          data.eventVariables.map((ev) =>
            `<li><code>${ev.key}</code> → placeholder <code>${ev.placeholder}</code> (${ev.component})${ev.required ? " · obligatorio" : ""}</li>`
          ).join("")
        }</ul>`;
        renderCurlExample(name, lang, data.eventVariables);
      } catch (e) {
        box.className = "api-live-box error";
        box.textContent = "No se pudo cargar el esquema.";
      }
    });
  }

  function setTemplates(templates) {
    window.__integrationTemplates = templates || [];
    const root = document.getElementById("screenIntegration");
    if (root && !root.dataset.rendered) {
      root.dataset.rendered = "1";
      renderGuide(root);
    } else if (root && root.dataset.rendered) {
      bindLiveSchema();
    }
  }

  function init() {
    const root = document.getElementById("screenIntegration");
    if (root && !root.dataset.rendered) {
      root.dataset.rendered = "1";
      renderGuide(root);
    }
  }

  window.IntegrationApiModule = { init, setTemplates, renderGuide };
})();
