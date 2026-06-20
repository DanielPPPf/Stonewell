/* =====================================================
   STONEWELL CAPITAL PARTNERS — Client Portal (beta)
   -----------------------------------------------------
   Client-side session guard: requires a valid, unexpired
   Cognito ID token (stored at login). Without one, redirect
   to the login page. NOTE: this is a UX gate — truly private
   content would be served through an authenticated backend.
   ===================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "stonewell-id-token";
  const COOKIE_KEY = "stonewell_idt";

  function clearSessionCookie() {
    document.cookie = COOKIE_KEY + "=; Path=/; Max-Age=0; Secure; SameSite=Strict";
  }

  /* ---------- JWT helpers ---------- */
  function decodeJwt(token) {
    try {
      const payload = token.split(".")[1];
      const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch (e) {
      return null;
    }
  }

  function getValidClaims() {
    let token = null;
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
    if (!token) return null;
    const claims = decodeJwt(token);
    if (!claims || !claims.exp) return null;
    if (Date.now() >= claims.exp * 1000) return null; // expired
    return claims;
  }

  /* ---------- Guard ---------- */
  const claims = getValidClaims();
  if (!claims) {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    clearSessionCookie();
    window.location.replace("login.html");
    return;
  }

  /* ---------- Populate ---------- */
  const emailEl = document.getElementById("portal-email");
  if (emailEl) emailEl.textContent = claims.email || claims["cognito:username"] || "—";

  /* ---------- Language toggle (mirrors the rest of the site) ---------- */
  const langButtons = document.querySelectorAll(".lang-toggle button");
  const translatable = document.querySelectorAll("[data-en]");
  function setLanguage(next) {
    document.documentElement.lang = next;
    translatable.forEach((el) => {
      const v = el.getAttribute("data-" + next);
      if (v !== null) el.textContent = v;
    });
    langButtons.forEach((b) => b.classList.toggle("active", b.dataset.lang === next));
    try { localStorage.setItem("stonewell-lang", next); } catch (e) {}
  }
  langButtons.forEach((b) => b.addEventListener("click", () => setLanguage(b.dataset.lang)));
  let saved = "en";
  try { saved = localStorage.getItem("stonewell-lang") || "en"; } catch (e) {}
  if (saved === "es") setLanguage("es");

  /* ---------- Sign out ---------- */
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      // Clear local session
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
      clearSessionCookie();
      // Best-effort global Cognito sign-out
      try {
        const cfg = window.STONEWELL_AUTH || {};
        const SDK = window.AmazonCognitoIdentity;
        if (SDK && cfg.userPoolId && cfg.clientId) {
          const pool = new SDK.CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId });
          const u = pool.getCurrentUser();
          if (u) u.signOut();
        }
      } catch (e) {}
      window.location.replace("login.html");
    });
  }
})();
