/* ===== Dodge the TNT — Game engine (DOM-based) ===== */
(() => {
  "use strict";

  const KEY_USERNAME = "dtnt_username";
  const KEY_DIFFICULTY = "dtnt_difficulty";
  const KEY_SOUND = "dtnt_sound";
  const KEY_REDUCED_MOTION = "dtnt_reduced_motion";
  const KEY_SCORES = "dtnt_scores"; // session leaderboard

  const DIFFICULTIES = {
    easy:   { label: "Facile",  spawnMs: 700, fallSpeed: 220, sizeMin: 24, sizeMax: 44, scoreRate: 9 },
    normal: { label: "Normal",  spawnMs: 560, fallSpeed: 280, sizeMin: 26, sizeMax: 50, scoreRate: 11 },
    hard:   { label: "Difficile",spawnMs: 440, fallSpeed: 350, sizeMin: 28, sizeMax: 56, scoreRate: 13 },
    insane: { label: "Hardcore",spawnMs: 330, fallSpeed: 430, sizeMin: 30, sizeMax: 62, scoreRate: 15 }
  };

  // for...in requirement: read all difficulties (used to validate)
  const DIFF_KEYS = [];
  for (const k in DIFFICULTIES) DIFF_KEYS.push(k);

  const $ = (sel) => document.querySelector(sel);

  const container = $("#game_container");
  const playerEl = $("#player");
  const playerImg = $("#player_image");
  const playerNameEl = $("#player_username");

  // Fallback if images are missing
  if (playerImg) {
    playerImg.addEventListener("error", () => {
      playerImg.style.display = "none";
      playerEl.classList.add("fallback");
    });
  }
  const hudName = $("#hud-username");
  const hudDiff = $("#hud-difficulty");
  const hudScore = $("#hud-score");
  const hudBest = $("#hud-best");
  const pauseBtn = $("#pause_btn");

  const startOverlay = $("#start_overlay");
  const gameoverOverlay = $("#gameover_overlay");
  const finalLine = $("#final_line");
  const startBtn = $("#start_btn");
  const replayBtn = $("#replay_btn");

  const toast = $("#toast");

  // ---- Tiny sound (no external files) ----
  function createBeep() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();

    function play(freq = 440, durationMs = 80, type = "square", gain = 0.04) {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

      osc.connect(g);
      g.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationMs / 1000);
    }

    return { ctx, play };
  }

  const sfx = createBeep();

  // ---- Helpers ----
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toast.classList.add("hidden"), 1600);
  }

  function normalizeUsername(raw) {
    return String(raw ?? "").trim().replace(/\s+/g, "_").slice(0, 16);
  }

  function isValidUsername(name) {
    if (!name) return false;
    if (name.length < 3 || name.length > 16) return false;
    return /^[A-Za-z0-9_]+$/.test(name);
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function rectsOverlap(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

  function readScores() {
    try {
      const raw = sessionStorage.getItem(KEY_SCORES);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeScores(arr) {
    sessionStorage.setItem(KEY_SCORES, JSON.stringify(arr));
  }

  function bestScoreFor(name) {
    const scores = readScores();
    let best = 0;
    for (const s of scores) {
      if (s.name === name && typeof s.score === "number") best = Math.max(best, s.score);
    }
    return best;
  }

  // ---- "Classes" with prototypes ----
  function Player(el) {
    this.el = el;
    this.w = 46;
    this.h = 46;
    this.x = 0;
    this.y = 0;
    this.speed = 420; // px/s
  }

  Player.prototype.setPosition = function(x, y) {
    this.x = x; this.y = y;
    this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  Player.prototype.getRect = function() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  };

  function Obstacle(containerEl, x, y, size, speed) {
    this.x = x; this.y = y;
    this.size = size;
    this.speed = speed;
    this.el = document.createElement("div");
    this.el.className = "obstacle";
    this.el.style.width = `${size}px`;
    this.el.style.height = `${size}px`;

    const img = document.createElement("img");
    img.className = "obstacle_img";
    img.src = "image/TNT_JE3_BE2.jpg";
    img.alt = "TNT";
    img.draggable = false;
    this.el.appendChild(img);

    containerEl.appendChild(this.el);
    this.render();
  }

  Obstacle.prototype.render = function() {
    this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
  };

  Obstacle.prototype.update = function(dt) {
    this.y += this.speed * dt;
    this.render();
  };

  Obstacle.prototype.isOffscreen = function(height) {
    return this.y > height + this.size;
  };

  Obstacle.prototype.getRect = function() {
    return { x: this.x, y: this.y, w: this.size, h: this.size };
  };

  Obstacle.prototype.destroy = function() {
    this.el.remove();
  };

  function Game(containerEl) {
    this.containerEl = containerEl;
    this.player = new Player(playerEl);
    this.obstacles = [];
    this.keys = {};
    this.running = false;
    this.paused = false;

    this.score = 0;
    this.best = 0;

    this.diffKey = "normal";
    this.diff = DIFFICULTIES.normal;

    this.lastT = 0;
    this.spawnAcc = 0;

    this.bounds = { w: 0, h: 0 };
    this.soundOn = true;
    this.reducedMotion = false;
  }

  Game.prototype.applySettings = function() {
    const username = normalizeUsername(sessionStorage.getItem(KEY_USERNAME));
    const diffKey = sessionStorage.getItem(KEY_DIFFICULTY) || "normal";
    const sound = (sessionStorage.getItem(KEY_SOUND) || "1") === "1";
    const reduced = (sessionStorage.getItem(KEY_REDUCED_MOTION) || "0") === "1";

    this.soundOn = sound;
    this.reducedMotion = reduced;

    // If invalid difficulty, fallback
    this.diffKey = DIFF_KEYS.includes(diffKey) ? diffKey : "normal";
    this.diff = DIFFICULTIES[this.diffKey];

    // Validation requirement: refuse invalid pseudo -> go index
    if (!isValidUsername(username)) {
      showToast("Pseudo manquant/invalide → retour à l'accueil.");
      setTimeout(() => (window.location.href = "index.html"), 700);
      return false;
    }

    playerNameEl.textContent = username;
    hudName.textContent = username;
    hudDiff.textContent = this.diff.label;

    this.best = bestScoreFor(username);
    hudBest.textContent = String(this.best);

    // Visual theme per difficulty
    document.documentElement.dataset.diff = this.diffKey;

    // Motion preference
    document.documentElement.dataset.reducedMotion = reduced ? "1" : "0";

    return true;
  };

  Game.prototype.measure = function() {
    const r = this.containerEl.getBoundingClientRect();
    this.bounds.w = r.width;
    this.bounds.h = r.height;

    // Start position: centered bottom
    const x0 = (this.bounds.w - this.player.w) / 2;
    const y0 = this.bounds.h - this.player.h - 14;
    this.player.setPosition(x0, y0);
  };

  Game.prototype.reset = function() {
    // Remove obstacles with a while loop (requirement)
    while (this.obstacles.length > 0) {
      const o = this.obstacles.pop();
      o.destroy();
    }
    this.score = 0;
    this.spawnAcc = 0;
    hudScore.textContent = "0";
    this.measure();
  };

  Game.prototype.setPaused = function(p) {
    this.paused = p;
    pauseBtn.textContent = p ? "Reprendre" : "Pause";
    if (p) showToast("Pause");
  };

  Game.prototype.start = function() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastT = performance.now();
    requestAnimationFrame(this._tick.bind(this));
  };

  Game.prototype.stop = function() {
    this.running = false;
  };

  Game.prototype.spawnObstacle = function() {
    const d = this.diff;
    const size = Math.floor(d.sizeMin + Math.random() * (d.sizeMax - d.sizeMin + 1));
    const x = Math.floor(Math.random() * (this.bounds.w - size));
    const y = -size - 4;
    const speed = d.fallSpeed + Math.random() * 60;

    const obs = new Obstacle(this.containerEl, x, y, size, speed);
    this.obstacles.push(obs);
  };

  Game.prototype.gameOver = function() {
    this.stop();
    container.classList.add("shake");
    setTimeout(() => container.classList.remove("shake"), 340);

    if (this.soundOn && sfx) sfx.play(90, 260, "sawtooth", 0.06);

    // Save score to leaderboard (session)
    const username = normalizeUsername(sessionStorage.getItem(KEY_USERNAME));
    const scores = readScores();
    scores.push({ name: username, score: this.score, date: new Date().toISOString() });

    // Sort descending
    scores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Keep top 10 with a while loop
    while (scores.length > 10) scores.pop();

    writeScores(scores);

    // Update best on HUD
    this.best = Math.max(this.best, this.score);
    hudBest.textContent = String(this.best);

    // String formatting requirement
    finalLine.textContent = `Score final : ${String(this.score).padStart(5, "0")}`;

    gameoverOverlay.classList.remove("hidden");
  };

  Game.prototype.updatePlayer = function(dt) {
    const p = this.player;
    const speed = p.speed;

    let dx = 0, dy = 0;
    if (this.keys["ArrowLeft"] || this.keys["KeyA"]) dx -= 1;
    if (this.keys["ArrowRight"] || this.keys["KeyD"]) dx += 1;
    if (this.keys["ArrowUp"] || this.keys["KeyW"]) dy -= 1;
    if (this.keys["ArrowDown"] || this.keys["KeyS"]) dy += 1;

    // Normalize diagonal
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv; dy *= inv;
    }

    const nx = clamp(p.x + dx * speed * dt, 0, this.bounds.w - p.w);
    const ny = clamp(p.y + dy * speed * dt, 0, this.bounds.h - p.h);
    p.setPosition(nx, ny);
  };

  Game.prototype.updateObstacles = function(dt) {
    const h = this.bounds.h;

    // for...of requirement
    for (const o of this.obstacles) o.update(dt);

    // Collision + cleanup
    const pRect = this.player.getRect();

    // Use classic for loop to allow splice
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];

      if (rectsOverlap(pRect, o.getRect())) {
        this.gameOver();
        return;
      }

      if (o.isOffscreen(h)) {
        o.destroy();
        this.obstacles.splice(i, 1);
      }
    }
  };

  Game.prototype.updateScore = function(dt) {
    this.score += Math.floor(this.diff.scoreRate * dt * 10);
    hudScore.textContent = String(this.score);
  };

  Game.prototype._tick = function(t) {
    if (!this.running) return;

    const dt = Math.min(0.033, (t - this.lastT) / 1000);
    this.lastT = t;

    if (!this.paused) {
      this.updatePlayer(dt);
      this.updateObstacles(dt);
      if (!this.running) return; // game over
      this.updateScore(dt);

      // Spawn logic
      this.spawnAcc += dt * 1000;
      if (this.spawnAcc >= this.diff.spawnMs) {
        this.spawnAcc = 0;
        this.spawnObstacle();
      }
    }

    requestAnimationFrame(this._tick.bind(this));
  };

  // ---- Boot ----
  const game = new Game(container);

  function startGameFlow() {
    game.reset();
    gameoverOverlay.classList.add("hidden");
    startOverlay.classList.add("hidden");
    container.focus();
    game.start();
  }

  // Events
  window.addEventListener("resize", () => game.measure());

  document.addEventListener("keydown", (e) => {
    // Prevent page scrolling with arrows/space
    const keysToBlock = ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Space"];
    if (keysToBlock.includes(e.code)) e.preventDefault();

    // Start overlay controls
    if (!startOverlay.classList.contains("hidden")) {
      if (e.code === "Enter" || e.code === "Space") startGameFlow();
    }

    // Global shortcuts
    if (e.code === "KeyP" && game.running) game.setPaused(!game.paused);
    if (e.code === "KeyR") {
      if (!startOverlay.classList.contains("hidden") || !gameoverOverlay.classList.contains("hidden") || game.running) {
        startGameFlow();
      }
    }
    if (e.code === "KeyS") {
      game.soundOn = !game.soundOn;
      sessionStorage.setItem(KEY_SOUND, game.soundOn ? "1" : "0");
      showToast(game.soundOn ? "Sons: ON" : "Sons: OFF");
    }

    // Store pressed keys
    game.keys[e.code] = true;
  });

  document.addEventListener("keyup", (e) => {
    game.keys[e.code] = false;
  });

  pauseBtn.addEventListener("click", () => {
    if (!game.running) return;
    game.setPaused(!game.paused);
  });

  startBtn.addEventListener("click", startGameFlow);
  replayBtn.addEventListener("click", startGameFlow);

  // Apply settings, measure, show overlays
  if (game.applySettings()) {
    game.measure();
    startOverlay.classList.remove("hidden");
    gameoverOverlay.classList.add("hidden");
    hudScore.textContent = "0";
  }
})();
