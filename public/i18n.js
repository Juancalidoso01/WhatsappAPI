"use strict";

/**
 * i18n ligero por módulos — carga bajo demanda (/locales/{lang}/{mod}.json).
 * Fallback: idioma activo → español → clave.
 */
(function (global) {
  const LOCALES = ["es", "en", "ru"];
  const SCREEN_MODULES = {
    chats: ["chats", "detail", "modals"],
    templates: ["templates", "modals"],
    bulk: ["bulk", "modals"],
    integration: ["integration"],
    workspace: ["workspace"],
    flows: ["flows", "modals"],
    billing: ["billing"],
  };
  const BASE_MODULES = ["common", "nav"];

  const cache = Object.create(null);
  const loadPromises = Object.create(null);
  let locale = "es";
  let loadedModules = new Set(BASE_MODULES);

  function cacheKey(lang, mod) {
    return `${lang}:${mod}`;
  }

  function flatten(obj, prefix, out) {
    Object.entries(obj || {}).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => { out[`${key}.${i}`] = String(item); });
      } else if (v && typeof v === "object") flatten(v, key, out);
      else out[key] = String(v);
    });
    return out;
  }

  async function loadModule(mod, lang) {
    const l = LOCALES.includes(lang) ? lang : "es";
    const ck = cacheKey(l, mod);
    if (cache[ck]) return cache[ck];
    if (loadPromises[ck]) return loadPromises[ck];
    loadPromises[ck] = fetch(`/locales/${l}/${mod}.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((raw) => {
        const flat = flatten(raw, "", {});
        cache[ck] = flat;
        delete loadPromises[ck];
        return flat;
      })
      .catch(() => {
        cache[ck] = {};
        delete loadPromises[ck];
        return {};
      });
    return loadPromises[ck];
  }

  function lookup(key, lang) {
    const langs = lang ? [lang] : [locale, "es"];
    const mods = [...loadedModules];
    for (const l of langs) {
      for (const mod of mods) {
        const ck = cacheKey(l, mod);
        if (cache[ck] && cache[ck][key] != null) return cache[ck][key];
      }
    }
    return null;
  }

  function t(key, vars) {
    let str = lookup(key) || key;
    if (vars && typeof vars === "object") {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      });
    }
    return str;
  }

  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const k = el.getAttribute("data-i18n");
      if (k) el.textContent = t(k);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const k = el.getAttribute("data-i18n-placeholder");
      if (k) el.placeholder = t(k);
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const k = el.getAttribute("data-i18n-title");
      if (k) el.title = t(k);
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const k = el.getAttribute("data-i18n-aria");
      if (k) el.setAttribute("aria-label", t(k));
    });
    scope.querySelectorAll("select[data-i18n-options]").forEach((sel) => {
      const prefix = sel.getAttribute("data-i18n-options");
      if (!prefix) return;
      [...sel.options].forEach((opt) => {
        const k = opt.getAttribute("data-i18n-opt");
        if (k) opt.textContent = t(`${prefix}.${k}`);
      });
    });
  }

  async function ensureModules(mods, lang) {
    const l = lang || locale;
    const list = [...new Set(mods)];
    await Promise.all(list.map((m) => loadModule(m, l)));
    list.forEach((m) => loadedModules.add(m));
  }

  async function ensureScreen(screen, lang) {
    const extra = SCREEN_MODULES[screen] || [];
    await ensureModules([...BASE_MODULES, ...extra], lang);
    applyDom();
  }

  async function setLocale(next, opts) {
    const loc = LOCALES.includes(next) ? next : "es";
    if (loc === locale && !opts?.force) return locale;
    locale = loc;
    localStorage.setItem("pp-locale", loc);
    document.documentElement.lang = loc;
    const toReload = [...loadedModules];
    toReload.forEach((mod) => {
      LOCALES.forEach((l) => delete cache[cacheKey(l, mod)]);
    });
    await ensureModules(toReload, loc);
    applyDom();
    global.dispatchEvent(new CustomEvent("localechange", { detail: { locale: loc } }));
    return loc;
  }

  async function bootstrap(initialLocale) {
    const loc = LOCALES.includes(initialLocale) ? initialLocale : "es";
    locale = loc;
    localStorage.setItem("pp-locale", loc);
    document.documentElement.lang = loc;
    loadedModules = new Set(BASE_MODULES);
    await ensureModules(BASE_MODULES, loc);
    applyDom();
    return loc;
  }

  function getLocale() {
    return locale;
  }

  function resolveInitial(stored, workspaceLang) {
    if (LOCALES.includes(stored)) return stored;
    if (LOCALES.includes(workspaceLang)) return workspaceLang;
    return "es";
  }

  global.I18n = {
    LOCALES,
    t,
    loadModule,
    ensureModules,
    ensureScreen,
    setLocale,
    bootstrap,
    applyDom,
    getLocale,
    resolveInitial,
  };
})(window);
