/**
 * Módulo de documentación: Integración por API y eventos variables.
 */
(function () {
  const BASE = window.location.origin;
  const t = (key, vars) => (window.I18n ? I18n.t(key, vars) : key);

  const SECTION_IDS = ["concepto", "auth", "paso0", "paso1", "paso2", "paso3", "curl", "ref"];

  function sectionHtml(id) {
    const key = `integration.html.${id}`;
    let html = t(key);
    if (html === key) return "";
    if (id === "auth") html = html.replace(/\{base\}/g, BASE);
    return html;
  }

  function buildSections() {
    return SECTION_IDS.map((id) => ({
      id,
      title: t(`integration.sections.${id}`),
      html: sectionHtml(id),
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
