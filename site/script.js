/* =====================================================
   STONEWELL CAPITAL PARTNERS — interactions
   ===================================================== */
(function () {
  "use strict";

  /* ---------- 1. Language toggle (EN / ES) ---------- */
  const langButtons = document.querySelectorAll(".lang-toggle button");
  const translatable = document.querySelectorAll("[data-en]");

  function setLanguage(lang) {
    document.documentElement.lang = lang;
    translatable.forEach((el) => {
      const value = el.getAttribute("data-" + lang);
      if (value !== null) el.innerHTML = value;
    });
    langButtons.forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
    try { localStorage.setItem("stonewell-lang", lang); } catch (e) {}
  }

  langButtons.forEach((b) =>
    b.addEventListener("click", () => setLanguage(b.dataset.lang))
  );

  const SUPPORTED = ["en", "es", "fr"];
  let saved = "en";
  try { saved = localStorage.getItem("stonewell-lang") || "en"; } catch (e) {}
  if (SUPPORTED.includes(saved) && saved !== "en") setLanguage(saved);

  /* ---------- 2. Header background on scroll ---------- */
  const header = document.getElementById("site-header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- 3. Mobile menu ---------- */
  const menuBtn = document.getElementById("menu-btn");
  const nav = document.querySelector(".main-nav");
  const langToggle = document.querySelector(".lang-toggle");

  function closeMenu() {
    menuBtn.classList.remove("open");
    nav.classList.remove("open");
    langToggle.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
  }
  menuBtn.addEventListener("click", () => {
    const open = menuBtn.classList.toggle("open");
    nav.classList.toggle("open", open);
    langToggle.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));

  /* ---------- 4. Scroll reveal ---------- */
  const revealEls = document.querySelectorAll(
    ".section-title, .title-rule, .card, .approach-item, .ind-col, " +
    ".firm-copy p, .hero-copy > *, .referral, .contact-brand, .contact-body"
  );
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            entry.target.style.transitionDelay = Math.min(i * 60, 240) + "ms";
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }
})();
