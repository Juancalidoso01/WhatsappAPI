/**
 * Módulo de documentación: Integración por API y eventos variables.
 */
(function () {
  const BASE = window.location.origin;
  const t = (key, vars) => (window.I18n ? I18n.t(key, vars) : key);

  const SECTION_IDS = ["concepto", "auth", "paso0", "paso1", "paso2", "paso3", "curl", "ref"];

  const SECTION_HTML = {
    concepto: `
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
    auth: `
        <p>Configura en el servidor la variable de entorno <code>INTEGRATION_API_KEY</code> y envía el header en cada petición:</p>
        <pre class="api-code">X-API-Key: tu_clave_secreta</pre>
        <p class="muted">También: <code>Authorization: Bearer tu_clave_secreta</code>. Sin clave configurada, los endpoints quedan abiertos (solo desarrollo).</p>
        <p><strong>Base URL:</strong> <code id="apiBaseUrl">${BASE}</code></p>`,
    paso0: `
        <p>Consulta qué claves debes enviar para cada placeholder antes de integrar.</p>
        <pre class="api-code">GET /api/integrations/templates/{nombre}/variables?language=es
X-API-Key: {clave}</pre>
        <p>Respuesta: array <code>eventVariables</code> con <code>key</code> (nombre para tu JSON), <code>placeholder</code> (<code>{{1}}</code>…), <code>index</code> y si es <code>required</code>.</p>
        <div id="apiLiveSchema" class="api-live-box muted"></div>`,
    paso1: `
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
    paso2: `
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
    }
  ]
}</pre>
        <p>Las claves en <code>variables</code> deben coincidir con <code>eventVariables[].key</code> del paso 0.</p>`,
    paso3: `
        <pre class="api-code">POST /api/integrations/campaigns/{campaign_id}/start
X-API-Key: {clave}</pre>
        <p>Solo funciona si <code>totals.awaiting_vars === 0</code>.</p>
        <pre class="api-code">GET /api/integrations/campaigns/{campaign_id}
X-API-Key: {clave}</pre>`,
    curl: `<pre class="api-code" id="apiCurlExample"></pre>`,
    ref: `
        <table class="api-ref-table">
          <thead><tr><th>Método</th><th>Ruta</th><th>Uso</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td><code>/api/integrations/templates/:name/variables</code></td><td>Esquema de variables</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns</code></td><td>Crear campaña</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns/:id/events</code></td><td>Conectar variables</td></tr>
            <tr><td>POST</td><td><code>/api/integrations/campaigns/:id/start</code></td><td>Iniciar envío</td></tr>
            <tr><td>GET</td><td><code>/api/integrations/campaigns/:id</code></td><td>Estado y progreso</td></tr>
          </tbody>
        </table>
        <p class="muted">Documentación completa: <code>docs/INTEGRACION_API.md</code></p>`,
  };

  function buildSections() {
    return SECTION_IDS.map((id) => ({
      id,
      title: t(`integration.sections.${id}`),
      html: SECTION_HTML[id] || "",
    }));
  }

  function renderGuide(root) {
    if (!root) return;
    root.dataset.rendered = "1";
    const sections = buildSections();
    root.innerHTML = `
      <header class="pane-header">
        <div>
          <h1 data-i18n="integration.title">${escapeHtml(t("integration.title"))}</h1>
          <p class="muted integration-intro" data-i18n="integration.intro">${escapeHtml(t("integration.intro"))}</p>
        </div>
      </header>
      <div class="integration-toolbar">
        <label><span data-i18n="integration.toolbar.liveSchema">${escapeHtml(t("integration.toolbar.liveSchema"))}</span>
          <select id="apiTplSelect"><option value="">${escapeHtml(t("integration.toolbar.noTemplate"))}</option></select>
        </label>
        <a class="btn-ghost sm" href="/docs/INTEGRACION_API.md" target="_blank" rel="noopener" data-i18n="integration.toolbar.downloadMd">${escapeHtml(t("integration.toolbar.downloadMd"))}</a>
      </div>
      <div class="integration-sections">
        ${sections.map((s) => `
          <article class="integration-section" id="api-${s.id}">
            <h2>${escapeHtml(s.title)}</h2>
            ${s.html}
          </article>
        `).join("")}
      </div>`;
    const liveBox = document.getElementById("apiLiveSchema");
    if (liveBox) {
      liveBox.textContent = t("integration.live.pickTemplate");
    }
    bindLiveSchema();
    renderCurlExample("recordatorio_pago", "es", [{ key: "monto" }, { key: "fecha" }]);
    if (window.I18n) I18n.applyDom(root);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderCurlExample(template, language, eventVariables) {
    const pre = document.getElementById("apiCurlExample");
    if (!pre) return;
    const keys = (eventVariables || []).map((e) => e.key);
    const varsObj = keys.reduce((o, k, i) => ({ ...o, [k]: i === 0 ? "150.00" : "30/03/2026" }), {});
    pre.textContent = `export BASE="${BASE}"
export KEY="tu_clave_secreta"

curl -s "$BASE/api/integrations/templates/${template}/variables?language=${language}" \\
  -H "X-API-Key: $KEY"

curl -s -X POST "$BASE/api/integrations/campaigns" \\
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Cobranza","template":"${template}","language":"${language}","recipients":[{"phone":"50761234567","externalId":"INV-1"}]}'

curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/events" \\
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"events":[{"externalId":"INV-1","variables":${JSON.stringify(varsObj)}}]}'

curl -s -X POST "$BASE/api/integrations/campaigns/CAMPAIGN_ID/start" \\
  -H "X-API-Key: $KEY"`;
  }

  async function bindLiveSchema() {
    const sel = document.getElementById("apiTplSelect");
    const box = document.getElementById("apiLiveSchema");
    if (!sel || !box) return;

    const templates = (window.__integrationTemplates || []).filter(
      (tpl) => (tpl.status || "").toLowerCase() === "approved"
    );
    sel.innerHTML = `<option value="">${escapeHtml(t("integration.toolbar.noTemplate"))}</option>` + templates
      .map((tpl) => `<option value="${tpl.name}" data-lang="${tpl.language}">${tpl.name} · ${tpl.language}</option>`)
      .join("");

    sel.onchange = async () => {
      const opt = sel.options[sel.selectedIndex];
      const name = sel.value;
      const lang = opt ? opt.dataset.lang : "es";
      if (!name) {
        box.className = "api-live-box muted";
        box.textContent = t("integration.live.selectForSchema");
        return;
      }
      box.textContent = t("integration.live.loading");
      try {
        const res = await fetch(`/api/templates/${encodeURIComponent(name)}/variables?language=${encodeURIComponent(lang)}`);
        const data = await res.json();
        if (!data.ok || !data.eventVariables || !data.eventVariables.length) {
          box.className = "api-live-box";
          box.innerHTML = `<strong>${escapeHtml(name)}</strong> — ${escapeHtml(t("integration.live.noVars"))}`;
          renderCurlExample(name, lang, []);
          return;
        }
        box.className = "api-live-box";
        box.innerHTML = `<strong>${escapeHtml(name)}</strong> (${data.language}) — ${data.eventVariables.length} ${escapeHtml(t("integration.live.varsCount"))}:<ul>${
          data.eventVariables.map((ev) =>
            `<li><code>${escapeHtml(ev.key)}</code> → <code>${escapeHtml(ev.placeholder)}</code>${ev.required ? ` · ${escapeHtml(t("integration.live.required"))}` : ""}</li>`
          ).join("")
        }</ul>`;
        renderCurlExample(name, lang, data.eventVariables);
      } catch (e) {
        box.className = "api-live-box error";
        box.textContent = t("integration.live.loadFailed");
      }
    };
  }

  function setTemplates(templates) {
    window.__integrationTemplates = templates || [];
    const root = document.getElementById("screenIntegration");
    if (root && root.dataset.rendered) {
      bindLiveSchema();
    } else if (root) {
      renderGuide(root);
    }
  }

  function init() {
    const root = document.getElementById("screenIntegration");
    if (root && !root.dataset.rendered) renderGuide(root);
  }

  window.IntegrationApiModule = { init, setTemplates, renderGuide };
})();
