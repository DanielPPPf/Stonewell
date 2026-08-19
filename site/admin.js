/* =====================================================
   STONEWELL — Admin Console (staff only)
   Same Cognito login as clients; the edge gate (/admin*) and the
   admin API both require the stonewell-staff group. This script
   manages clients, documents, figures and calls via /api/admin/*.
   ===================================================== */
(function () {
  "use strict";

  var TOKEN_KEY = "stonewell-id-token";
  var API = (window.STONEWELL_API && window.STONEWELL_API.base) || "";

  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function decodeJwt(t) { try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return null; } }

  /* ---------- Guard: valid token + staff group ---------- */
  var token = getToken();
  var claims = token ? decodeJwt(token) : null;
  if (!claims || !claims.exp || Date.now() >= claims.exp * 1000) { window.location.replace("login.html"); return; }
  var groups = claims["cognito:groups"] || [];
  if (!Array.isArray(groups)) groups = String(groups).replace(/^\[|\]$/g, "").split(/[\s,]+/);
  if (groups.indexOf("stonewell-staff") === -1) { window.location.replace("portal.html"); return; }

  document.getElementById("who").textContent = claims.email || claims["cognito:username"] || "staff";

  /* ---------- API helpers ---------- */
  function authH(extra) { return Object.assign({ Authorization: "Bearer " + getToken() }, extra || {}); }
  function apiGet(path) { return fetch(API + path, { headers: authH() }).then(function (r) { return r.json(); }); }
  function apiSend(method, path, body) {
    return fetch(API + path, { method: method, headers: authH({ "Content-Type": "application/json" }), body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }
  function note(id, msg, ok) {
    var el = document.getElementById(id);
    el.innerHTML = msg;
    el.className = "note show " + (ok === false ? "err" : (ok === true ? "ok" : ""));
  }
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- State ---------- */
  var current = null; // selected client profile

  /* ---------- Clients ---------- */
  function loadClients(selectSub) {
    apiGet("/api/admin/clients").then(function (r) {
      var list = (r && r.clients) || [];
      var ul = $("client-list");
      if (!list.length) { ul.innerHTML = '<li class="muted" style="cursor:default;">No clients yet.</li>'; return; }
      ul.innerHTML = list.map(function (c) {
        return '<li data-sub="' + c.sub + '"><b>' + escapeHtml(c.name || c.email || c.sub) + "</b>" +
          "<span>" + escapeHtml(c.email || "") + (c.memberId ? " · " + escapeHtml(c.memberId) : "") + "</span></li>";
      }).join("");
      ul.querySelectorAll("li[data-sub]").forEach(function (li) {
        li.addEventListener("click", function () {
          var sub = li.getAttribute("data-sub");
          var prof = list.filter(function (x) { return x.sub === sub; })[0];
          selectClient(prof);
          ul.querySelectorAll("li").forEach(function (n) { n.classList.toggle("active", n === li); });
        });
      });
      if (selectSub) {
        var li = ul.querySelector('li[data-sub="' + selectSub + '"]');
        if (li) li.click();
      }
    });
  }

  function selectClient(prof) {
    current = prof;
    $("new-client-card").classList.add("hidden");
    $("selected-panels").classList.remove("hidden");
    $("sel-name").textContent = prof.name || prof.email || prof.sub;
    var m = prof.metrics || {};
    $("mt-cv").value = (m.committedCapital && m.committedCapital.value) || "";
    $("mt-cs").value = (m.committedCapital && m.committedCapital.sub) || "";
    $("mt-nv").value = (m.nav && m.nav.value) || "";
    $("mt-ns").value = (m.nav && m.nav.sub) || "";
    $("mt-up").checked = !!(m.nav && m.nav.up);
    $("mt-xv").value = (m.nextCall && m.nextCall.value) || "";
    $("mt-xs").value = (m.nextCall && m.nextCall.sub) || "";
    $("up-list").innerHTML = "";
    ["mt-note", "up-note", "ev-note"].forEach(function (n) { $(n).className = "note"; });
  }

  /* ---------- New client ---------- */
  $("new-client-toggle").addEventListener("click", function () {
    $("new-client-card").classList.toggle("hidden");
    $("selected-panels").classList.add("hidden");
    document.querySelectorAll("#client-list li").forEach(function (n) { n.classList.remove("active"); });
  });

  $("nc-create").addEventListener("click", function () {
    var email = $("nc-email").value.trim();
    if (!email) { note("nc-note", "Email is required.", false); return; }
    var body = {
      email: email,
      name: $("nc-name").value.trim(),
      greetingName: $("nc-greet").value.trim(),
      memberId: $("nc-member").value.trim(),
      partner: { initials: $("nc-pini").value.trim(), name: $("nc-pname").value.trim(), title: $("nc-ptitle").value.trim() },
    };
    note("nc-note", "Creating…");
    apiSend("POST", "/api/admin/clients", body).then(function (res) {
      if (!res.ok) { note("nc-note", "Failed: " + (res.data.error || res.status), false); return; }
      var pw = res.data.tempPassword;
      note("nc-note", "Client created. " + (pw ? "<br><b>One-time password:</b> <code>" + escapeHtml(pw) + "</code> — share it securely; it won't be shown again." : ""), true);
      ["nc-email", "nc-name", "nc-greet", "nc-member", "nc-pini", "nc-pname", "nc-ptitle"].forEach(function (id) { $(id).value = ""; });
      loadClients(res.data.sub);
    });
  });

  /* ---------- Save figures ---------- */
  $("mt-save").addEventListener("click", function () {
    if (!current) return;
    var metrics = {
      committedCapital: { value: $("mt-cv").value.trim(), sub: $("mt-cs").value.trim() },
      nav: { value: $("mt-nv").value.trim(), sub: $("mt-ns").value.trim(), up: $("mt-up").checked },
      nextCall: { value: $("mt-xv").value.trim(), sub: $("mt-xs").value.trim() },
    };
    note("mt-note", "Saving…");
    apiSend("PUT", "/api/admin/clients/" + current.sub + "/metrics", { metrics: metrics }).then(function (res) {
      if (!res.ok) { note("mt-note", "Failed: " + (res.data.error || res.status), false); return; }
      current.metrics = metrics;
      note("mt-note", "Figures saved.", true);
    });
  });

  /* ---------- Upload document ---------- */
  $("up-send").addEventListener("click", function () {
    if (!current) return;
    var name = $("up-name").value.trim();
    var file = $("up-file").files[0];
    if (!name) { note("up-note", "Title is required.", false); return; }
    if (!file) { note("up-note", "Choose a PDF file.", false); return; }
    var tags = []; if ($("up-nda").value) tags.push($("up-nda").value);
    var meta = {
      name: name, category: $("up-cat").value, security: $("up-sec").value,
      date: $("up-date").value.trim() || undefined, tags: tags, contentType: "application/pdf",
    };
    note("up-note", "Requesting upload…");
    apiSend("POST", "/api/admin/clients/" + current.sub + "/documents", meta).then(function (res) {
      if (!res.ok) { note("up-note", "Failed: " + (res.data.error || res.status), false); return; }
      note("up-note", "Uploading file…");
      fetch(res.data.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file })
        .then(function (put) {
          if (!put.ok) { note("up-note", "Upload failed (" + put.status + ").", false); return; }
          note("up-note", "Document posted to the data room.", true);
          var li = document.createElement("div");
          li.className = "doc-mini";
          li.innerHTML = "<span>" + escapeHtml(name) + "</span><span class='muted'>" + escapeHtml(meta.security) + "</span>";
          $("up-list").prepend(li);
          $("up-name").value = ""; $("up-date").value = ""; $("up-file").value = "";
        })
        .catch(function () { note("up-note", "Upload failed (network).", false); });
    });
  });

  /* ---------- Schedule call ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function toStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "00Z";
  }
  $("ev-send").addEventListener("click", function () {
    if (!current) return;
    var when = $("ev-start").value;
    if (!when) { note("ev-note", "Pick a date & time.", false); return; }
    var start = new Date(when);
    var dur = parseInt($("ev-dur").value, 10) || 45;
    var end = new Date(start.getTime() + dur * 60000);
    var body = {
      title: $("ev-title").value.trim(), with: $("ev-with").value.trim(),
      mode: $("ev-mode").value, location: $("ev-loc").value.trim(),
      start: toStamp(start), end: toStamp(end),
    };
    note("ev-note", "Scheduling…");
    apiSend("POST", "/api/admin/clients/" + current.sub + "/events", body).then(function (res) {
      if (!res.ok) { note("ev-note", "Failed: " + (res.data.error || res.status), false); return; }
      note("ev-note", "Call scheduled.", true);
      $("ev-title").value = ""; $("ev-with").value = ""; $("ev-loc").value = "";
    });
  });

  /* ---------- Logout ---------- */
  $("logout-btn").addEventListener("click", function () {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    document.cookie = "stonewell_idt=; Path=/; Max-Age=0; Secure; SameSite=Strict";
    try {
      var cfg = window.STONEWELL_AUTH || {}, SDK = window.AmazonCognitoIdentity;
      if (SDK && cfg.userPoolId && cfg.clientId) {
        var u = new SDK.CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId }).getCurrentUser();
        if (u) u.signOut();
      }
    } catch (e) {}
    window.location.replace("login.html");
  });

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  /* ---------- Init ---------- */
  loadClients();
})();
