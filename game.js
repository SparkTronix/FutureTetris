(() => {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const BLOCK = 30;
  const LASER_DURATION = 380;
  const LASER_STAGGER = 90;

  const SHAPES = {
    I: { matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], color: '#3dd9c4' },
    O: { matrix: [[1,1],[1,1]], color: '#f35634' },
    T: { matrix: [[0,1,0],[1,1,1],[0,0,0]], color: '#a855f7' },
    S: { matrix: [[0,1,1],[1,1,0],[0,0,0]], color: '#22c55e' },
    Z: { matrix: [[1,1,0],[0,1,1],[0,0,0]], color: '#ef4444' },
    J: { matrix: [[1,0,0],[1,1,1],[0,0,0]], color: '#3b82f6' },
    L: { matrix: [[0,0,1],[1,1,1],[0,0,0]], color: '#f59e0b' },
  };

  const PIECE_KEYS = Object.keys(SHAPES);
  const SCORE_TABLE = [0, 100, 300, 500, 800];

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const holdCanvas = document.getElementById('hold-canvas');
  const holdCtx = holdCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next-canvas');
  const nextCtx = nextCanvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const linesEl = document.getElementById('lines');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const startBtn = document.getElementById('start-btn');
  const muteBtn = document.getElementById('mute-btn');

  const audio = new AudioEngine();

  let board = createBoard();
  let bag = [];
  let current = null;
  let next = null;
  let hold = null;
  let canHold = true;
  let score = 0;
  let lines = 0;
  let level = 1;
  let dropInterval = 1000;
  let lastDrop = 0;
  let animId = null;
  let state = 'idle';
  let lineClearAnim = null;
  let particles = [];

  function ensureAudio() {
    audio.resume();
  }

  function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  }

  function refillBag() {
    bag = shuffle([...PIECE_KEYS]);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pullPiece() {
    if (bag.length === 0) refillBag();
    const key = bag.pop();
    const { matrix, color } = SHAPES[key];
    return {
      key,
      matrix: matrix.map(row => [...row]),
      color,
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: 0,
    };
  }

  function spawnPiece() {
    current = next || pullPiece();
    next = pullPiece();
    canHold = true;

    if (collides(current.matrix, current.x, current.y)) {
      state = 'gameover';
      audio.gameOver();
      showOverlay('GAME OVER', `Очки: ${score}`, 'ПОВТОР');
    }
  }

  function collides(matrix, ox, oy) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const nx = ox + x;
        const ny = oy + y;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && board[ny][nx]) return true;
      }
    }
    return false;
  }

  function rotate(matrix) {
    const n = matrix.length;
    const rotated = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        rotated[x][n - 1 - y] = matrix[y][x];
      }
    }
    return rotated;
  }

  function tryRotate() {
    if (state !== 'playing' || !current) return;
    const rotated = rotate(current.matrix);
    const kicks = [0, -1, 1, -2, 2];
    for (const kick of kicks) {
      if (!collides(rotated, current.x + kick, current.y)) {
        current.matrix = rotated;
        current.x += kick;
        audio.rotate();
        return;
      }
    }
  }

  function move(dx) {
    if (state !== 'playing' || !current) return;
    if (!collides(current.matrix, current.x + dx, current.y)) {
      current.x += dx;
      audio.move();
    }
  }

  function softDrop(manual = false) {
    if (state !== 'playing' || !current) return;
    if (!collides(current.matrix, current.x, current.y + 1)) {
      current.y++;
      score += 1;
      updateStats();
      if (manual) audio.softDrop();
    } else {
      lockPiece();
    }
  }

  function hardDrop() {
    if (state !== 'playing' || !current) return;
    let dropped = 0;
    while (!collides(current.matrix, current.x, current.y + 1)) {
      current.y++;
      score += 2;
      dropped++;
    }
    if (dropped > 0) audio.hardDrop();
    lockPiece();
    updateStats();
  }

  function findFullRows() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (board[y].every(cell => cell !== 0)) rows.push(y);
    }
    return rows;
  }

  function lockPiece() {
    const { matrix, x: ox, y: oy } = current;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const ny = oy + y;
        const nx = ox + x;
        if (ny >= 0) board[ny][nx] = current.color;
      }
    }
    current = null;
    audio.lock();

    const fullRows = findFullRows();
    if (fullRows.length > 0) {
      startLineClearAnimation(fullRows);
    } else {
      spawnPiece();
    }
  }

  function startLineClearAnimation(rows) {
    state = 'clearing';
    lineClearAnim = {
      rows: [...rows].sort((a, b) => a - b),
      startTime: performance.now(),
      rowSnapshots: [...rows].sort((a, b) => a - b).map(y => board[y].map(c => c)),
      vaporized: new Set(),
    };
    audio.laser(rows.length);
  }

  function getRowLaserProgress(rowIndex, timestamp) {
    const elapsed = timestamp - lineClearAnim.startTime - rowIndex * LASER_STAGGER;
    return Math.max(0, Math.min(1, elapsed / LASER_DURATION));
  }

  function spawnParticles(x, y, color) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: x * BLOCK + BLOCK / 2,
        y: y * BLOCK + BLOCK / 2,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 1.2) * 5,
        life: 1,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function finishLineClear() {
    const cleared = lineClearAnim.rows.length;
    for (let i = lineClearAnim.rows.length - 1; i >= 0; i--) {
      board.splice(lineClearAnim.rows[i], 1);
      board.unshift(Array(COLS).fill(0));
    }

    lines += cleared;
    score += SCORE_TABLE[cleared] * level;
    const newLevel = Math.floor(lines / 10) + 1;
    if (newLevel > level) {
      level = newLevel;
      dropInterval = Math.max(100, 1000 - (level - 1) * 80);
      audio.levelUp();
    }
    updateStats();
    lineClearAnim = null;
    state = 'playing';
    spawnPiece();
    lastDrop = performance.now();
  }

  function updateLineClear(timestamp) {
    if (!lineClearAnim) return;

    const lastRowIndex = lineClearAnim.rows.length - 1;
    const totalDone = getRowLaserProgress(lastRowIndex, timestamp) >= 1;
    if (totalDone) {
      finishLineClear();
    }
  }

  function holdPiece() {
    if (state !== 'playing' || !current || !canHold) return;
    canHold = false;
    audio.hold();
    if (hold === null) {
      hold = { key: current.key, matrix: SHAPES[current.key].matrix.map(r => [...r]), color: current.color };
      current = null;
      spawnPiece();
    } else {
      const temp = hold;
      hold = { key: current.key, matrix: SHAPES[current.key].matrix.map(r => [...r]), color: current.color };
      const shape = SHAPES[temp.key];
      current = {
        key: temp.key,
        matrix: shape.matrix.map(r => [...r]),
        color: shape.color,
        x: Math.floor((COLS - shape.matrix[0].length) / 2),
        y: 0,
      };
      if (collides(current.matrix, current.x, current.y)) {
        state = 'gameover';
        audio.gameOver();
        showOverlay('GAME OVER', `Очки: ${score}`, 'ПОВТОР');
      }
    }
  }

  function getGhostY() {
    if (!current) return 0;
    let gy = current.y;
    while (!collides(current.matrix, current.x, gy + 1)) gy++;
    return gy;
  }

  function updateStats() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
  }

  function showOverlay(title, text, btnLabel) {
    overlay.classList.remove('hidden');
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = btnLabel;
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function resetGame() {
    ensureAudio();
    board = createBoard();
    bag = [];
    hold = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    dropInterval = 1000;
    lastDrop = 0;
    lineClearAnim = null;
    particles = [];
    next = pullPiece();
    updateStats();
    spawnPiece();
    state = 'playing';
    hideOverlay();
    audio.start();
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      showOverlay('ПАУЗА', 'Нажмите P для продолжения', 'ПРОДОЛЖИТЬ');
    } else if (state === 'paused') {
      state = 'playing';
      hideOverlay();
      lastDrop = performance.now();
    }
  }

  function drawBlock(context, x, y, color, size, ghost = false, hot = false) {
    const pad = 1;
    if (ghost) {
      context.strokeStyle = color;
      context.globalAlpha = 0.35;
      context.lineWidth = 1.5;
      context.strokeRect(x * size + pad, y * size + pad, size - pad * 2, size - pad * 2);
      context.globalAlpha = 1;
      return;
    }

    const px = x * size + pad;
    const py = y * size + pad;
    const s = size - pad * 2;

    if (hot) {
      context.save();
      context.shadowColor = '#fff';
      context.shadowBlur = 16;
      const hotGrad = context.createLinearGradient(px, py, px + s, py + s);
      hotGrad.addColorStop(0, '#ffffff');
      hotGrad.addColorStop(0.4, color);
      hotGrad.addColorStop(1, '#f35634');
      context.fillStyle = hotGrad;
      context.fillRect(px, py, s, s);
      context.restore();
      return;
    }

    const grad = context.createLinearGradient(px, py, px + s, py + s);
    grad.addColorStop(0, lighten(color, 30));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, darken(color, 20));

    context.fillStyle = grad;
    context.fillRect(px, py, s, s);

    context.strokeStyle = 'rgba(255,255,255,0.15)';
    context.lineWidth = 1;
    context.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(px + 2, py + 2, s * 0.4, 2);
  }

  function lighten(hex, pct) {
    return shiftColor(hex, pct);
  }

  function darken(hex, pct) {
    return shiftColor(hex, -pct);
  }

  function shiftColor(hex, pct) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + pct));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + pct));
    const b = Math.min(255, Math.max(0, (num & 0xff) + pct));
    return `rgb(${r},${g},${b})`;
  }

  function drawGrid(context, width, height, cellSize) {
    context.strokeStyle = 'rgba(61, 217, 196, 0.06)';
    context.lineWidth = 0.5;
    for (let x = 0; x <= width; x++) {
      context.beginPath();
      context.moveTo(x * cellSize, 0);
      context.lineTo(x * cellSize, height * cellSize);
      context.stroke();
    }
    for (let y = 0; y <= height; y++) {
      context.beginPath();
      context.moveTo(0, y * cellSize);
      context.lineTo(width * cellSize, y * cellSize);
      context.stroke();
    }
  }

  function drawPiece(context, piece, cellSize, offsetX = 0, offsetY = 0) {
    if (!piece) return;
    const matrix = piece.matrix || piece;
    const color = piece.color;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x]) {
          drawBlock(context, offsetX + x, offsetY + y, color, cellSize);
        }
      }
    }
  }

  function drawPreview(context, piece, canvasSize) {
    context.clearRect(0, 0, canvasSize, canvasSize);
    if (!piece) return;
    const matrix = piece.matrix;
    const rows = matrix.length;
    const cols = matrix[0].length;
    const cellSize = Math.min(
      Math.floor((canvasSize - 20) / cols),
      Math.floor((canvasSize - 20) / rows)
    );
    const offsetX = Math.floor((canvasSize / cellSize - cols) / 2);
    const offsetY = Math.floor((canvasSize / cellSize - rows) / 2);
    drawPiece(context, piece, cellSize, offsetX, offsetY);
  }

  function drawLaserBeam(py, laserX, width) {
    const beamLen = 40;

    ctx.save();

    const glow = ctx.createLinearGradient(laserX - beamLen, py, laserX, py);
    glow.addColorStop(0, 'rgba(61, 217, 196, 0)');
    glow.addColorStop(0.6, 'rgba(61, 217, 196, 0.5)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
    ctx.strokeStyle = glow;
    ctx.lineWidth = 8;
    ctx.shadowColor = '#3dd9c4';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, laserX - beamLen), py);
    ctx.lineTo(laserX, py);
    ctx.stroke();

    ctx.strokeStyle = '#f35634';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#f35634';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(laserX, py);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(laserX, py, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#3dd9c4';
    ctx.fillRect(0, py - BLOCK / 2, laserX, BLOCK);
    ctx.restore();
  }

  function drawLineClearEffects(timestamp) {
    if (!lineClearAnim) return;

    lineClearAnim.rows.forEach((row, rowIndex) => {
      const progress = getRowLaserProgress(rowIndex, timestamp);
      if (progress <= 0) return;

      const laserX = progress * COLS * BLOCK;
      const py = row * BLOCK + BLOCK / 2;
      const snapshot = lineClearAnim.rowSnapshots[rowIndex];

      for (let x = 0; x < COLS; x++) {
        const color = snapshot[x];
        if (!color) continue;

        const cellCenter = (x + 0.5) * BLOCK;
        if (cellCenter < laserX - 8) continue;

        if (cellCenter <= laserX + 8) {
          drawBlock(ctx, x, row, color, BLOCK, false, true);
        } else {
          drawBlock(ctx, x, row, color, BLOCK);
        }
      }

      drawLaserBeam(py, laserX, canvas.width);

      if (progress > 0 && progress < 1) {
        const col = Math.floor(laserX / BLOCK);
        const key = `${row}-${col}`;
        if (col >= 0 && col < COLS && snapshot[col] && !lineClearAnim.vaporized.has(key)) {
          lineClearAnim.vaporized.add(key);
          spawnParticles(col, row, snapshot[col]);
        }
      }
    });
  }

  function updateParticles() {
    particles = particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 0.04;
      return p.life > 0;
    });
  }

  function drawParticles() {
    particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    });
  }

  function isClearingRow(y) {
    return lineClearAnim && lineClearAnim.rows.includes(y);
  }

  function render(timestamp) {
    ctx.fillStyle = '#080c18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, COLS, ROWS, BLOCK);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x] && !isClearingRow(y)) {
          drawBlock(ctx, x, y, board[y][x], BLOCK);
        }
      }
    }

    if (lineClearAnim) {
      drawLineClearEffects(timestamp);
      updateLineClear(timestamp);
    }

    drawParticles();
    updateParticles();

    if (current && (state === 'playing' || state === 'clearing')) {
      const ghostY = getGhostY();
      if (state === 'playing') {
        for (let y = 0; y < current.matrix.length; y++) {
          for (let x = 0; x < current.matrix[y].length; x++) {
            if (current.matrix[y][x]) {
              drawBlock(ctx, current.x + x, ghostY + y, current.color, BLOCK, true);
            }
          }
        }
      }
      if (state === 'playing') {
        drawPiece(ctx, { matrix: current.matrix, color: current.color }, BLOCK, current.x, current.y);
      }
    }

    drawPreview(holdCtx, hold, 120);
    drawPreview(nextCtx, next, 120);

    if (state === 'playing') {
      if (timestamp - lastDrop > dropInterval) {
        softDrop();
        lastDrop = timestamp;
      }
    }

    animId = requestAnimationFrame(render);
  }

  document.addEventListener('keydown', (e) => {
    ensureAudio();

    if (e.key === 'Enter') {
      if (state === 'idle' || state === 'gameover') resetGame();
      else if (state === 'paused') togglePause();
      return;
    }

    if (state !== 'playing') {
      if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
        if (state === 'paused') togglePause();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        softDrop(true);
        lastDrop = performance.now();
        break;
      case 'ArrowUp':
        e.preventDefault();
        tryRotate();
        break;
      case ' ':
        e.preventDefault();
        hardDrop();
        lastDrop = performance.now();
        break;
      case 'c':
      case 'C':
      case 'с':
      case 'С':
        holdPiece();
        break;
      case 'p':
      case 'P':
      case 'з':
      case 'З':
        togglePause();
        break;
    }
  });

  startBtn.addEventListener('click', () => {
    ensureAudio();
    if (state === 'idle' || state === 'gameover') resetGame();
    else if (state === 'paused') togglePause();
  });

  muteBtn.addEventListener('click', () => {
    ensureAudio();
    const muted = audio.toggleMute();
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', muted);
  });

  showOverlay('FUTURE TETRIS', 'Нажмите Enter или кнопку для старта', 'ЗАПУСК');
  animId = requestAnimationFrame(render);
})();
