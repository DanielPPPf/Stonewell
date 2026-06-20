/* =====================================================
   STONEWELL CAPITAL PARTNERS — Client Login
   -----------------------------------------------------
   Real authentication against AWS Cognito (USER_PASSWORD_AUTH)
   with MANDATORY TOTP MFA:
     • first sign-in  → software-token enrollment (QR + secret)
     • later sign-ins → 6-digit TOTP challenge
   On success the ID token (JWT) is kept in sessionStorage AND
   in a Secure cookie (read by the Lambda@Edge gate on /portal*).
   Public pool/client IDs come from assets/auth-config.js.
   See AUTH.md / deploy/README.md.
   ===================================================== */
(function () {
  "use strict";

  /* ---------- i18n strings ---------- */
  const I18N = {
    en: {
      required:    "This field is required.",
      emailFormat: "Please enter a valid email address.",
      pwShort:     "Password must be at least 8 characters.",
      badCreds:    "Invalid email or password. Please try again.",
      locked:      "Too many attempts. Please try again later.",
      network:     "We could not reach the server. Please try again.",
      success:     "Signed in. Redirecting…",
      forgot:      "Password resets are handled by your Stonewell contact. Please reach out through your existing relationship.",
      codeFormat:  "Enter the 6-digit code.",
      mfaBadCode:  "That code is not valid. Please try again.",
    },
    es: {
      required:    "Este campo es obligatorio.",
      emailFormat: "Por favor ingrese un correo electrónico válido.",
      pwShort:     "La contraseña debe tener al menos 8 caracteres.",
      badCreds:    "Correo o contraseña inválidos. Intente de nuevo.",
      locked:      "Demasiados intentos. Intente más tarde.",
      network:     "No pudimos conectar con el servidor. Intente de nuevo.",
      success:     "Sesión iniciada. Redirigiendo…",
      forgot:      "Los restablecimientos de contraseña se gestionan a través de su contacto en Stonewell. Por favor comuníquese mediante su relación existente.",
      codeFormat:  "Ingrese el código de 6 dígitos.",
      mfaBadCode:  "Ese código no es válido. Intente de nuevo.",
    },
  };

  let lang = "en";
  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

  /* ---------- Language toggle (mirrors index.html) ---------- */
  const langButtons = document.querySelectorAll(".lang-toggle button");
  const translatable = document.querySelectorAll("[data-en]");

  function setLanguage(next) {
    lang = next;
    document.documentElement.lang = next;

    translatable.forEach((el) => {
      const value = el.getAttribute("data-" + next);
      if (value !== null) el.textContent = value;
    });
    document.querySelectorAll("[data-ph-" + next + "]").forEach((el) => {
      el.setAttribute("placeholder", el.getAttribute("data-ph-" + next));
    });

    langButtons.forEach((b) => b.classList.toggle("active", b.dataset.lang === next));
    syncPwToggleLabel();
    try { localStorage.setItem("stonewell-lang", next); } catch (e) {}
  }

  langButtons.forEach((b) =>
    b.addEventListener("click", () => setLanguage(b.dataset.lang))
  );

  /* ---------- Elements ---------- */
  const form        = document.getElementById("login-form");
  const emailEl     = document.getElementById("email");
  const pwEl        = document.getElementById("password");
  const submitBtn   = document.getElementById("submit-btn");
  const alertEl     = document.getElementById("auth-alert");
  const togglePw    = document.getElementById("toggle-pw");
  const forgotEl    = document.getElementById("forgot-link");
  const authIntro   = document.querySelector(".auth-intro");

  // MFA — enrollment (first sign-in)
  const mfaSetupForm  = document.getElementById("mfa-setup-form");
  const mfaSetupCode  = document.getElementById("mfa-setup-code");
  const mfaSetupBtn   = document.getElementById("mfa-setup-btn");
  const mfaQrEl       = document.getElementById("mfa-qr");
  const mfaSecretEl   = document.getElementById("mfa-secret");
  // MFA — challenge (subsequent sign-ins)
  const mfaForm       = document.getElementById("mfa-challenge-form");
  const mfaCode       = document.getElementById("mfa-code");
  const mfaBtn        = document.getElementById("mfa-btn");

  const TOTP_ISSUER = "Stonewell Capital Partners";

  /* ---------- Show / hide password ---------- */
  function syncPwToggleLabel() {
    const showing = pwEl.type === "text";
    const key = showing ? "data-hide-" + lang : "data-show-" + lang;
    togglePw.textContent = togglePw.getAttribute(key);
    togglePw.setAttribute("aria-pressed", String(showing));
    togglePw.setAttribute("aria-label", showing ? "Hide password" : "Show password");
  }
  togglePw.addEventListener("click", () => {
    pwEl.type = pwEl.type === "password" ? "text" : "password";
    syncPwToggleLabel();
    pwEl.focus();
  });

  /* ---------- Apply saved language (after elements + toggle exist) ---------- */
  let saved = "en";
  try { saved = localStorage.getItem("stonewell-lang") || "en"; } catch (e) {}
  setLanguage(saved === "es" ? "es" : "en");

  /* ---------- Alerts ---------- */
  function showAlert(message, kind) {
    alertEl.textContent = message;
    alertEl.className = "auth-alert " + (kind || "error");
    alertEl.hidden = false;
  }
  function clearAlert() {
    alertEl.hidden = true;
    alertEl.textContent = "";
  }

  /* ---------- Field validation ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setFieldError(input, message) {
    const field = input.closest(".field");
    const errEl = document.getElementById(input.id + "-error");
    if (message) {
      field.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      if (errEl) errEl.textContent = message;
    } else {
      field.classList.remove("invalid");
      input.removeAttribute("aria-invalid");
      if (errEl) errEl.textContent = "";
    }
  }

  function validateEmail() {
    const v = emailEl.value.trim();
    if (!v) return setFieldError(emailEl, t("required")), false;
    if (!EMAIL_RE.test(v)) return setFieldError(emailEl, t("emailFormat")), false;
    return setFieldError(emailEl, ""), true;
  }
  function validatePassword() {
    const v = pwEl.value;
    if (!v) return setFieldError(pwEl, t("required")), false;
    if (v.length < 8) return setFieldError(pwEl, t("pwShort")), false;
    return setFieldError(pwEl, ""), true;
  }
  function validateCode(input) {
    const v = input.value.trim();
    if (!/^[0-9]{6}$/.test(v)) return setFieldError(input, t("codeFormat")), false;
    return setFieldError(input, ""), true;
  }

  emailEl.addEventListener("blur", validateEmail);
  pwEl.addEventListener("blur", validatePassword);
  [emailEl, pwEl].forEach((el) =>
    el.addEventListener("input", () => {
      if (el.closest(".field").classList.contains("invalid")) {
        el === emailEl ? validateEmail() : validatePassword();
      }
    })
  );

  /* ---------- Loading state (per button) ---------- */
  function setLoading(btn, inputs, on) {
    btn.disabled = on;
    btn.classList.toggle("loading", on);
    inputs.forEach((el) => { el.disabled = on; });
  }
  function clearAllLoading() {
    setLoading(submitBtn, [emailEl, pwEl], false);
    setLoading(mfaSetupBtn, [mfaSetupCode], false);
    setLoading(mfaBtn, [mfaCode], false);
  }

  /* ---------- Step switching ---------- */
  function showStep(step) {
    form.hidden = step !== "login";
    mfaSetupForm.hidden = step !== "setup";
    mfaForm.hidden = step !== "challenge";
    if (authIntro) authIntro.hidden = step !== "login";
  }

  /* ---------- QR rendering (offline, vendored qrcode-generator) ---------- */
  function renderQr(container, text) {
    container.innerHTML = "";
    try {
      const qr = window.qrcode(0, "M"); // auto version, error-correction M
      qr.addData(text);
      qr.make();
      container.innerHTML = qr.createImgTag(5, 8); // cellSize, margin
    } catch (e) { /* fall back to manual secret entry */ }
  }

  /* =====================================================
     Cognito wiring
     ===================================================== */
  let pendingUser = null; // CognitoUser awaiting an MFA step

  function getPool() {
    const cfg = window.STONEWELL_AUTH || {};
    const SDK = window.AmazonCognitoIdentity;
    if (!SDK || !cfg.userPoolId || !cfg.clientId) return null;
    return new SDK.CognitoUserPool({ UserPoolId: cfg.userPoolId, ClientId: cfg.clientId });
  }

  function setSessionCookie(jwt) {
    // Read by the Lambda@Edge gate on /portal*. Signature is verified at the
    // edge, so this JS-set cookie cannot be forged. ~1h, matches the ID token.
    document.cookie =
      "stonewell_idt=" + jwt + "; Path=/; Max-Age=3600; Secure; SameSite=Strict";
  }

  function finishLogin(session) {
    const jwt = session.getIdToken().getJwtToken();
    try { sessionStorage.setItem("stonewell-id-token", jwt); } catch (e) {}
    setSessionCookie(jwt);
    clearAlert();
    showAlert(t("success"), "success");
    window.location.href = "portal.html";
  }

  function handleAuthFailure(err) {
    const code = (err && err.code) || "";
    let reason = "network";
    if (code === "NotAuthorizedException" || code === "UserNotFoundException") reason = "badCreds";
    else if (code === "CodeMismatchException" || code === "EnableSoftwareTokenMFAException") reason = "mfaBadCode";
    else if (code === "TooManyRequestsException" || code === "LimitExceededException" || code === "PasswordResetRequiredException") reason = "locked";
    clearAllLoading();
    showAlert(t(reason), "error");
  }

  // Single callbacks object reused across authenticateUser / associateSoftwareToken /
  // verifySoftwareToken / sendMFACode (Cognito ignores keys it doesn't need).
  const cognitoCallbacks = {
    onSuccess(session) { finishLogin(session); },
    onFailure(err) { handleAuthFailure(err); },

    // First sign-in: pool requires MFA but user has no TOTP yet → enroll.
    mfaSetup() {
      if (pendingUser) pendingUser.associateSoftwareToken(cognitoCallbacks);
    },
    associateSecretCode(secret) {
      const email = emailEl.value.trim();
      const otpauth =
        "otpauth://totp/" + encodeURIComponent(TOTP_ISSUER + ":" + email) +
        "?secret=" + secret +
        "&issuer=" + encodeURIComponent(TOTP_ISSUER);
      renderQr(mfaQrEl, otpauth);
      mfaSecretEl.textContent = secret;
      clearAllLoading();
      clearAlert();
      showStep("setup");
      mfaSetupCode.focus();
    },

    // Later sign-ins: already enrolled → ask for the 6-digit code.
    totpRequired() {
      clearAllLoading();
      clearAlert();
      showStep("challenge");
      mfaCode.focus();
    },
  };

  function startLogin(email, password) {
    const pool = getPool();
    const SDK = window.AmazonCognitoIdentity;
    if (!pool) { handleAuthFailure({ code: "network" }); return; }

    pendingUser = new SDK.CognitoUser({ Username: email, Pool: pool });
    pendingUser.setAuthenticationFlowType("USER_PASSWORD_AUTH");
    const details = new SDK.AuthenticationDetails({ Username: email, Password: password });
    pendingUser.authenticateUser(details, cognitoCallbacks);
  }

  /* ---------- Submit: credentials ---------- */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearAlert();
    const okEmail = validateEmail();
    const okPw = validatePassword();
    if (!okEmail || !okPw) { (!okEmail ? emailEl : pwEl).focus(); return; }
    setLoading(submitBtn, [emailEl, pwEl], true);
    startLogin(emailEl.value.trim(), pwEl.value);
  });

  /* ---------- Submit: TOTP enrollment ---------- */
  mfaSetupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearAlert();
    if (!validateCode(mfaSetupCode)) { mfaSetupCode.focus(); return; }
    if (!pendingUser) { showStep("login"); return; }
    setLoading(mfaSetupBtn, [mfaSetupCode], true);
    // friendlyDeviceName "Stonewell"; on success Cognito completes sign-in.
    pendingUser.verifySoftwareToken(mfaSetupCode.value.trim(), "Stonewell", cognitoCallbacks);
  });

  /* ---------- Submit: TOTP challenge ---------- */
  mfaForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearAlert();
    if (!validateCode(mfaCode)) { mfaCode.focus(); return; }
    if (!pendingUser) { showStep("login"); return; }
    setLoading(mfaBtn, [mfaCode], true);
    pendingUser.sendMFACode(mfaCode.value.trim(), cognitoCallbacks, "SOFTWARE_TOKEN_MFA");
  });

  /* ---------- Forgot password ---------- */
  forgotEl.addEventListener("click", (e) => {
    e.preventDefault();
    showAlert(t("forgot"), "success");
  });
})();
