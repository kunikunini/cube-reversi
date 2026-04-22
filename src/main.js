import "./style.css";

/* =============================================================
   NEO REVERSI — logic
   6 faces × 3×3 = 54 cells. Each face is an independent Reversi
   board. Players alternate; whoever puts a legal move on ANY
   face first places that stone. Elapsed-time display per player.
   ============================================================= */

(() => {
  // ---------------- Config ----------------
  const FACES = ["front", "right", "back", "left", "top", "bottom"];
  const FACE_LABEL = {
    front: "FRONT·01",
    right: "RIGHT·02",
    back: "BACK·03",
    left: "LEFT·04",
    top: "TOP·05",
    bottom: "BOT·06",
  };
  const EMPTY = 0,
    P1 = 1,
    P2 = 2;

  const FACE_TRANSFORMS = {
    front: "rotateY(  0deg) translateZ(var(--half))",
    back: "rotateY(180deg) translateZ(var(--half))",
    right: "rotateY( 90deg) translateZ(var(--half))",
    left: "rotateY(-90deg) translateZ(var(--half))",
    top: "rotateX( 90deg) translateZ(var(--half))",
    bottom: "rotateX(-90deg) translateZ(var(--half))",
  };

  const DIRS = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];

  const state = {
    boards: {},
    turn: P1,
    elapsed: { 1: 0, 2: 0 }, // seconds each player has spent
    timerId: null,
    lastTick: 0,
    rotX: -25,
    rotY: -35,
    dragStartX: 0,
    dragStartY: 0,
    dragStartRotX: 0,
    dragStartRotY: 0,
    dragging: false,
    gameOver: false,
    aiThinking: false,
    aiTimer: null,
    muted: false,
    difficulty: "easy", // 'easy' | 'normal' | 'hard'
    history: [], // snapshots for undo
    scale: 1.0,
    pointers: new Map(),
    initialDist: 0,
    initialScale: 1.0,
    vx: 0, vy: 0,
    lastMouseX: 0, lastMouseY: 0,
    isInertia: false,
  };

  const $ = (id) => document.getElementById(id);
  const launcherEl = $("launcher");
  const cubeEl = $("cube");
  const stageEl = $("stage");
  const statusEl = $("status");
  const p1ScoreEl = $("p1Score"),
    p2ScoreEl = $("p2Score");
  const p1TimerEl = $("p1Timer"),
    p2TimerEl = $("p2Timer");
  const p1PanelEl = $("p1Panel"),
    p2PanelEl = $("p2Panel");
  const overlayEl = $("overlay");
  const outcomeText = $("outcomeText");
  const finalP1 = $("finalP1"),
    finalP2 = $("finalP2");
  const toastEl = $("toast");
  const faceTabsEl = $("faceTabs");

  function makeEmptyBoard() {
    return [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
  }
  function resetBoards() {
    state.boards = {};
    for (const f of FACES) state.boards[f] = makeEmptyBoard();
    const b = state.boards["front"];
    b[0][0] = P1;
    b[0][1] = P2;
    b[1][0] = P2;
    b[1][1] = P1;
  }

  function buildCube() {
    cubeEl.innerHTML = "";
    let cellNumber = 1;
    for (const f of FACES) {
      const face = document.createElement("div");
      face.className = "face";
      face.dataset.face = f;
      face.style.transform = FACE_TRANSFORMS[f];

      const inner = document.createElement("div");
      inner.className = "face-inner";

      const label = document.createElement("div");
      label.className = "face-label";
      label.textContent = FACE_LABEL[f];
      inner.appendChild(label);

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.dataset.face = f;
          cell.dataset.r = r;
          cell.dataset.c = c;
          const num = document.createElement("span");
          num.className = "cell-num";
          num.textContent = cellNumber++;
          cell.appendChild(num);
          inner.appendChild(cell);
        }
      }
      face.appendChild(inner);
      cubeEl.appendChild(face);
    }
    sizeCube();
  }

  function sizeCube() {
    const size = stageEl.getBoundingClientRect().width;
    cubeEl.style.setProperty("--half", `${size * 0.36}px`);
  }
  window.addEventListener("resize", sizeCube);

  function buildFaceTabs() {
    faceTabsEl.innerHTML = "";
    const labels = [
      { f: "front", t: "FRONT" },
      { f: "right", t: "RIGHT" },
      { f: "back", t: "BACK" },
      { f: "left", t: "LEFT" },
      { f: "top", t: "TOP" },
      { f: "bottom", t: "BOT" },
    ];
    for (const l of labels) {
      const b = document.createElement("button");
      b.className = "tab";
      b.textContent = l.t;
      b.dataset.face = l.f;
      b.addEventListener("click", () => snapToFace(l.f));
      faceTabsEl.appendChild(b);
    }
  }

  function snapToFace(face) {
    const preset = {
      front: { x: -10, y: -15 },
      right: { x: -10, y: -105 },
      back: { x: -10, y: -195 },
      left: { x: -10, y: 75 },
      top: { x: -80, y: -15 },
      bottom: { x: 70, y: -15 },
    };
    const p = preset[face];
    if (!p) return;
    state.rotX = p.x;
    state.rotY = p.y;
    applyRotation(true);
    updateActiveTab();
  }

  function updateActiveTab() {
    const current = closestFace();
    [...faceTabsEl.children].forEach((el) => {
      el.classList.toggle("active", el.dataset.face === current);
    });
  }

  function closestFace() {
    const normals = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, -1, 0],
      bottom: [0, 1, 0],
    };
    const rx = (state.rotX * Math.PI) / 180;
    const ry = (state.rotY * Math.PI) / 180;
    function rotate(v) {
      let [x, y, z] = v;
      const cy = Math.cos(ry),
        sy = Math.sin(ry);
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      x = x1;
      z = z1;
      const cx = Math.cos(rx),
        sx = Math.sin(rx);
      const y1 = y * cx - z * sx;
      const z2 = y * sx + z * cx;
      y = y1;
      z = z2;
      return [x, y, z];
    }
    let best = null,
      bestZ = -Infinity;
    for (const f of FACES) {
      const z = rotate(normals[f])[2];
      if (z > bestZ) {
        bestZ = z;
        best = f;
      }
    }
    return best;
  }

  function applyRotation(smooth = false) {
    if (smooth) cubeEl.classList.remove("dragging");
    else cubeEl.classList.add("dragging");
    cubeEl.style.transform = `scale(${state.scale}) rotateX(${state.rotX}deg) rotateY(${state.rotY}deg)`;
    updateActiveTab();
  }

  stageEl.addEventListener("pointerdown", (e) => {
    state.pointers.set(e.pointerId, e);
    state.isInertia = false;
    state.vx = 0; state.vy = 0;
    
    if (state.pointers.size === 1) {
      state.dragStartX = e.clientX;
      state.dragStartY = e.clientY;
      state.lastMouseX = e.clientX;
      state.lastMouseY = e.clientY;
      state.dragStartRotX = state.rotX;
      state.dragStartRotY = state.rotY;
      state.dragging = false;
    } else if (state.pointers.size === 2) {
      const pts = Array.from(state.pointers.values());
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      state.initialDist = dist > 5 ? dist : 5; // Prevent division by zero
      state.initialScale = state.scale;
      state.dragging = false; // Stop rotation when second finger added
    }
  });

  stageEl.addEventListener("pointermove", (e) => {
    if (!state.pointers.has(e.pointerId)) return;
    state.pointers.set(e.pointerId, e);

    if (state.pointers.size === 2) {
      const pts = Array.from(state.pointers.values());
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (state.initialDist > 5) {
        state.scale = clamp(state.initialScale * (dist / state.initialDist), 0.5, 1.4);
        applyRotation();
      }
      return;
    }

    if (state.pointers.size === 1) {
      const dx = e.clientX - state.dragStartX;
      const dy = e.clientY - state.dragStartY;
      
      const instantaneousVX = (e.clientY - state.lastMouseY) * 0.4;
      const instantaneousVY = (e.clientX - state.lastMouseX) * 0.4;
      state.vx = state.vx * 0.7 + instantaneousVX * 0.3;
      state.vy = state.vy * 0.7 + instantaneousVY * 0.3;
      state.lastMouseX = e.clientX;
      state.lastMouseY = e.clientY;

      if (!state.dragging && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        state.dragging = true;
        cubeEl.classList.add("dragging");
        try { stageEl.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (state.dragging) {
        state.rotY = state.dragStartRotY + dx * 0.5;
        state.rotX = clamp(state.dragStartRotX - dy * 0.5, -85, 85);
        applyRotation();
      }
    }
  });

  function endDrag(e) {
    const wasDrag = state.dragging;
    state.pointers.delete(e.pointerId);
    if (state.pointers.size === 0) {
      if (wasDrag) {
        state.dragging = false;
        state.isInertia = true;
        cubeEl.classList.remove("dragging");
      } else {
        // Tap detected — find cell under pointer via elementFromPoint
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) {
          const cell = el.closest(".cell");
          if (cell) handleCellTap(cell);
        }
      }
      state.initialDist = 0;
    } else {
      // If fingers remain, reset rotation origin to prevent jumps
      const last = Array.from(state.pointers.values())[0];
      state.dragStartX = last.clientX;
      state.dragStartY = last.clientY;
      state.lastMouseX = last.clientX;
      state.lastMouseY = last.clientY;
      state.dragStartRotX = state.rotX;
      state.dragStartRotY = state.rotY;
      state.initialDist = 0;
      if (state.pointers.size === 1) {
        state.dragging = false;
      }
    }
  }

  stageEl.addEventListener("pointerup", endDrag);
  stageEl.addEventListener("pointercancel", (e) => {
    state.pointers.clear();
    state.dragging = false;
    state.initialDist = 0;
    cubeEl.classList.remove("dragging");
  });

  stageEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    state.scale = clamp(state.scale + delta, 0.5, 1.3);
    applyRotation(true);
  }, { passive: false });

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function animate() {
    if (state.isInertia) {
      state.rotY += state.vy;
      state.rotX = clamp(state.rotX - state.vx, -85, 85);
      state.vy *= 0.95;
      state.vx *= 0.95;
      applyRotation();
      if (Math.abs(state.vx) < 0.05 && Math.abs(state.vy) < 0.05) {
        state.isInertia = false;
        updateActiveTab();
      }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  document.querySelectorAll(".rotate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = btn.dataset.rot;
      const step = 90;
      if (dir === "left") state.rotY -= step;
      if (dir === "right") state.rotY += step;
      if (dir === "up") state.rotX = clamp(state.rotX + step, -85, 85);
      if (dir === "down") state.rotX = clamp(state.rotX - step, -85, 85);
      applyRotation(true);
    });
  });

  function opposite(p) {
    return p === P1 ? P2 : P1;
  }

  // Cross-face edge traversal.
  function crossEdge(face, r, c, dr, dc) {
    if (dr === -1 && r === 0) {
      // exit top edge
      switch (face) {
        case "front":
          return { face: "top", r: 2, c: c, dr: -1, dc: 0 };
        case "right":
          return { face: "top", r: 2 - c, c: 2, dr: 0, dc: -1 };
        case "back":
          return { face: "top", r: 0, c: 2 - c, dr: 1, dc: 0 };
        case "left":
          return { face: "top", r: c, c: 0, dr: 0, dc: 1 };
        case "top":
          return { face: "back", r: 0, c: 2 - c, dr: 1, dc: 0 };
        case "bottom":
          return { face: "front", r: 2, c: c, dr: -1, dc: 0 };
      }
    }
    if (dr === 1 && r === 2) {
      // exit bottom edge
      switch (face) {
        case "front":
          return { face: "bottom", r: 0, c: c, dr: 1, dc: 0 };
        case "right":
          return { face: "bottom", r: c, c: 2, dr: 0, dc: -1 };
        case "back":
          return { face: "bottom", r: 2, c: 2 - c, dr: -1, dc: 0 };
        case "left":
          return { face: "bottom", r: 2 - c, c: 0, dr: 0, dc: 1 };
        case "top":
          return { face: "front", r: 0, c: c, dr: 1, dc: 0 };
        case "bottom":
          return { face: "back", r: 2, c: 2 - c, dr: -1, dc: 0 };
      }
    }
    if (dc === 1 && c === 2) {
      // exit right edge
      switch (face) {
        case "front":
          return { face: "right", r: r, c: 0, dr: 0, dc: 1 };
        case "right":
          return { face: "back", r: r, c: 0, dr: 0, dc: 1 };
        case "back":
          return { face: "left", r: r, c: 0, dr: 0, dc: 1 };
        case "left":
          return { face: "front", r: r, c: 0, dr: 0, dc: 1 };
        case "top":
          return { face: "right", r: 0, c: 2 - r, dr: 1, dc: 0 };
        case "bottom":
          return { face: "right", r: 2, c: r, dr: -1, dc: 0 };
      }
    }
    if (dc === -1 && c === 0) {
      // exit left edge
      switch (face) {
        case "front":
          return { face: "left", r: r, c: 2, dr: 0, dc: -1 };
        case "right":
          return { face: "front", r: r, c: 2, dr: 0, dc: -1 };
        case "back":
          return { face: "right", r: r, c: 2, dr: 0, dc: -1 };
        case "left":
          return { face: "back", r: r, c: 2, dr: 0, dc: -1 };
        case "top":
          return { face: "left", r: 0, c: r, dr: 1, dc: 0 };
        case "bottom":
          return { face: "left", r: 2, c: 2 - r, dr: -1, dc: 0 };
      }
    }
    return null;
  }

  function nextCell(face, r, c, dr, dc) {
    const nr = r + dr,
      nc = c + dc;
    if (nr >= 0 && nr <= 2 && nc >= 0 && nc <= 2) {
      return { face, r: nr, c: nc, dr, dc };
    }
    if (dr !== 0 && dc !== 0) return null; // diagonal can't cross edges
    const next = crossEdge(face, r, c, dr, dc);
    if (!next) return null;
    return next;
  }

  function flipsFor(face, r, c, player) {
    if (state.boards[face][r][c] !== EMPTY) return [];
    const opp = opposite(player);
    const allFlips = [];

    for (const [dr, dc] of DIRS) {
      const line = [];
      let cur = nextCell(face, r, c, dr, dc);
      const visited = new Set([`${face}:${r}:${c}`]);
      while (cur) {
        const key = `${cur.face}:${cur.r}:${cur.c}`;
        if (visited.has(key)) break; // prevent wrap-around loops
        visited.add(key);
        const v = state.boards[cur.face][cur.r][cur.c];
        if (v === opp) {
          line.push({ face: cur.face, r: cur.r, c: cur.c });
          cur = nextCell(cur.face, cur.r, cur.c, cur.dr, cur.dc);
        } else if (v === player) {
          allFlips.push(...line);
          break;
        } else {
          break;
        }
      }
    }

    const seen = new Set();
    return allFlips.filter((f) => {
      const k = `${f.face}:${f.r}:${f.c}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function legalMovesOnFace(face, player) {
    const moves = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (state.boards[face][r][c] !== EMPTY) continue;
        const flips = flipsFor(face, r, c, player);
        if (flips.length) moves.push({ r, c, flips });
      }
    }
    return moves;
  }

  function anyLegalMoves(player) {
    for (const f of FACES) {
      if (legalMovesOnFace(f, player).length) return true;
    }
    return false;
  }

  function applyMove(face, r, c, player) {
    const flips = flipsFor(face, r, c, player);
    if (!flips.length) return null;
    state.boards[face][r][c] = player;
    for (const f of flips) state.boards[f.face][f.r][f.c] = player;
    return flips;
  }

  function render() {
    for (const face of FACES) {
      const b = state.boards[face];
      const legal = state.gameOver ? [] : legalMovesOnFace(face, state.turn);
      const legalSet = new Set(legal.map((m) => m.r * 3 + m.c));
      const cells = cubeEl.querySelectorAll(`.face[data-face="${face}"] .cell`);
      cells.forEach((cell) => {
        const r = +cell.dataset.r,
          c = +cell.dataset.c;
        const v = b[r][c];
        cell.classList.toggle("hint", state.turn === P1 && legalSet.has(r * 3 + c));
        cell.classList.toggle("has-stone", v !== EMPTY);
        const existing = cell.querySelector(".stone");
        if (v === EMPTY) {
          if (existing) existing.remove();
        } else {
          const cls = v === P1 ? "p1" : "p2";
          if (!existing) {
            const s = document.createElement("div");
            s.className = `stone ${cls}`;
            cell.appendChild(s);
          } else if (!existing.classList.contains(cls)) {
            existing.className = `stone ${cls} just-flipped`;
            setTimeout(() => existing.classList.remove("just-flipped"), 500);
          }
        }
      });
    }
    updateScores();
  }

  function updateScores() {
    let s1 = 0,
      s2 = 0;
    for (const f of FACES)
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          const v = state.boards[f][r][c];
          if (v === P1) s1++;
          else if (v === P2) s2++;
        }
    p1ScoreEl.textContent = s1;
    p2ScoreEl.textContent = s2;

    p1PanelEl.classList.toggle("leader", s1 > s2);
    p2PanelEl.classList.toggle("leader", s2 > s1);

    return { s1, s2 };
  }

  function setTurn(p, reason = "") {
    state.turn = p;
    p1PanelEl.classList.toggle("active", p === P1);
    p2PanelEl.classList.toggle("active", p === P2);
    statusEl.innerHTML = p === P1 ? `<b>YOUR TURN</b> — 光るマスをタップ` : `<b>AI THINKING…</b>`;
    render();

    if (state.gameOver) return;

    if (!anyLegalMoves(P1) && !anyLegalMoves(P2)) {
      endGame();
      return;
    }
    if (!anyLegalMoves(p)) {
      showToast(p === P1 ? "PASS — 置ける場所なし" : "AI PASS");
      setTimeout(() => setTurn(opposite(p), "pass"), 700);
      return;
    }

    if (p === P2) {
      state.aiThinking = true;
      state.aiTimer = setTimeout(aiMove, 650 + Math.random() * 400);
    }
  }

  function handleCellTap(cell) {
    if (state.gameOver) return;
    if (state.turn !== P1) return;
    const face = cell.dataset.face;
    const r = +cell.dataset.r,
      c = +cell.dataset.c;
    if (face !== closestFace()) {
      showToast(`${FACE_LABEL[face]} に回転`);
      snapToFace(face);
      return;
    }
    const snapshot = snapshotBoards();
    const flips = applyMove(face, r, c, P1);
    if (!flips) {
      showToast("置けません");
      return;
    }
    state.history.push(snapshot);
    $("undoBtn").disabled = false;
    playSound("place");
    render();
    updateScores();
    setTurn(P2);
  }

  const WEIGHT = [
    [8, 2, 8],
    [2, 4, 2],
    [8, 2, 8],
  ];

  function allLegalMoves(player) {
    const moves = [];
    for (const f of FACES) {
      for (const m of legalMovesOnFace(f, player)) {
        moves.push({ face: f, ...m });
      }
    }
    return moves;
  }

  function aiPickMove() {
    const moves = allLegalMoves(P2);
    if (!moves.length) return null;

    if (state.difficulty === "easy") {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    if (state.difficulty === "normal") {
      let best = null;
      for (const m of moves) {
        const score = m.flips.length * 3 + WEIGHT[m.r][m.c] + Math.random() * 0.9;
        if (!best || score > best.score) best = { ...m, score };
      }
      return best;
    }

    let best = null;
    for (const m of moves) {
      const myScore = m.flips.length * 3 + WEIGHT[m.r][m.c];
      const saved = FACES.map((f) => state.boards[f].map((row) => [...row]));
      applyMove(m.face, m.r, m.c, P2);
      let oppBest = 0;
      for (const f of FACES) {
        for (const om of legalMovesOnFace(f, P1)) {
          const s = om.flips.length * 3 + WEIGHT[om.r][om.c];
          if (s > oppBest) oppBest = s;
        }
      }
      FACES.forEach((f, i) => {
        state.boards[f] = saved[i];
      });
      const score = myScore - oppBest * 0.8;
      if (!best || score > best.score) best = { ...m, score };
    }
    return best;
  }

  function aiMove() {
    if (state.gameOver) return;
    const best = aiPickMove();
    if (!best) {
      state.aiThinking = false;
      setTurn(P1);
      return;
    }
    snapToFace(best.face);
    state.aiTimer = setTimeout(() => {
      state.aiTimer = null;
      applyMove(best.face, best.r, best.c, P2);
      playSound("place");
      render();
      state.aiThinking = false;
      setTurn(P1);
    }, 550);
  }

  function startTimer() {
    stopTimer();
    state.lastTick = performance.now();
    state.timerId = setInterval(() => {
      if (state.gameOver) return;
      const now = performance.now();
      const dt = (now - state.lastTick) / 1000;
      state.lastTick = now;
      state.elapsed[state.turn] += dt;
      updateTimers();
    }, 100);
  }
  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }
  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function updateTimers() {
    p1TimerEl.textContent = fmt(state.elapsed[P1]);
    p2TimerEl.textContent = fmt(state.elapsed[P2]);
    p1TimerEl.classList.remove("low");
    p2TimerEl.classList.remove("low");
  }

  function endGame(winner = null, reason = "") {
    state.gameOver = true;
    stopTimer();
    const { s1, s2 } = updateScores();
    let outcome;
    if (winner === P1 || (winner == null && s1 > s2)) outcome = "YOU WIN";
    else if (winner === P2 || (winner == null && s2 > s1)) outcome = "YOU LOSE";
    else outcome = "DRAW";
    outcomeText.textContent = outcome + (reason ? ` · ${reason}` : "");
    outcomeText.className = "big " + (outcome === "YOU WIN" ? "win" : outcome === "YOU LOSE" ? "lose" : "draw");
    finalP1.textContent = s1;
    finalP2.textContent = s2;
    $("finalTotal").textContent = `${s1 + s2} / 54 CELLS FILLED`;
    overlayEl.classList.add("open");
    render();
  }

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1500);
  }

  function customConfirm(msg) {
    return new Promise((resolve) => {
      $("confirmMessage").textContent = msg;
      $("confirmOverlay").classList.add("open");
      const ok = () => {
        cleanup();
        resolve(true);
      };
      const cancel = () => {
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        $("confirmOk").removeEventListener("click", ok);
        $("confirmCancel").removeEventListener("click", cancel);
        $("confirmOverlay").classList.remove("open");
      };
      $("confirmOk").addEventListener("click", ok, { once: true });
      $("confirmCancel").addEventListener("click", cancel, { once: true });
    });
  }

  let audioCtx = null;
  let bgmGain = null;
  let bgmSource = null;
  const bgm = new Audio();
  bgm.loop = true;
  let bgmStarted = false;

  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = 0.04; // Very quiet
    bgmGain.connect(audioCtx.destination);
    bgmSource = audioCtx.createMediaElementSource(bgm);
    bgmSource.connect(bgmGain);
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function playTitleBgm() {
    initAudio();
    if (bgm.src.includes("title_bgm.mp3") && !bgm.paused) return;
    bgm.pause();
    bgm.src = "/title_bgm.mp3";
    bgm.load();
    if (!state.muted) bgm.play().catch(() => {});
  }

  function playGameBgm() {
    initAudio();
    if (bgm.src.includes("game_bgm.mp3") && !bgm.paused) return;
    bgm.pause();
    bgm.src = "/game_bgm.mp3";
    bgm.load();
    if (!state.muted) bgm.play().catch(() => {});
  }

  function stopAllBgm() {
    bgm.pause();
  }

  function onFirstInteraction(e) {
    initAudio();
    ["pointerup", "touchend", "click", "keydown"].forEach((evt) =>
      document.removeEventListener(evt, onFirstInteraction)
    );
    if (bgmStarted) return;
    bgmStarted = true;
    
    if (e && e.target && e.target.closest && e.target.closest("#startBtn")) {
      return;
    }
    
    if (!$("tut").classList.contains("hidden")) playTitleBgm();
  }
  ["pointerup", "touchend", "click", "keydown"].forEach((e) =>
    document.addEventListener(e, onFirstInteraction, { passive: true })
  );

  // --- Launcher Logic ---
  launcherEl.addEventListener("click", () => {
    // Hide launcher
    launcherEl.classList.add("hidden");
    
    // Pause video to save CPU
    const v = $("launcherVideo");
    if (v) v.pause();
    
    // Unlock and play
    initAudio();
    if (!bgmStarted) {
      bgmStarted = true;
      if (!$("tut").classList.contains("hidden")) {
        playTitleBgm();
      }
    }
  }, { once: true });

  // Resilient audio unlocker for Safari
  ["click", "touchend"].forEach(evt => {
    document.addEventListener(evt, () => {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
    }, { passive: true });
  });

  function playSound(kind) {
    if (state.muted) return;
    initAudio();
    try {
      const ctx = audioCtx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      if (kind === "place") {
        o.type = "triangle";
        o.frequency.setValueAtTime(520, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.18);
        g.gain.setValueAtTime(0.08, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        o.start();
        o.stop(ctx.currentTime + 0.22);
      } else {
        o.type = "sine";
        o.frequency.value = 440;
        g.gain.setValueAtTime(0.05, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        o.start();
        o.stop(ctx.currentTime + 0.16);
      }
    } catch (e) {}
  }

  $("resetBtn").addEventListener("click", async () => {
    if (await customConfirm("ゲームをリセットしますか？")) resetGame();
  });
  $("undoBtn").addEventListener("click", () => {
    if (!state.history.length) return;
    if (state.aiTimer) {
      clearTimeout(state.aiTimer);
      state.aiTimer = null;
    }
    state.aiThinking = false;
    state.boards = state.history.pop();
    $("undoBtn").disabled = state.history.length === 0;
    state.gameOver = false;
    state.turn = P1;
    p1PanelEl.classList.add("active");
    p2PanelEl.classList.remove("active");
    overlayEl.classList.remove("open");
    render();
    statusEl.innerHTML = `<b>YOUR TURN</b> — 光るマスをタップ`;
  });
  $("passBtn").addEventListener("click", () => {
    if (state.gameOver || state.turn !== P1) return;
    if (anyLegalMoves(P1)) {
      showToast("まだ置ける場所があります");
      return;
    }
    setTurn(P2);
  });
  $("nextBtn").addEventListener("click", () => {
    if (state.gameOver) return;
    if (state.turn === P1) {
      if (anyLegalMoves(P1)) showToast("光るマスをタップしてください");
      else setTurn(P2);
    }
  });
  $("playAgainBtn").addEventListener("click", () => {
    overlayEl.classList.remove("open");
    resetGame();
    playGameBgm();
  });
  $("reviewBtn").addEventListener("click", () => {
    overlayEl.classList.remove("open");
  });
  $("toTitleBtn").addEventListener("click", () => {
    overlayEl.classList.remove("open");
    $("tut").classList.remove("hidden");
    playTitleBgm();
  });
  $("homeBtn").addEventListener("click", async () => {
    if (await customConfirm("タイトル画面に戻りますか？")) {
      if (state.aiTimer) {
        clearTimeout(state.aiTimer);
        state.aiTimer = null;
      }
      state.aiThinking = false;
      stopTimer();
      $("tut").classList.remove("hidden");
      playTitleBgm();
    }
  });
  $("muteBtn").addEventListener("click", () => {
    state.muted = !state.muted;
    $("muteBtn").textContent = state.muted ? "♪̸" : "♪";
    $("muteBtn").style.opacity = state.muted ? "0.5" : "1";
    if (state.muted) {
      stopAllBgm();
    } else {
      if ($("tut").classList.contains("hidden")) playGameBgm();
      else playTitleBgm();
    }
  });
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.difficulty = btn.dataset.diff;
      document.querySelectorAll(".diff-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  $("startBtn").addEventListener("click", () => {
    $("tut").classList.add("hidden");
    bgmStarted = true;
    resetGame();
    playGameBgm();

    // Dramatic START announcement
    const announce = $("startAnnounce");
    announce.classList.add("show");
    setTimeout(() => {
      announce.classList.remove("show");
    }, 1200);
  });

  function snapshotBoards() {
    return FACES.reduce((acc, f) => {
      acc[f] = state.boards[f].map((row) => [...row]);
      return acc;
    }, {});
  }

  function resetGame() {
    if (state.aiTimer) {
      clearTimeout(state.aiTimer);
      state.aiTimer = null;
    }
    state.gameOver = false;
    state.aiThinking = false;
    state.history = [];
    $("undoBtn").disabled = true;
    state.elapsed = { 1: 0, 2: 0 };
    state.turn = P1;
    resetBoards();
    applyRotation(true);
    render();
    updateTimers();
    startTimer();
    setTurn(P1);
  }

  function boot() {
    buildFaceTabs();
    buildCube();
    resetBoards();
    applyRotation(true);
    render();
    updateTimers();
  }
  boot();
})();
