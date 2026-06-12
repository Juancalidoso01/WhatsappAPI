/**
 * Módulo UI: Automatización (reglas condicionales sobre mensajes entrantes).
 */
(function () {
  const t = (key, vars) => (window.I18n ? I18n.t(key, vars) : key);

  const CONDITION_OPTS = [
    "any",
    "contains",
    "equals",
    "starts_with",
    "message_type",
    "first_inbound",
  ];

  const ACTION_OPTS = [
    "reply_text",
    "reply_template",
    "reply_buttons",
    "archive",
    "add_note",
  ];

  const MSG_TYPES = [
    "text",
    "image",
    "audio",
    "video",
    "document",
    "location",
    "interactive",
    "reaction",
    "contacts",
    "sticker",
  ];

  const state = {
    rules: [],
    settings: { enabled: false },
    ai: null,
    log: [],
    aiFailed: [],
    aiResolutionLog: [],
    botEnabled: false,
    geminiConfigured: false,
    faqSiteUrl: "",
    templates: [],
    editingId: null,
    bound: false,
    activeTab: "rules",
    aiFormDirty: false,
    aiViewMounted: false,
    readiness: null,
    aiSaveTimer: null,
    aiSavePending: false,
  };

  function loadActiveTab() {
    try {
      const saved = sessionStorage.getItem("automationTab");
      if (saved === "ai" || saved === "rules") state.activeTab = saved;
    } catch (_) { /* ignore */ }
  }

  function saveActiveTab() {
    try {
      sessionStorage.setItem("automationTab", state.activeTab);
    } catch (_) { /* ignore */ }
  }

  function toastMsg(msg, type) {
    if (typeof window.toast === "function") window.toast(msg, type);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function $(id) {
    return document.getElementById(id);
  }

  function defaultAi() {
    return {
      enabled: false,
      fallbackEnabled: true,
      role: "Asistente virtual de Punto Pago",
      instructions: "",
      faqEnabled: true,
      faqAudience: "cliente",
      faqMaxArticles: 4,
      escalation: {
        keywords: ["agente", "humano", "persona"],
        onLowConfidence: true,
        confidenceThreshold: 0.45,
        maxRepliesPerChat: 8,
        handoffMessage: "Te conecto con un agente de nuestro equipo. En breve te atenderán.",
      },
      corrections: [],
      resolution: {
        feedbackEnabled: true,
        feedbackPrompt: "¿Te ayudó esta respuesta?",
        feedbackYes: "Sí, gracias",
        feedbackNo: "Necesito más ayuda",
        thankYouMessage: "¡Me alegra haberte ayudado! Si necesitas algo más, escríbenos.",
        archiveOnConfirmed: false,
        inactivityMinutes: 4,
        assumedResolutionEnabled: true,
      },
    };
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || res.statusText || "Error");
    }
    return data;
  }

  function condLabel(c) {
    if (!c) return "";
    const base = t(`automation.conditions.${c.type}`);
    if (c.type === "any" || c.type === "first_inbound") return base;
    if (c.type === "message_type") return `${base}: ${c.value}`;
    return `${base} «${c.value}»`;
  }

  function actionLabel(a) {
    if (!a) return "";
    const base = t(`automation.actions.${a.type}`);
    if (a.type === "reply_text") return `${base}: ${(a.text || "").slice(0, 40)}`;
    if (a.type === "reply_template") return `${base}: ${a.template} (${a.language || "es"})`;
    if (a.type === "reply_buttons") return `${base}: ${(a.body || "").slice(0, 30)}`;
    if (a.type === "add_note") return `${base}: ${(a.note || "").slice(0, 40)}`;
    if (a.type === "reply_ai") return base;
    return base;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return "";
    }
  }

  function emptyCondition() {
    return { type: "contains", value: "", caseInsensitive: true };
  }

  function emptyAction() {
    return { type: "reply_text", text: "" };
  }

  function renderRuleCard(rule) {
    const conds = (rule.conditions || []).map(condLabel).join(" · ");
    const acts = (rule.actions || []).map(actionLabel).join(" · ");
    return `
      <article class="automation-rule-card${rule.enabled ? "" : " is-disabled"}" data-rule-id="${esc(rule.id)}">
        <div class="automation-rule-head">
          <div>
            <h3>${esc(rule.name)}</h3>
            <p class="muted automation-rule-meta">
              ${rule.enabled ? esc(t("automation.rule.active")) : esc(t("automation.rule.paused"))}
              · ${esc(t("automation.rule.order"))} ${rule.order}
              ${rule.stopOnMatch ? ` · ${esc(t("automation.rule.stopOnMatch"))}` : ""}
            </p>
          </div>
          <div class="automation-rule-actions">
            <label class="automation-switch sm" title="${esc(t("automation.rule.toggle"))}">
              <input type="checkbox" class="rule-enable" data-id="${esc(rule.id)}" ${rule.enabled ? "checked" : ""} />
              <span></span>
            </label>
            <button type="button" class="btn-ghost sm rule-edit" data-id="${esc(rule.id)}">${esc(t("automation.rule.edit"))}</button>
            <button type="button" class="btn-ghost sm danger rule-delete" data-id="${esc(rule.id)}">${esc(t("automation.rule.delete"))}</button>
          </div>
        </div>
        <div class="automation-rule-body">
          <p><strong>${esc(t("automation.rule.if"))}</strong> ${esc(conds)}</p>
          <p><strong>${esc(t("automation.rule.then"))}</strong> ${esc(acts)}</p>
        </div>
      </article>`;
  }

  function renderLogRow(row) {
    const acts = (row.actions || [])
      .map((a) => (a.ok ? a.action || "ok" : a.skipped ? `⊘ ${a.reason}` : `✗ ${a.error || "err"}`))
      .join(", ");
    return `
      <li class="automation-log-item">
        <span class="automation-log-time">${esc(formatTime(row.at))}</span>
        <span class="automation-log-rule">${esc(row.ruleName || row.ruleId || "—")}</span>
        <span class="automation-log-phone">${esc(row.contactName || row.phone || "")}</span>
        <span class="automation-log-text muted">${esc((row.text || "").slice(0, 60))}</span>
        <span class="automation-log-acts">${esc(acts)}</span>
      </li>`;
  }

  function renderShell() {
    const root = document.getElementById("screenAutomation");
    if (!root) return;
    root.innerHTML = `
      <main class="automation-pane">
        <header class="pane-header">
          <div>
            <h1 data-i18n="automation.title">${esc(t("automation.title"))}</h1>
            <p class="muted" data-i18n="automation.intro">${esc(t("automation.intro"))}</p>
          </div>
          <div class="automation-header-actions">
            <button type="button" class="btn-primary" id="automationNewRule" data-i18n="automation.newRule">${esc(t("automation.newRule"))}</button>
          </div>
        </header>
        <div id="automationBotWarn" class="automation-banner hidden"></div>
        <nav class="automation-main-tabs" role="tablist">
          <button type="button" class="automation-main-tab active" data-auto-tab="rules" data-i18n="automation.tabs.rules">${esc(t("automation.tabs.rules"))}</button>
          <button type="button" class="automation-main-tab" data-auto-tab="ai" data-i18n="automation.tabs.ai">${esc(t("automation.tabs.ai"))}</button>
        </nav>
        <div id="automationRulesView" class="automation-grid">
          <section class="automation-rules-panel">
            <h2 data-i18n="automation.rulesTitle">${esc(t("automation.rulesTitle"))}</h2>
            <p class="muted sm" data-i18n="automation.rulesIntro">${esc(t("automation.rulesIntro"))}</p>
            <div id="automationRulesList" class="automation-rules-list"></div>
          </section>
          <section class="automation-log-panel">
            <h2 data-i18n="automation.logTitle">${esc(t("automation.logTitle"))}</h2>
            <ul id="automationLogList" class="automation-log-list"></ul>
          </section>
        </div>
        <div id="automationAiView" class="automation-ai-view hidden"></div>
      </main>
      <div id="automationEditor" class="automation-editor-overlay hidden" role="dialog" aria-modal="true">
        <div class="automation-editor-card">
          <header class="automation-editor-head">
            <h2 id="automationEditorTitle">${esc(t("automation.editor.new"))}</h2>
            <button type="button" class="btn-ghost sm" id="automationEditorClose">×</button>
          </header>
          <form id="automationEditorForm" class="automation-editor-form">
            <label>${esc(t("automation.editor.name"))}
              <input type="text" id="ruleName" maxlength="120" required />
            </label>
            <div class="automation-editor-row">
              <label class="automation-check">
                <input type="checkbox" id="ruleStopOnMatch" checked />
                ${esc(t("automation.editor.stopOnMatch"))}
              </label>
            </div>
            <fieldset class="automation-fieldset">
              <legend>${esc(t("automation.editor.conditions"))}</legend>
              <div id="ruleConditions"></div>
              <button type="button" class="btn-ghost sm" id="addCondition">${esc(t("automation.editor.addCondition"))}</button>
            </fieldset>
            <fieldset class="automation-fieldset">
              <legend>${esc(t("automation.editor.actions"))}</legend>
              <div id="ruleActions"></div>
              <button type="button" class="btn-ghost sm" id="addAction">${esc(t("automation.editor.addAction"))}</button>
            </fieldset>
            <footer class="automation-editor-foot">
              <button type="button" class="btn-ghost" id="automationEditorCancel">${esc(t("automation.editor.cancel"))}</button>
              <button type="submit" class="btn-primary">${esc(t("automation.editor.save"))}</button>
            </footer>
          </form>
        </div>
      </div>`;
    if (window.I18n) I18n.applyDom(root);
    bindShell();
    paint();
  }

  function updateAiEnabledUi(enabled) {
    const box = document.querySelector(".automation-ai-toggle-box");
    if (box) {
      box.classList.toggle("is-on", enabled);
      box.classList.toggle("is-off", !enabled);
    }
    const pill = document.querySelector(".automation-ai-status-pill");
    if (pill) {
      pill.textContent = t(enabled ? "automation.ai.statusOn" : "automation.ai.statusOff");
    }
    const inp = document.getElementById("aiEnabled");
    if (inp) inp.checked = enabled;
  }

  function applyAiSaveResponse(data) {
    if (data.ai) state.ai = data.ai;
    if (data.readiness) state.readiness = data.readiness;
    state.aiFormDirty = false;
    updateAiEnabledUi(Boolean(state.ai && state.ai.enabled));
    paintReadiness();
    window.dispatchEvent(new CustomEvent("automation-ai-updated", { detail: data }));
  }

  async function saveAiSettings(payload, { silent } = {}) {
    state.aiSavePending = true;
    try {
      const data = await api("/api/automation/ai", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      applyAiSaveResponse(data);
      if (!silent) toastMsg(t("automation.toast.aiSaved"), "ok");
      return data;
    } finally {
      state.aiSavePending = false;
    }
  }

  function scheduleAiAutoSave() {
    if (state.aiSaveTimer) clearTimeout(state.aiSaveTimer);
    state.aiSaveTimer = setTimeout(async () => {
      state.aiSaveTimer = null;
      if (!document.getElementById("automationAiForm")) return;
      try {
        await saveAiSettings(collectAiPayload(), { silent: true });
      } catch (err) {
        toastMsg(err.message, "err");
      }
    }, 450);
  }

  function paint() {
    const list = document.getElementById("automationRulesList");
    const log = document.getElementById("automationLogList");
    const warn = document.getElementById("automationBotWarn");
    if (list) {
      if (!state.rules.length) {
        list.innerHTML = `<p class="muted automation-empty" data-i18n="automation.empty">${esc(t("automation.empty"))}</p>`;
      } else {
        list.innerHTML = state.rules.map(renderRuleCard).join("");
      }
    }
    if (log) {
      if (!state.log.length) {
        log.innerHTML = `<li class="muted automation-empty" data-i18n="automation.logEmpty">${esc(t("automation.logEmpty"))}</li>`;
      } else {
        log.innerHTML = state.log.map(renderLogRow).join("");
      }
    }
    if (warn) {
      if (state.botEnabled) {
        warn.classList.remove("hidden");
        warn.textContent = t("automation.botWarning");
      } else {
        warn.classList.add("hidden");
        warn.textContent = "";
      }
    }
    paintAiWarnings();
    bindRuleCards();
  }

  function paintReadiness() {
    const box = document.getElementById("automationReadiness");
    if (!box || state.activeTab !== "ai") {
      if (box) box.classList.add("hidden");
      return;
    }
    if (!state.readiness) {
      box.classList.add("hidden");
      return;
    }
    const r = state.readiness;
    if (r.ready) {
      box.className = "automation-readiness ok";
      box.innerHTML = `<strong>${esc(t("automation.readiness.ok"))}</strong>`;
      box.classList.remove("hidden");
      return;
    }
    box.className = "automation-readiness warn";
    const items = (r.hints || []).map((h) => `<li>${esc(h)}</li>`).join("");
    box.innerHTML = `<strong>${esc(t("automation.readiness.pending"))}</strong><ul>${items}</ul>`;
    box.classList.remove("hidden");
  }

  function paintAiWarnings() {
    const gem = document.getElementById("automationGeminiWarn");
    if (!gem || state.activeTab !== "ai") {
      if (gem) gem.classList.add("hidden");
      return;
    }
    if (!state.geminiConfigured) {
      gem.classList.remove("hidden");
      gem.textContent = t("automation.ai.noGeminiKey");
    } else {
      gem.classList.add("hidden");
      gem.textContent = "";
    }
  }

  function setAutomationTab(tab) {
    state.activeTab = tab === "ai" ? "ai" : "rules";
    saveActiveTab();
    document.querySelectorAll(".automation-main-tab").forEach((btn) => {
      const on = btn.dataset.autoTab === state.activeTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("automationRulesView")?.classList.toggle("hidden", state.activeTab !== "rules");
    $("automationAiView")?.classList.toggle("hidden", state.activeTab !== "ai");
    const newBtn = $("automationNewRule");
    if (newBtn) newBtn.classList.toggle("hidden", state.activeTab !== "rules");
    if (state.activeTab === "ai") {
      if (!state.aiViewMounted || !state.aiFormDirty) {
        renderAiView();
      } else {
        paintAiWarnings();
        paintReadiness();
      }
    } else {
      paintAiWarnings();
      paintReadiness();
    }
  }

  function renderAiView() {
    const box = document.getElementById("automationAiView");
    if (!box) return;
    const ai = state.ai || defaultAi();
    const escalation = ai.escalation || defaultAi().escalation;
    const resolution = ai.resolution || defaultAi().resolution;
    const keywords = (escalation.keywords || []).join(", ");
    const corrections = (ai.corrections || [])
      .map((c) => `<li class="automation-corr-item">
        <div><strong>${t("automation.ai.corrWhen")}</strong> ${esc(c.when)}</div>
        <div><strong>${t("automation.ai.corrPrefer")}</strong> ${esc(c.prefer)}</div>
        <button type="button" class="btn-ghost sm danger corr-delete" data-id="${esc(c.id)}">×</button>
      </li>`)
      .join("");

    const failedRows = (state.aiFailed || [])
      .map((f) => `<li class="automation-failed-item">
        <div class="muted sm">${esc(formatTime(f.at))} · ${esc(f.contactName || f.phone || "")}</div>
        <div><strong>${t("automation.ai.failedQuestion")}</strong> ${esc(f.question)}</div>
        <div><strong>${t("automation.ai.failedAnswer")}</strong> ${esc((f.answer || "").slice(0, 120))}</div>
        <button type="button" class="btn-ghost sm failed-to-corr" data-id="${esc(f.id)}">${t("automation.ai.convertToCorrection")}</button>
      </li>`)
      .join("");

    box.innerHTML = `
      <section class="automation-ai-panel">
        <header class="automation-ai-head">
          <div>
            <h2 data-i18n="automation.ai.title">${t("automation.ai.title")}</h2>
            <p class="muted sm" data-i18n="automation.ai.intro">${t("automation.ai.intro")}</p>
            <p class="muted sm automation-faq-link">FAQ: <a href="${esc(state.faqSiteUrl || "#")}" target="_blank" rel="noopener">${esc(state.faqSiteUrl || "—")}</a></p>
          </div>
          <div class="automation-ai-toggle-box ${ai.enabled ? "is-on" : "is-off"}">
            <div class="automation-ai-toggle-text">
              <strong>${esc(t("automation.ai.enabled"))}</strong>
              <span class="automation-ai-status-pill">${esc(ai.enabled ? t("automation.ai.statusOn") : t("automation.ai.statusOff"))}</span>
            </div>
            <label class="automation-switch" title="${esc(t("automation.ai.enabled"))}">
              <input type="checkbox" id="aiEnabled" ${ai.enabled ? "checked" : ""} aria-label="${esc(t("automation.ai.enabled"))}" />
              <span></span>
            </label>
          </div>
        </header>
        <div id="automationGeminiWarn" class="automation-banner hidden"></div>
        <div id="automationReadiness" class="automation-readiness hidden"></div>
        <form id="automationAiForm" class="automation-ai-form">
          <label data-i18n="automation.ai.role">${t("automation.ai.role")}
            <input type="text" id="aiRole" maxlength="120" value="${esc(ai.role || "")}" />
          </label>
          <label data-i18n="automation.ai.instructions">${t("automation.ai.instructions")}
            <textarea id="aiInstructions" rows="5" placeholder="${esc(t("automation.ai.instructionsPh"))}">${esc(ai.instructions || "")}</textarea>
          </label>
          <div class="automation-ai-row">
            <label class="automation-check"><input type="checkbox" id="aiFaqEnabled" ${ai.faqEnabled !== false ? "checked" : ""} /> ${t("automation.ai.faqEnabled")}</label>
            <label class="automation-check"><input type="checkbox" id="aiFallback" ${ai.fallbackEnabled !== false ? "checked" : ""} /> ${t("automation.ai.fallbackEnabled")}</label>
          </div>
          <div class="automation-ai-row">
            <label>${t("automation.ai.faqAudience")}
              <select id="aiFaqAudience">
                <option value="cliente" ${ai.faqAudience === "cliente" ? "selected" : ""}>${t("automation.ai.audienceCliente")}</option>
                <option value="empresa" ${ai.faqAudience === "empresa" ? "selected" : ""}>${t("automation.ai.audienceEmpresa")}</option>
                <option value="all" ${ai.faqAudience === "all" ? "selected" : ""}>${t("automation.ai.audienceAll")}</option>
              </select>
            </label>
            <label>${t("automation.ai.faqMaxArticles")}
              <input type="number" id="aiFaqMax" min="1" max="8" value="${Number(ai.faqMaxArticles) || 4}" />
            </label>
          </div>
          <fieldset class="automation-fieldset">
            <legend data-i18n="automation.ai.escalationTitle">${t("automation.ai.escalationTitle")}</legend>
            <label data-i18n="automation.ai.escalationKeywords">${t("automation.ai.escalationKeywords")}
              <input type="text" id="aiEscKeywords" value="${esc(keywords)}" placeholder="agente, humano, persona" />
            </label>
            <label data-i18n="automation.ai.handoffMessage">${t("automation.ai.handoffMessage")}
              <textarea id="aiHandoff" rows="2">${esc(escalation.handoffMessage || "")}</textarea>
            </label>
            <div class="automation-ai-row">
              <label class="automation-check"><input type="checkbox" id="aiEscLowConf" ${escalation.onLowConfidence !== false ? "checked" : ""} /> ${t("automation.ai.onLowConfidence")}</label>
              <label>${t("automation.ai.confidenceThreshold")}
                <input type="number" id="aiEscThreshold" min="0.1" max="0.95" step="0.05" value="${Number(escalation.confidenceThreshold) || 0.45}" />
              </label>
              <label>${t("automation.ai.maxReplies")}
                <input type="number" id="aiEscMaxReplies" min="1" max="30" value="${Number(escalation.maxRepliesPerChat) || 8}" />
              </label>
            </div>
          </fieldset>
          <fieldset class="automation-fieldset">
            <legend data-i18n="automation.ai.resolutionTitle">${t("automation.ai.resolutionTitle")}</legend>
            <p class="muted sm" data-i18n="automation.ai.resolutionIntro">${t("automation.ai.resolutionIntro")}</p>
            <label class="automation-check"><input type="checkbox" id="aiFeedbackEnabled" ${resolution.feedbackEnabled !== false ? "checked" : ""} /> ${t("automation.ai.feedbackEnabled")}</label>
            <label>${t("automation.ai.feedbackPrompt")}
              <input type="text" id="aiFeedbackPrompt" maxlength="200" value="${esc(resolution.feedbackPrompt || "")}" />
            </label>
            <div class="automation-ai-row">
              <label>${t("automation.ai.feedbackYes")}
                <input type="text" id="aiFeedbackYes" maxlength="20" value="${esc(resolution.feedbackYes || "")}" />
              </label>
              <label>${t("automation.ai.feedbackNo")}
                <input type="text" id="aiFeedbackNo" maxlength="20" value="${esc(resolution.feedbackNo || "")}" />
              </label>
            </div>
            <label>${t("automation.ai.thankYouMessage")}
              <textarea id="aiThankYou" rows="2">${esc(resolution.thankYouMessage || "")}</textarea>
            </label>
            <div class="automation-ai-row">
              <label class="automation-check"><input type="checkbox" id="aiArchiveOnConfirmed" ${resolution.archiveOnConfirmed ? "checked" : ""} /> ${t("automation.ai.archiveOnConfirmed")}</label>
              <label class="automation-check"><input type="checkbox" id="aiAssumedResolution" ${resolution.assumedResolutionEnabled !== false ? "checked" : ""} /> ${t("automation.ai.assumedResolutionEnabled")}</label>
              <label>${t("automation.ai.inactivityMinutes")}
                <input type="number" id="aiInactivityMin" min="1" max="30" value="${Number(resolution.inactivityMinutes) || 4}" />
              </label>
            </div>
          </fieldset>
          <fieldset class="automation-fieldset">
            <legend data-i18n="automation.ai.correctionsTitle">${t("automation.ai.correctionsTitle")}</legend>
            <p class="muted sm" data-i18n="automation.ai.correctionsIntro">${t("automation.ai.correctionsIntro")}</p>
            <ul id="aiCorrectionsList" class="automation-corr-list">${corrections || `<li class="muted sm">${t("automation.ai.noCorrections")}</li>`}</ul>
            <div class="automation-corr-form">
              <input type="text" id="corrWhen" placeholder="${esc(t("automation.ai.corrWhenPh"))}" />
              <textarea id="corrPrefer" rows="2" placeholder="${esc(t("automation.ai.corrPreferPh"))}"></textarea>
              <button type="button" class="btn-ghost sm" id="corrAddBtn">${t("automation.ai.addCorrection")}</button>
            </div>
          </fieldset>
          <fieldset class="automation-fieldset">
            <legend data-i18n="automation.ai.failedTitle">${t("automation.ai.failedTitle")}</legend>
            <p class="muted sm" data-i18n="automation.ai.failedIntro">${t("automation.ai.failedIntro")}</p>
            <ul class="automation-failed-list">${failedRows || `<li class="muted sm">${t("automation.ai.noFailed")}</li>`}</ul>
          </fieldset>
          <footer class="automation-editor-foot">
            <button type="submit" class="btn-primary" data-i18n="automation.ai.save">${t("automation.ai.save")}</button>
          </footer>
        </form>
      </section>`;
    if (window.I18n) I18n.applyDom(box);
    state.aiViewMounted = true;
    state.aiFormDirty = false;
    paintAiWarnings();
    paintReadiness();
  }

  function collectAiPayload() {
    const keywords = ($("aiEscKeywords") || {}).value || "";
    return {
      enabled: Boolean($("aiEnabled") && $("aiEnabled").checked),
      fallbackEnabled: Boolean($("aiFallback") && $("aiFallback").checked),
      role: ($("aiRole") || {}).value || "",
      instructions: ($("aiInstructions") || {}).value || "",
      faqEnabled: Boolean($("aiFaqEnabled") && $("aiFaqEnabled").checked),
      faqAudience: ($("aiFaqAudience") || {}).value || "cliente",
      faqMaxArticles: Number(($("aiFaqMax") || {}).value) || 4,
      escalation: {
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        onLowConfidence: Boolean($("aiEscLowConf") && $("aiEscLowConf").checked),
        confidenceThreshold: Number(($("aiEscThreshold") || {}).value) || 0.45,
        maxRepliesPerChat: Number(($("aiEscMaxReplies") || {}).value) || 8,
        handoffMessage: ($("aiHandoff") || {}).value || "",
      },
      resolution: {
        feedbackEnabled: Boolean($("aiFeedbackEnabled") && $("aiFeedbackEnabled").checked),
        feedbackPrompt: ($("aiFeedbackPrompt") || {}).value || "",
        feedbackYes: ($("aiFeedbackYes") || {}).value || "",
        feedbackNo: ($("aiFeedbackNo") || {}).value || "",
        thankYouMessage: ($("aiThankYou") || {}).value || "",
        archiveOnConfirmed: Boolean($("aiArchiveOnConfirmed") && $("aiArchiveOnConfirmed").checked),
        assumedResolutionEnabled: Boolean($("aiAssumedResolution") && $("aiAssumedResolution").checked),
        inactivityMinutes: Number(($("aiInactivityMin") || {}).value) || 4,
      },
      corrections: (state.ai && state.ai.corrections) || [],
    };
  }

  function conditionRowHtml(c, idx) {
    const type = c.type || "contains";
    const needsValue = type !== "any" && type !== "first_inbound";
    const isMsgType = type === "message_type";
    const opts = CONDITION_OPTS.map(
      (k) => `<option value="${k}" ${k === type ? "selected" : ""}>${esc(t(`automation.conditions.${k}`))}</option>`,
    ).join("");
    const msgOpts = MSG_TYPES.map(
      (k) => `<option value="${k}" ${k === (c.value || "text") ? "selected" : ""}>${k}</option>`,
    ).join("");
    return `
      <div class="automation-row" data-cond-idx="${idx}">
        <select class="cond-type">${opts}</select>
        ${isMsgType
          ? `<select class="cond-msg-type">${msgOpts}</select>`
          : needsValue
            ? `<input class="cond-value" type="text" value="${esc(c.value || "")}" placeholder="${esc(t("automation.editor.valuePh"))}" />`
            : `<span class="cond-spacer"></span>`}
        ${needsValue && !isMsgType
          ? `<label class="automation-check sm"><input type="checkbox" class="cond-ci" ${c.caseInsensitive !== false ? "checked" : ""} /> ${esc(t("automation.editor.caseInsensitive"))}</label>`
          : ""}
        <button type="button" class="btn-ghost sm danger row-remove" data-remove-cond="${idx}">×</button>
      </div>`;
  }

  function actionRowHtml(a, idx) {
    const type = a.type || "reply_text";
    const opts = ACTION_OPTS.map(
      (k) => `<option value="${k}" ${k === type ? "selected" : ""}>${esc(t(`automation.actions.${k}`))}</option>`,
    ).join("");
    const tplOpts = state.templates
      .filter((tpl) => (tpl.status || "").toLowerCase() === "approved")
      .map(
        (tpl) =>
          `<option value="${esc(tpl.name)}" data-lang="${esc(tpl.language)}" ${tpl.name === a.template ? "selected" : ""}>${esc(tpl.name)} · ${esc(tpl.language)}</option>`,
      )
      .join("");
    let fields = "";
    if (type === "reply_text") {
      fields = `<textarea class="act-text" rows="2" placeholder="${esc(t("automation.editor.textPh"))}">${esc(a.text || "")}</textarea>`;
    } else if (type === "reply_template") {
      fields = `
        <select class="act-template">${tplOpts || `<option value="">${esc(t("automation.editor.noTemplates"))}</option>`}</select>
        <input class="act-language" type="text" value="${esc(a.language || "es")}" placeholder="es" />`;
    } else if (type === "reply_buttons") {
      const btns = (a.buttons || [{ title: "" }, { title: "" }])
        .slice(0, 3)
        .map((b, i) => `<input class="act-btn-title" data-btn="${i}" type="text" value="${esc(b.title || "")}" placeholder="${esc(t("automation.editor.buttonPh"))} ${i + 1}" />`)
        .join("");
      fields = `<textarea class="act-body" rows="2" placeholder="${esc(t("automation.editor.bodyPh"))}">${esc(a.body || "")}</textarea>${btns}`;
    } else if (type === "add_note") {
      fields = `<textarea class="act-note" rows="2" placeholder="${esc(t("automation.editor.notePh"))}">${esc(a.note || "")}</textarea>`;
    } else {
      fields = `<span class="muted">${esc(t("automation.editor.noExtraFields"))}</span>`;
    }
    return `
      <div class="automation-row automation-action-row" data-act-idx="${idx}">
        <select class="act-type">${opts}</select>
        <div class="act-fields">${fields}</div>
        <button type="button" class="btn-ghost sm danger row-remove" data-remove-act="${idx}">×</button>
      </div>`;
  }

  function openEditor(rule) {
    state.editingId = rule ? rule.id : null;
    const overlay = document.getElementById("automationEditor");
    const title = document.getElementById("automationEditorTitle");
    const name = document.getElementById("ruleName");
    const stop = document.getElementById("ruleStopOnMatch");
    const condBox = document.getElementById("ruleConditions");
    const actBox = document.getElementById("ruleActions");
    if (!overlay || !condBox || !actBox) return;

    const draft = rule || {
      name: "",
      stopOnMatch: true,
      conditions: [emptyCondition()],
      actions: [emptyAction()],
    };

    if (title) title.textContent = rule ? t("automation.editor.edit") : t("automation.editor.new");
    if (name) name.value = draft.name || "";
    if (stop) stop.checked = draft.stopOnMatch !== false;

    const conds = draft.conditions && draft.conditions.length ? draft.conditions : [emptyCondition()];
    const acts = draft.actions && draft.actions.length ? draft.actions : [emptyAction()];
    condBox.innerHTML = conds.map(conditionRowHtml).join("");
    actBox.innerHTML = acts.map(actionRowHtml).join("");
    bindEditorRows();
    overlay.classList.remove("hidden");
  }

  function closeEditor() {
    const overlay = document.getElementById("automationEditor");
    if (overlay) overlay.classList.add("hidden");
    state.editingId = null;
  }

  function readEditorPayload() {
    const name = document.getElementById("ruleName");
    const stop = document.getElementById("ruleStopOnMatch");
    const conditions = [];
    document.querySelectorAll("#ruleConditions .automation-row").forEach((row) => {
      const type = row.querySelector(".cond-type")?.value || "contains";
      const c = { type };
      if (type === "message_type") {
        c.value = row.querySelector(".cond-msg-type")?.value || "text";
      } else if (type !== "any" && type !== "first_inbound") {
        c.value = row.querySelector(".cond-value")?.value || "";
        c.caseInsensitive = row.querySelector(".cond-ci")?.checked !== false;
      }
      conditions.push(c);
    });
    const actions = [];
    document.querySelectorAll("#ruleActions .automation-action-row").forEach((row) => {
      const type = row.querySelector(".act-type")?.value || "reply_text";
      const a = { type };
      if (type === "reply_text") {
        a.text = row.querySelector(".act-text")?.value || "";
      } else if (type === "reply_template") {
        const sel = row.querySelector(".act-template");
        a.template = sel?.value || "";
        const opt = sel?.selectedOptions?.[0];
        a.language = row.querySelector(".act-language")?.value || (opt && opt.dataset.lang) || "es";
      } else if (type === "reply_buttons") {
        a.body = row.querySelector(".act-body")?.value || "";
        a.buttons = [];
        row.querySelectorAll(".act-btn-title").forEach((inp) => {
          const title = (inp.value || "").trim();
          if (title) a.buttons.push({ title });
        });
      } else if (type === "add_note") {
        a.note = row.querySelector(".act-note")?.value || "";
      }
      actions.push(a);
    });
    return {
      name: name?.value || "",
      stopOnMatch: stop?.checked !== false,
      conditions,
      actions,
      enabled: true,
    };
  }

  function bindEditorRows() {
    document.querySelectorAll("#ruleConditions .cond-type").forEach((sel) => {
      sel.onchange = () => {
        const row = sel.closest(".automation-row");
        const idx = Number(row?.dataset.condIdx);
        const conds = readEditorPayload().conditions;
        conds[idx] = { ...conds[idx], type: sel.value };
        if (sel.value === "message_type") conds[idx].value = "text";
        if (sel.value === "any" || sel.value === "first_inbound") delete conds[idx].value;
        const box = document.getElementById("ruleConditions");
        if (box) {
          box.innerHTML = conds.map(conditionRowHtml).join("");
          bindEditorRows();
        }
      };
    });
    document.querySelectorAll("#ruleActions .act-type").forEach((sel) => {
      sel.onchange = () => {
        const row = sel.closest(".automation-action-row");
        const idx = Number(row?.dataset.actIdx);
        const acts = readEditorPayload().actions;
        acts[idx] = { type: sel.value };
        const box = document.getElementById("ruleActions");
        if (box) {
          box.innerHTML = acts.map(actionRowHtml).join("");
          bindEditorRows();
        }
      };
    });
    document.querySelectorAll("[data-remove-cond]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.removeCond);
        const conds = readEditorPayload().conditions.filter((_, i) => i !== idx);
        const box = document.getElementById("ruleConditions");
        if (box) {
          box.innerHTML = (conds.length ? conds : [emptyCondition()]).map(conditionRowHtml).join("");
          bindEditorRows();
        }
      };
    });
    document.querySelectorAll("[data-remove-act]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.removeAct);
        const acts = readEditorPayload().actions.filter((_, i) => i !== idx);
        const box = document.getElementById("ruleActions");
        if (box) {
          box.innerHTML = (acts.length ? acts : [emptyAction()]).map(actionRowHtml).join("");
          bindEditorRows();
        }
      };
    });
  }

  function bindRuleCards() {
    document.querySelectorAll(".rule-edit").forEach((btn) => {
      btn.onclick = () => {
        const rule = state.rules.find((r) => r.id === btn.dataset.id);
        if (rule) openEditor(rule);
      };
    });
    document.querySelectorAll(".rule-delete").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm(t("automation.rule.confirmDelete"))) return;
        try {
          await api(`/api/automation/rules/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
          toastMsg(t("automation.toast.deleted"), "ok");
          await refresh();
        } catch (err) {
          toastMsg(err.message, "err");
        }
      };
    });
    document.querySelectorAll(".rule-enable").forEach((inp) => {
      inp.onchange = async () => {
        try {
          await api(`/api/automation/rules/${encodeURIComponent(inp.dataset.id)}`, {
            method: "PUT",
            body: JSON.stringify({ enabled: inp.checked }),
          });
          await refresh();
        } catch (err) {
          inp.checked = !inp.checked;
          toastMsg(err.message, "err");
        }
      };
    });
  }

  function bindShell() {
    if (state.bound) return;
    state.bound = true;

    document.getElementById("automationNewRule")?.addEventListener("click", () => openEditor(null));
    document.getElementById("automationEditorClose")?.addEventListener("click", closeEditor);
    document.getElementById("automationEditorCancel")?.addEventListener("click", closeEditor);
    document.getElementById("automationEditor")?.addEventListener("click", (e) => {
      if (e.target.id === "automationEditor") closeEditor();
    });

    document.getElementById("addCondition")?.addEventListener("click", () => {
      const conds = readEditorPayload().conditions;
      conds.push(emptyCondition());
      const box = document.getElementById("ruleConditions");
      if (box) {
        box.innerHTML = conds.map(conditionRowHtml).join("");
        bindEditorRows();
      }
    });

    document.getElementById("addAction")?.addEventListener("click", () => {
      const acts = readEditorPayload().actions;
      acts.push(emptyAction());
      const box = document.getElementById("ruleActions");
      if (box) {
        box.innerHTML = acts.map(actionRowHtml).join("");
        bindEditorRows();
      }
    });

    document.getElementById("automationEditorForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = readEditorPayload();
      try {
        if (state.editingId) {
          await api(`/api/automation/rules/${encodeURIComponent(state.editingId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          toastMsg(t("automation.toast.saved"), "ok");
        } else {
          await api("/api/automation/rules", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          toastMsg(t("automation.toast.created"), "ok");
        }
        closeEditor();
        await refresh();
      } catch (err) {
        toastMsg(err.message, "err");
      }
    });

    document.querySelectorAll(".automation-main-tab").forEach((btn) => {
      btn.addEventListener("click", () => setAutomationTab(btn.dataset.autoTab));
    });

    const aiView = document.getElementById("automationAiView");
    if (aiView && !aiView.dataset.bound) {
      aiView.dataset.bound = "1";
      aiView.addEventListener("input", (e) => {
        if (!e.target.closest("#automationAiForm")) return;
        state.aiFormDirty = true;
        scheduleAiAutoSave();
      });
      aiView.addEventListener("change", async (e) => {
        if (e.target.id === "aiEnabled") {
          const enabled = e.target.checked;
          const payload = collectAiPayload();
          payload.enabled = enabled;
          try {
            await saveAiSettings(payload);
          } catch (err) {
            e.target.checked = !enabled;
            updateAiEnabledUi(!enabled);
            toastMsg(err.message, "err");
          }
          return;
        }
        if (e.target.closest("#automationAiForm")) {
          state.aiFormDirty = true;
          scheduleAiAutoSave();
        }
      });
      aiView.addEventListener("submit", async (e) => {
        const form = e.target.closest("#automationAiForm");
        if (!form) return;
        e.preventDefault();
        if (state.aiSaveTimer) {
          clearTimeout(state.aiSaveTimer);
          state.aiSaveTimer = null;
        }
        try {
          await saveAiSettings(collectAiPayload());
        } catch (err) {
          toastMsg(err.message, "err");
        }
      });
      aiView.addEventListener("click", async (e) => {
        if (e.target.id === "corrAddBtn") {
          const when = ($("corrWhen") || {}).value.trim();
          const prefer = ($("corrPrefer") || {}).value.trim();
          if (!when || !prefer) return toastMsg(t("automation.ai.corrRequired"), "err");
          try {
            const data = await api("/api/automation/ai/corrections", {
              method: "POST",
              body: JSON.stringify({ when, prefer }),
            });
            state.ai = data.ai;
            state.aiFormDirty = false;
            $("corrWhen").value = "";
            $("corrPrefer").value = "";
            toastMsg(t("automation.toast.correctionAdded"), "ok");
            renderAiView();
          } catch (err) {
            toastMsg(err.message, "err");
          }
        }
        const del = e.target.closest(".corr-delete");
        if (del) {
          try {
            const data = await api(`/api/automation/ai/corrections/${encodeURIComponent(del.dataset.id)}`, { method: "DELETE" });
            state.ai = data.ai;
            state.aiFormDirty = false;
            toastMsg(t("automation.toast.correctionDeleted"), "ok");
            renderAiView();
          } catch (err) {
            toastMsg(err.message, "err");
          }
        }
        const toCorr = e.target.closest(".failed-to-corr");
        if (toCorr) {
          try {
            const data = await api(`/api/automation/ai/failed/${encodeURIComponent(toCorr.dataset.id)}/to-correction`, { method: "POST", body: "{}" });
            state.ai = data.ai;
            toastMsg(t("automation.toast.correctionAdded"), "ok");
            await refresh();
          } catch (err) {
            toastMsg(err.message, "err");
          }
        }
      });
    }
  }

  async function refresh() {
    if (state.aiSavePending) return;
    const data = await api("/api/automation");
    state.rules = data.rules || [];
    state.settings = data.settings || { enabled: false };
    const serverAi = data.ai || defaultAi();
    if (!state.aiFormDirty) {
      state.ai = serverAi;
    } else if (state.ai) {
      state.ai = { ...serverAi, ...state.ai, corrections: serverAi.corrections || state.ai.corrections };
    }
    state.log = data.log || [];
    state.aiFailed = data.aiFailed || [];
    state.aiResolutionLog = data.aiResolutionLog || [];
    state.botEnabled = Boolean(data.botEnabled);
    state.geminiConfigured = Boolean(data.geminiConfigured);
    state.faqSiteUrl = data.faqSiteUrl || "";
    state.readiness = data.readiness || null;
    paint();
    if (state.activeTab === "ai" && !state.aiFormDirty) {
      renderAiView();
    } else if (state.activeTab === "ai" && state.ai) {
      updateAiEnabledUi(Boolean(state.ai.enabled));
    }
  }

  function setTemplates(list) {
    state.templates = Array.isArray(list) ? list : [];
  }

  async function init() {
    const root = document.getElementById("screenAutomation");
    if (!root) return;
    loadActiveTab();
    if (!root.dataset.rendered) {
      root.dataset.rendered = "1";
      renderShell();
      setAutomationTab(state.activeTab);
    }
    try {
      await refresh();
    } catch (err) {
      toastMsg(err.message, "err");
    }
  }

  window.AutomationModule = { init, setTemplates, refresh };
})();
