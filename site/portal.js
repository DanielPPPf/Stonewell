/* =====================================================
   STONEWELL CAPITAL PARTNERS — Client Portal (production)
   -----------------------------------------------------
   Session-guarded SPA. Reads the Cognito ID token stored at
   login, calls the private API (scoped to the token's sub),
   and renders Overview · Data Room · Calendar. The edge gate
   (/portal*) is the real barrier; this guard is the UX layer.
   ===================================================== */
(function () {
  "use strict";

  var TOKEN_KEY = "stonewell-id-token";
  var COOKIE_KEY = "stonewell_idt";
  var API = (window.STONEWELL_API && window.STONEWELL_API.base) || "";

  /* ---------- Session ---------- */
  function decodeJwt(token) {
    try {
      var p = token.split(".")[1];
      return JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, "+").replace(/_/g, "/")))));
    } catch (e) { return null; }
  }
  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function validClaims() {
    var t = getToken(); if (!t) return null;
    var c = decodeJwt(t);
    if (!c || !c.exp || Date.now() >= c.exp * 1000) return null;
    return c;
  }
  function clearCookie() { document.cookie = COOKIE_KEY + "=; Path=/; Max-Age=0; Secure; SameSite=Strict"; }
  function toLogin() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    clearCookie();
    window.location.replace("login.html");
  }

  var claims = validClaims();
  if (!claims) { toLogin(); return; }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: "Bearer " + getToken() }, opts.headers || {});
    return fetch(API + path, Object.assign({}, opts, { headers: headers })).then(function (res) {
      if (res.status === 401) { toLogin(); return null; }
      if (!res.ok) { return res.json().catch(function () { return {}; }).then(function () { return null; }); }
      return res.json();
    }).catch(function () { return null; });
  }

  /* ---------- i18n ---------- */
  var lang = "en";
  try { lang = localStorage.getItem("stonewell-lang") || "en"; } catch (e) {}
  if (["en", "es", "fr"].indexOf(lang) === -1) lang = "en";
  function L(en, es, fr) { return lang === "fr" ? (fr !== undefined ? fr : en) : (lang === "es" ? es : en); }
  function localeTag() { return lang === "fr" ? "fr-FR" : (lang === "es" ? "es-CO" : "en-US"); }

  /* ---------- State ---------- */
  var ME = null, DOCS = [], EVENTS = [];

  /* ====================================================
     Render: profile / metrics / relationship partner
     ==================================================== */
  function initials(name) {
    if (!name) return "—";
    var parts = name.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.)\s+/i, "").trim().split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v || ""; }

  function renderProfile() {
    if (!ME) return;
    setText("member-avatar", initials(ME.name || ME.email));
    setText("member-name", ME.name || ME.email || "—");
    setText("member-id", ME.memberId ? "Member " + ME.memberId : "");
    setText("greet-name", ME.greetingName ? ", " + ME.greetingName : (ME.name ? ", " + ME.name : ""));

    var m = ME.metrics || {};
    if (m.committedCapital) { setText("m-committed-v", m.committedCapital.value); setText("m-committed-s", m.committedCapital.sub); }
    if (m.nav) {
      setText("m-nav-v", m.nav.value);
      var navSub = document.getElementById("m-nav-s");
      if (navSub) { navSub.textContent = (m.nav.up ? "▲ " : "") + (m.nav.sub || ""); navSub.classList.toggle("up", !!m.nav.up); }
    }
    if (m.nextCall) { setText("m-nextcall-v", m.nextCall.value); setText("m-nextcall-s", m.nextCall.sub); }

    var p = ME.partner;
    var card = document.getElementById("rm-card");
    if (p && (p.name || p.initials)) {
      setText("rm-avatar", p.initials || initials(p.name));
      setText("rm-name", p.name || "");
      setText("rm-title", p.title || "");
      if (card) card.hidden = false;
    } else if (card) { card.hidden = true; }
  }

  /* ====================================================
     Render: documents
     ==================================================== */
  function catLabel(cat) {
    var map = {
      fund: ["Fund Documents", "Documentos del Fondo", "Documents du Fonds"],
      deal: ["Deal Memo", "Memorando", "Note d'Opération"],
      legal: ["Legal & NDA", "Legal y NDA", "Juridique et NDA"],
      statement: ["Statement", "Estado", "Relevé"],
    };
    var m = map[cat]; return m ? L(m[0], m[1], m[2]) : cat;
  }
  function tagHtml(tag) {
    var map = {
      viewonly: { c: "viewonly", t: ["View-only", "Solo lectura", "Lecture seule"] },
      download: { c: "signed", t: ["Download", "Descargable", "Téléchargeable"] },
      nda: { c: "nda", t: ["NDA", "NDA", "NDA"] },
      signed: { c: "signed", t: ["Signed", "Firmado", "Signé"] },
    };
    var m = map[tag]; if (!m) return "";
    return '<span class="tag ' + m.c + '">' + L(m.t[0], m.t[1], m.t[2]) + "</span>";
  }
  function docIcon() {
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 21V5a2 2 0 012-2h7l5 5v13H5z"/><path d="M14 3v5h5"/></svg>';
  }
  function rowHtml(d) {
    var tags = (d.tags || []).slice();
    if (d.security === "download" && tags.indexOf("download") === -1) tags.push("download");
    if (d.security === "viewonly" && tags.indexOf("viewonly") === -1) tags.unshift("viewonly");
    var openLabel = d.security === "download" ? L("Download", "Descargar", "Télécharger") : L("Open", "Abrir", "Ouvrir");
    return '<div class="doc-row" data-cat="' + (d.category || "") + '">' +
      '<span class="doc-ic">' + docIcon() + "</span>" +
      '<span class="doc-name"><b>' + esc(d.name) + '</b><span class="doc-tags">' + tags.map(tagHtml).join("") + "</span></span>" +
      '<span class="doc-cat">' + catLabel(d.category) + "</span>" +
      '<span class="doc-date">' + esc(d.date || "") + "</span>" +
      '<span class="doc-open" data-open="' + esc(d.id) + '">' + openLabel + "</span>" +
    "</div>";
  }
  function renderDocs() {
    var recent = DOCS.slice(0, 3);
    var elRecent = document.getElementById("recent-docs");
    if (elRecent) elRecent.innerHTML = recent.length ? recent.map(rowHtml).join("") : emptyRow(L("No documents yet.", "Aún no hay documentos.", "Aucun document pour l'instant."));
    var elAll = document.getElementById("all-docs");
    if (elAll) elAll.innerHTML = DOCS.length ? DOCS.map(rowHtml).join("") : emptyRow(L("No documents in your data room yet.", "Aún no hay documentos en su sala de datos.", "Aucun document dans votre salle de données."));
  }
  function emptyRow(msg) { return '<div class="doc-row" style="grid-template-columns:1fr;opacity:.7;"><span class="doc-cat">' + esc(msg) + "</span></div>"; }

  /* ====================================================
     Render: calendar
     ==================================================== */
  function parseStamp(s) {
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
  }
  function modeMeta(mode) {
    var map = {
      video: { c: "video", t: ["Video", "Video", "Vidéo"] },
      phone: { c: "phone", t: ["Phone", "Teléfono", "Téléphone"] },
      inperson: { c: "inperson", t: ["In person", "Presencial", "En personne"] },
    };
    return map[mode] || map.video;
  }
  function callHtml(c) {
    var start = parseStamp(c.start), end = parseStamp(c.end);
    var loc = localeTag();
    var day = start ? String(start.getDate()).padStart(2, "0") : "--";
    var mon = start ? start.toLocaleDateString(loc, { month: "short" }) : "";
    var when = "";
    if (start) {
      when = start.toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "short" }) +
        " · " + start.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
      if (end) when += " (" + Math.round((end - start) / 60000) + " min)";
    }
    var isPast = start ? start.getTime() < Date.now() : false;
    var m = modeMeta(c.mode);
    var actions = isPast
      ? '<span class="cal-btn ghost" data-goto="dataroom">' + L("View recap", "Ver resumen", "Voir le résumé") + "</span>"
      : '<span class="cal-btn join" data-ics="' + esc(c.id) + '">' + L("Add to calendar", "Añadir al calendario", "Ajouter à l'agenda") + "</span>";
    return '<div class="cal-item' + (isPast ? " past" : "") + '">' +
      '<div class="cal-date"><div class="cal-day">' + day + '</div><div class="cal-mon">' + mon + "</div></div>" +
      '<div class="cal-body"><p class="cal-title">' + esc(c.title) + '</p><div class="cal-meta">' +
        '<span class="mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' + esc(when) + "</span>" +
        (c.with ? '<span class="mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>' + esc(c.with) + "</span>" : "") +
        (c.location ? '<span class="mi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-4z"/></svg>' + esc(c.location) + "</span>" : "") +
      "</div></div>" +
      '<div class="cal-actions"><span class="cal-mode ' + m.c + '">' + L(m.t[0], m.t[1], m.t[2]) + "</span>" + actions + "</div>" +
    "</div>";
  }
  function renderCalendar() {
    var withTime = EVENTS.map(function (e) { return { e: e, d: parseStamp(e.start) }; });
    var up = withTime.filter(function (x) { return x.d && x.d.getTime() >= Date.now(); }).sort(function (a, b) { return a.d - b.d; });
    var past = withTime.filter(function (x) { return !x.d || x.d.getTime() < Date.now(); }).sort(function (a, b) { return b.d - a.d; });

    var elUp = document.getElementById("cal-upcoming");
    var elPast = document.getElementById("cal-past");
    if (elUp) elUp.innerHTML = up.length ? up.map(function (x) { return callHtml(x.e); }).join("") : emptyRow(L("No upcoming calls.", "Sin llamadas próximas.", "Aucun appel à venir."));
    if (elPast) elPast.innerHTML = past.map(function (x) { return callHtml(x.e); }).join("");

    var badge = document.getElementById("cal-badge");
    if (badge) { if (up.length) { badge.textContent = up.length; badge.hidden = false; } else { badge.hidden = true; } }

    var nx = document.getElementById("cal-next");
    if (nx) {
      if (up.length) {
        var next = up[0].e, d = up[0].d, loc = localeTag();
        var when = d.toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "short" }) + " · " + d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
        nx.style.display = "";
        nx.innerHTML =
          '<svg class="ic" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>' +
          '<div><p class="cal-next-k">' + L("Your next call", "Su próxima llamada", "Votre prochain appel") + "</p>" +
          '<p class="cal-next-v"><b>' + esc(next.title) + "</b> · " + esc(when) + "</p></div>" +
          '<span class="section-link" data-ics="' + esc(next.id) + '">' + L("Add to calendar →", "Añadir al calendario →", "Ajouter à l'agenda →") + "</span>";
      } else { nx.style.display = "none"; }
    }
  }

  /* ---------- .ics export (built from the event) ---------- */
  function downloadIcs(id) {
    var c = EVENTS.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stonewell Capital Partners//Client Portal//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:scp-call-" + c.id + "@stonewellcp.com", "DTSTAMP:" + stamp,
      "DTSTART:" + c.start, "DTEND:" + c.end,
      "SUMMARY:Stonewell — " + (c.title || ""),
      "DESCRIPTION:" + L("Call with", "Llamada con", "Appel avec") + " " + (c.with || "") + " · Stonewell Capital Partners",
      "LOCATION:" + (c.location || ""), "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    var url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = "stonewell-call-" + c.id + ".ics";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast(L("Calendar invite downloaded", "Invitación de calendario descargada", "Invitation d'agenda téléchargée"));
  }

  /* ====================================================
     Document viewer / access
     ==================================================== */
  var viewer = document.getElementById("viewer");
  var frame = document.getElementById("viewer-frame");
  function closeViewer() { viewer.classList.remove("open"); if (frame) frame.src = "about:blank"; }
  document.getElementById("viewer-close").addEventListener("click", closeViewer);
  viewer.addEventListener("click", function (e) { if (e.target === viewer) closeViewer(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeViewer(); });

  function accessDoc(id) {
    toast(L("Opening…", "Abriendo…", "Ouverture…"));
    api("/api/documents/" + encodeURIComponent(id) + "/access").then(function (r) {
      if (!r || !r.url) { toast(L("Could not open the document.", "No se pudo abrir el documento.", "Impossible d'ouvrir le document.")); return; }
      if (r.mode === "download") {
        var a = document.createElement("a");
        a.href = r.url; a.download = (r.name || "document") + ".pdf";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast(L("Download started · access recorded", "Descarga iniciada · acceso registrado", "Téléchargement lancé · accès enregistré"));
      } else {
        document.getElementById("viewer-title").textContent = r.name || "Document";
        if (frame) frame.src = r.url;
        viewer.classList.add("open");
        toast(L("Access recorded in your log", "Acceso registrado en su historial", "Accès enregistré dans votre journal"));
      }
    });
  }

  /* ---------- Toast ---------- */
  var toastEl = document.getElementById("toast"), toastTimer;
  function toast(msg) {
    document.getElementById("toast-msg").textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---------- Navigation ---------- */
  function go(page) {
    document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.toggle("active", n.getAttribute("data-page") === page); });
    document.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("active", p.getAttribute("data-page") === page); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll(".nav-item").forEach(function (n) {
    n.addEventListener("click", function () { go(n.getAttribute("data-page")); });
  });

  /* ---------- Global click delegation ---------- */
  document.body.addEventListener("click", function (e) {
    var open = e.target.closest("[data-open]");
    if (open) { accessDoc(open.getAttribute("data-open")); return; }
    var ics = e.target.closest("[data-ics]");
    if (ics) { downloadIcs(ics.getAttribute("data-ics")); return; }
    var g = e.target.closest("[data-goto]");
    if (g) { go(g.getAttribute("data-goto")); }
  });

  /* ---------- Filters ---------- */
  var filters = document.getElementById("filters");
  if (filters) {
    filters.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip"); if (!chip) return;
      var f = chip.getAttribute("data-filter");
      this.querySelectorAll(".chip").forEach(function (c) { c.classList.toggle("active", c === chip); });
      document.querySelectorAll("#all-docs .doc-row").forEach(function (r) {
        r.style.display = (f === "all" || r.getAttribute("data-cat") === f) ? "" : "none";
      });
    });
  }

  /* ---------- Language ---------- */
  function applyLang(scope) {
    (scope || document).querySelectorAll("[data-en]").forEach(function (el) {
      var v = el.getAttribute("data-" + lang); if (v !== null) el.textContent = v;
    });
    (scope || document).querySelectorAll("[data-ph-en]").forEach(function (el) {
      var v = el.getAttribute("data-ph-" + lang); if (v !== null) el.placeholder = v;
    });
  }
  function setLang(next) {
    lang = next;
    document.documentElement.lang = next;
    document.querySelectorAll(".lang-toggle button").forEach(function (b) { b.classList.toggle("active", b.dataset.lang === next); });
    try { localStorage.setItem("stonewell-lang", next); } catch (e) {}
    applyLang();
    renderProfile(); renderDocs(); renderCalendar();
  }
  document.querySelectorAll(".lang-toggle button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.dataset.lang); });
  });

  /* ---------- Logout ---------- */
  var logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", function () {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    clearCookie();
    try {
      var cfg = window.STONEWELL_AUTH || {}, SDK = window.AmazonCognitoIdentity;
      if (SDK && cfg.userPoolId && cfg.clientId) {
        var u = new SDK.CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId }).getCurrentUser();
        if (u) u.signOut();
      }
    } catch (e) {}
    window.location.replace("login.html");
  });

  /* ---------- Escape helper ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Init ---------- */
  if (lang !== "en") setLang(lang); else applyLang();

  Promise.all([
    api("/api/me").then(function (r) { ME = r || {}; }),
    api("/api/documents").then(function (r) { DOCS = (r && r.documents) || []; }),
    api("/api/calendar").then(function (r) { EVENTS = (r && r.events) || []; }),
  ]).then(function () {
    renderProfile(); renderDocs(); renderCalendar();
  });
})();
