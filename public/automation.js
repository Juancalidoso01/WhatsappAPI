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
    log: [],
    botEnabled: false,
    templates: [],
    editingId: null,
    bound: false,
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toastMsg(msg, type) {
    if (typeof window.toast === "function") window.toastMsg(msg, type);
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
            <label class="automation-switch" id="automationGlobalToggle">
              <input type="checkbox" id="automationEnabled" ${state.settings.enabled ? "checked" : ""} />
              <span></span>
              <em data-i18n="automation.globalEnabled">${esc(t("automation.globalEnabled"))}</em>
            </label>
            <button type="button" class="btn-primary" id="automationNewRule" data-i18n="automation.newRule">${esc(t("automation.newRule"))}</button>
          </div>
        </header>
        <div id="automationBotWarn" class="automation-banner hidden"></div>
        <div class="automation-grid">
          <section class="automation-rules-panel">
            <h2 data-i18n="automation.rulesTitle">${esc(t("automation.rulesTitle"))}</h2>
            <div id="automationRulesList" class="automation-rules-list"></div>
          </section>
          <section class="automation-log-panel">
            <h2 data-i18n="automation.logTitle">${esc(t("automation.logTitle"))}</h2>
            <ul id="automationLogList" class="automation-log-list"></ul>
          </section>
        </div>
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
    const en = document.getElementById("automationEnabled");
    if (en) en.checked = Boolean(state.settings.enabled);
    bindRuleCards();
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

    document.getElementById("automationEnabled")?.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      try {
        const data = await api("/api/automation/settings", {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        });
        state.settings = data.settings || { enabled };
        toastMsg(enabled ? t("automation.toast.enabled") : t("automation.toast.disabled"), "ok");
      } catch (err) {
        e.target.checked = !enabled;
        toastMsg(err.message, "err");
      }
    });
  }

  async function refresh() {
    const data = await api("/api/automation");
    state.rules = data.rules || [];
    state.settings = data.settings || { enabled: false };
    state.log = data.log || [];
    state.botEnabled = Boolean(data.botEnabled);
    paint();
  }

  function setTemplates(list) {
    state.templates = Array.isArray(list) ? list : [];
  }

  async function init() {
    const root = document.getElementById("screenAutomation");
    if (!root) return;
    if (!root.dataset.rendered) {
      root.dataset.rendered = "1";
      renderShell();
    }
    try {
      await refresh();
    } catch (err) {
      toastMsg(err.message, "err");
    }
  }

  window.AutomationModule = { init, setTemplates, refresh };
})();
