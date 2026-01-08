/* ===== Dodge the TNT — Home logic ===== */
(() => {
  "use strict";

  const KEY_USERNAME = "dtnt_username";
  const KEY_DIFFICULTY = "dtnt_difficulty";
  const KEY_SOUND = "dtnt_sound";
  const KEY_REDUCED_MOTION = "dtnt_reduced_motion";
  const KEY_SCORES = "dtnt_scores"; // session leaderboard

  const $ = (sel) => document.querySelector(sel);

  const usernameInput = $("#username_input");
  const pseudoError = $("#pseudo_error");
  const playBtn = $("#play_btn");
  const resetBtn = $("#reset_scores");
  const scoreTbody = $("#score-table-body");
  const soundToggle = $("#sound_toggle");
  const reducedMotionToggle = $("#reduced_motion");

  // ---- Validation (String ops) ----
  function normalizeUsername(raw) {
    // String manipulation expected by spec
    return String(raw ?? "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 16);
  }

  function isValidUsername(name) {
    // 3–16 chars, letters/digits/underscore only
    if (!name) return false;
    if (name.length < 3 || name.length > 16) return false;
    return /^[A-Za-z0-9_]+$/.test(name);
  }

  function setError(msg) {
    pseudoError.textContent = msg || "";
  }

  function saveOptions() {
    const name = normalizeUsername(usernameInput.value);
    sessionStorage.setItem(KEY_USERNAME, name);

    const diff = document.querySelector('input[name="difficulty"]:checked')?.value || "normal";
    sessionStorage.setItem(KEY_DIFFICULTY, diff);

    sessionStorage.setItem(KEY_SOUND, soundToggle.checked ? "1" : "0");

    // Reduced motion toggle can be removed from the UI; keep behavior without breaking.
    if (reducedMotionToggle) {
      sessionStorage.setItem(KEY_REDUCED_MOTION, reducedMotionToggle.checked ? "1" : "0");
      // CSS reduced motion as user choice (independent of OS pref)
      document.documentElement.dataset.reducedMotion = reducedMotionToggle.checked ? "1" : "0";
    } else {
      const stored = sessionStorage.getItem(KEY_REDUCED_MOTION) || "0";
      sessionStorage.setItem(KEY_REDUCED_MOTION, stored);
      document.documentElement.dataset.reducedMotion = stored;
    }
  }

  function updatePlayState() {
    const name = normalizeUsername(usernameInput.value);
    const ok = isValidUsername(name);

    // if/else requirement
    if (ok) {
      setError("");
      playBtn.disabled = false;
    } else {
      playBtn.disabled = true;
      if (name.length === 0) setError("");
      else setError("Pseudo invalide.");
    }
  }

  // ---- Scores table ----
  function readScores() {
    try {
      const raw = sessionStorage.getItem(KEY_SCORES);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function formatDateShort(iso) {
    // String + Date formatting
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }

  function renderScores() {
    const scores = readScores();

    scoreTbody.textContent = "";

    if (scores.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.textContent = "Aucun score pour l'instant.";
      td.style.color = "rgba(255,255,255,.7)";
      tr.appendChild(td);
      scoreTbody.appendChild(tr);
      return;
    }

    // for...of requirement
    let rank = 1;
    for (const row of scores) {
      const tr = document.createElement("tr");

      // for...in requirement (iterate properties in display order)
      const display = { rank, name: row.name, score: row.score, date: formatDateShort(row.date) };
      for (const key in display) {
        const td = document.createElement("td");
        td.textContent = String(display[key]);
        tr.appendChild(td);
      }

      scoreTbody.appendChild(tr);
      rank += 1;
    }
  }

  // ---- Init ----
  function initFromStorage() {
    usernameInput.value = sessionStorage.getItem(KEY_USERNAME) || "";
    const storedDiff = sessionStorage.getItem(KEY_DIFFICULTY) || "normal";
    const diffInput = document.querySelector(`input[name="difficulty"][value="${storedDiff}"]`);
    if (diffInput) diffInput.checked = true;

    soundToggle.checked = (sessionStorage.getItem(KEY_SOUND) || "1") === "1";
    if (reducedMotionToggle) {
      reducedMotionToggle.checked = (sessionStorage.getItem(KEY_REDUCED_MOTION) || "0") === "1";
    }
  }

  // Event wiring
  usernameInput.addEventListener("input", () => {
    saveOptions();
    updatePlayState();
  });

  document.querySelectorAll('input[name="difficulty"]').forEach((r) =>
    r.addEventListener("change", () => {
      saveOptions();
    })
  );

  soundToggle.addEventListener("change", saveOptions);
  if (reducedMotionToggle) reducedMotionToggle.addEventListener("change", saveOptions);

  playBtn.addEventListener("click", () => {
    saveOptions();
    const name = normalizeUsername(usernameInput.value);

    if (!isValidUsername(name)) {
      setError("Choisis un pseudo valide avant de jouer.");
      usernameInput.focus();
      return;
    }
    window.location.href = "game.html";
  });

  resetBtn.addEventListener("click", () => {
    sessionStorage.removeItem(KEY_SCORES);
    renderScores();
  });

  // Start
  initFromStorage();
  saveOptions();
  updatePlayState();
  renderScores();
})();
