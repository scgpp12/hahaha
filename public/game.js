// ── game.js ──────────────────────────────────────────────────────────────────
let ws, myId, map, TILE, MAP_W, MAP_H;
let gameData = null;
let keys_held = {};

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ── Join ─────────────────────────────────────────────────────────────────────
function joinGame() {
  const name = document.getElementById('nameInput').value.trim() || '幽灵旅人';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'joined') {
      myId = msg.playerId;
      map = msg.map;
      TILE = msg.tileSize;
      MAP_W = msg.mapW;
      MAP_H = msg.mapH;
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('gameUI').style.display = 'block';
      setupAudio();
      startInputLoop();
      requestAnimationFrame(gameLoop);
    } else if (msg.type === 'state') {
      gameData = msg.data;
      updateHUD();
      updateEvents();
    } else if (msg.type === 'restart') {
      location.reload();
    }
  };

  ws.onclose = () => {
    if (!gameData) return;
    showOverlay('🔌', '连接断开', '与服务器失去联系');
  };
}

// ── Input ────────────────────────────────────────────────────────────────────
function startInputLoop() {
  document.addEventListener('keydown', e => { keys_held[e.key] = true; });
  document.addEventListener('keyup', e => { keys_held[e.key] = false; });
  setInterval(sendInput, 33);
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  let dx = 0, dy = 0;
  if (keys_held['ArrowLeft']  || keys_held['a'] || keys_held['A']) dx = -1;
  if (keys_held['ArrowRight'] || keys_held['d'] || keys_held['D']) dx = 1;
  if (keys_held['ArrowUp']    || keys_held['w'] || keys_held['W']) dy = -1;
  if (keys_held['ArrowDown']  || keys_held['s'] || keys_held['S']) dy = 1;
  if (dx || dy) ws.send(JSON.stringify({ type: 'move', dx, dy }));
}

function restartGame() {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: 'restart' }));
  else location.reload();
}

// ── Audio (Web Audio API) ────────────────────────────────────────────────────
let audioCtx;
function setupAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  playAmbienceLoop();
}

function playAmbienceLoop() {
  if (!audioCtx) return;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 4, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.04;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  src.connect(filter);
  filter.connect(audioCtx.destination);
  src.start();
}

function playBeep(freq = 440, dur = 0.1, vol = 0.3) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.start(); osc.stop(audioCtx.currentTime + dur);
}

function playGhostSound() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(80, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.5);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

// ── HUD ──────────────────────────────────────────────────────────────────────
let lastPhase = '';
function updateHUD() {
  if (!gameData) return;
  const me = gameData.players.find(p => p.id === myId);
  if (me) {
    document.getElementById('healthVal').textContent = Math.max(0, Math.floor(me.health));
    document.getElementById('keysVal').textContent = me.keysHeld;
    const hEl = document.getElementById('hudHealth');
    hEl.style.color = me.health < 30 ? '#e74c3c' : me.health < 60 ? '#f39c12' : '#2ecc71';
  }
  document.getElementById('playerCount').textContent = gameData.players.filter(p => p.alive).length;

  // Phase badge
  const badge = document.getElementById('phaseBadge');
  const phases = { waiting: '等待中', playing: '进行中', gameover: '全灭', escaped: '逃脱成功' };
  badge.textContent = phases[gameData.phase] || gameData.phase;

  // Game end overlay
  if (gameData.phase !== lastPhase) {
    lastPhase = gameData.phase;
    if (gameData.phase === 'gameover') {
      setTimeout(() => showOverlay('💀', '全军覆没', '幽灵吞噬了所有人…'), 500);
    } else if (gameData.phase === 'escaped') {
      playBeep(880, 0.5, 0.4); playBeep(1100, 0.5, 0.4);
      setTimeout(() => showOverlay('🚪', '逃脱成功！', '你从山屋的阴影中逃了出来！'), 500);
    }
  }
}

let lastEventCount = 0;
function updateEvents() {
  if (!gameData) return;
  const events = gameData.events || [];
  if (events.length === lastEventCount) return;
  lastEventCount = events.length;
  const log = document.getElementById('eventLog');
  log.innerHTML = '';
  events.slice(-6).reverse().forEach(ev => {
    const d = document.createElement('div');
    d.className = `log-line log-${ev.type}`;
    d.textContent = ev.msg;
    log.appendChild(d);
  });
  // Sound for events
  const last = events[events.length - 1];
  if (last) {
    if (last.type === 'key') playBeep(660, 0.15);
    else if (last.type === 'death') { playGhostSound(); triggerFlicker(); }
    else if (last.type === 'horror') triggerFlicker();
    else if (last.type === 'unlock') { playBeep(440, 0.1); playBeep(550, 0.1); playBeep(660, 0.2); }
  }
}

function showOverlay(icon, title, msg) {
  document.getElementById('overlayIcon').textContent = icon;
  document.getElementById('overlayTitle').textContent = title;
  document.getElementById('overlayMsg').textContent = msg;
  document.getElementById('overlay').style.display = 'flex';
}

let flickerTimeout;
function triggerFlicker() {
  const f = document.getElementById('flicker');
  f.style.opacity = '0.6';
  clearTimeout(flickerTimeout);
  flickerTimeout = setTimeout(() => { f.style.opacity = '0'; }, 150);
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const TILE_COLORS = {
  0: '#1a1008',  // floor - dark wood
  1: '#3d2b1f',  // wall
  2: '#5c3a1e',  // door
  3: '#f1c40f',  // key
  4: '#2ecc71',  // exit
};

// Precompute wall drawing details
function drawMap(cx, cy) {
  if (!map) return;
  const offX = canvas.width / 2 - cx;
  const offY = canvas.height / 2 - cy;

  // Visible tile range
  const startTX = Math.max(0, Math.floor(-offX / TILE) - 1);
  const endTX   = Math.min(MAP_W, Math.ceil((canvas.width - offX) / TILE) + 1);
  const startTY = Math.max(0, Math.floor(-offY / TILE) - 1);
  const endTY   = Math.min(MAP_H, Math.ceil((canvas.height - offY) / TILE) + 1);

  for (let ty = startTY; ty < endTY; ty++) {
    for (let tx = startTX; tx < endTX; tx++) {
      const t = map[ty][tx];
      const px = tx * TILE + offX, py = ty * TILE + offY;

      if (t === 1) {
        // Wall with depth effect
        ctx.fillStyle = '#2c1a10';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#3d2b1f';
        ctx.fillRect(px, py, TILE, TILE - 4);
        ctx.fillStyle = '#4a3525';
        ctx.fillRect(px + 1, py + 1, TILE - 2, 6);
      } else if (t === 2) {
        // Door
        ctx.fillStyle = '#1a1008';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#7b4f1e';
        ctx.fillRect(px + 4, py + 2, TILE - 8, TILE - 4);
        ctx.fillStyle = '#c0a060';
        ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2 - 2, 4, 4);
      } else {
        // Floor
        ctx.fillStyle = t === 0 ? (((tx + ty) % 2 === 0) ? '#1a1008' : '#1e1309') : TILE_COLORS[t];
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
}

function drawKeys(cx, cy) {
  if (!gameData) return;
  const offX = canvas.width / 2 - cx;
  const offY = canvas.height / 2 - cy;

  gameData.keys.forEach(k => {
    if (k.collected) return;
    const px = k.x * TILE + 16 + offX, py = k.y * TILE + 16 + offY;
    const bob = Math.sin(Date.now() / 400 + k.id) * 3;
    ctx.save();
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur = 15;
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔑', px, py + bob);
    ctx.restore();
  });

  // Exit
  const ex = gameData.exit;
  const epx = ex.x * TILE + 16 + offX, epy = ex.y * TILE + 16 + offY;
  ctx.save();
  ctx.shadowColor = ex.open ? '#2ecc71' : '#e74c3c';
  ctx.shadowBlur = 20;
  ctx.font = '22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ex.open ? '🚪' : '🔒', epx, epy);
  ctx.restore();
}

function drawPlayers(cx, cy) {
  if (!gameData) return;
  const offX = canvas.width / 2 - cx;
  const offY = canvas.height / 2 - cy;

  gameData.players.forEach(p => {
    if (!p.alive) return;
    const px = p.x + offX, py = p.y + offY;
    const isMe = p.id === myId;

    // Shadow
    ctx.save();
    ctx.shadowColor = isMe ? 'rgba(255,255,100,0.6)' : 'rgba(255,255,255,0.3)';
    ctx.shadowBlur = isMe ? 20 : 10;

    // Body
    ctx.beginPath();
    ctx.arc(px, py, isMe ? 11 : 9, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = isMe ? '#ffffa0' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = isMe ? 2 : 1;
    ctx.stroke();
    ctx.restore();

    // Flashlight cone (for self)
    if (isMe) drawFlashlight(px, py);

    // Name tag
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${isMe ? 11 : 10}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(p.name, px, py - 16);

    // Health bar
    const barW = 30, barH = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px - barW / 2, py + 14, barW, barH);
    const pct = Math.max(0, p.health) / 100;
    ctx.fillStyle = pct > 0.6 ? '#2ecc71' : pct > 0.3 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(px - barW / 2, py + 14, barW * pct, barH);
  });
}

function drawFlashlight(px, py) {
  const dir = Date.now() / 3000;
  const angle = Math.atan2(
    (keys_held['ArrowDown']||keys_held['s']||keys_held['S']) ? 1 : (keys_held['ArrowUp']||keys_held['w']||keys_held['W']) ? -1 : 0,
    (keys_held['ArrowRight']||keys_held['d']||keys_held['D']) ? 1 : (keys_held['ArrowLeft']||keys_held['a']||keys_held['A']) ? -1 : 0
  ) || dir;

  const grad = ctx.createRadialGradient(px, py, 0, px, py, 140);
  grad.addColorStop(0, 'rgba(255,240,180,0.18)');
  grad.addColorStop(0.4, 'rgba(255,240,180,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 140, -0.5, 0.5);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawGhost(cx, cy) {
  if (!gameData) return;
  const g = gameData.ghost;
  const offX = canvas.width / 2 - cx;
  const offY = canvas.height / 2 - cy;
  const gx = g.x + offX, gy = g.y + offY;

  // Only draw if close to self player
  const me = gameData.players.find(p => p.id === myId);
  if (me && Math.hypot(me.x - g.x, me.y - g.y) > 250) return;

  const t = Date.now() / 500;
  const bob = Math.sin(t) * 4;
  const alpha = g.state === 'chase' ? 0.9 : 0.5 + Math.sin(t * 2) * 0.2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Glow
  ctx.shadowColor = g.state === 'chase' ? '#e74c3c' : '#9b59b6';
  ctx.shadowBlur = g.state === 'chase' ? 40 : 20;

  // Ghost body
  ctx.beginPath();
  ctx.arc(gx, gy + bob, 16, Math.PI, 0);
  ctx.lineTo(gx + 16, gy + bob + 16);
  ctx.quadraticCurveTo(gx + 12, gy + bob + 10, gx + 8, gy + bob + 16);
  ctx.quadraticCurveTo(gx + 4, gy + bob + 10, gx, gy + bob + 16);
  ctx.quadraticCurveTo(gx - 4, gy + bob + 10, gx - 8, gy + bob + 16);
  ctx.quadraticCurveTo(gx - 12, gy + bob + 10, gx - 16, gy + bob + 16);
  ctx.closePath();
  ctx.fillStyle = g.state === 'chase' ? '#c0392b' : '#8e44ad';
  ctx.fill();

  // Eyes
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ff0000';
  ctx.shadowColor = '#ff0000';
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(gx - 5, gy + bob - 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(gx + 5, gy + bob - 2, 3, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawFog(cx, cy) {
  // Vignette / darkness
  const me = gameData && gameData.players.find(p => p.id === myId);
  const rad = me && me.alive ? 160 : 80;
  const grd = ctx.createRadialGradient(canvas.width/2, canvas.height/2, rad*0.3, canvas.width/2, canvas.height/2, rad*2.2);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMinimap() {
  if (!map) return;
  const scaleX = mmCanvas.width / MAP_W;
  const scaleY = mmCanvas.height / MAP_H;
  mmCtx.fillStyle = '#0a0604';
  mmCtx.fillRect(0, 0, mmCanvas.width, mmCanvas.height);

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const t = map[ty][tx];
      mmCtx.fillStyle = t === 1 ? '#3d2b1f' : t === 2 ? '#7b4f1e' : '#1a1008';
      mmCtx.fillRect(tx * scaleX, ty * scaleY, scaleX, scaleY);
    }
  }

  if (gameData) {
    // Keys
    gameData.keys.forEach(k => {
      if (k.collected) return;
      mmCtx.fillStyle = '#f1c40f';
      mmCtx.fillRect(k.x * scaleX - 1, k.y * scaleY - 1, 3, 3);
    });
    // Players
    gameData.players.forEach(p => {
      if (!p.alive) return;
      mmCtx.fillStyle = p.id === myId ? '#fff' : p.color;
      const mx = (p.x / TILE) * scaleX, my = (p.y / TILE) * scaleY;
      mmCtx.beginPath(); mmCtx.arc(mx, my, 2, 0, Math.PI * 2); mmCtx.fill();
    });
    // Ghost
    const g = gameData.ghost;
    mmCtx.fillStyle = '#e74c3c';
    const gx = (g.x / TILE) * scaleX, gy = (g.y / TILE) * scaleY;
    mmCtx.beginPath(); mmCtx.arc(gx, gy, 2, 0, Math.PI * 2); mmCtx.fill();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let lastGhostAlert = 0;
function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!gameData) return;

  const me = gameData.players.find(p => p.id === myId);
  const camX = me ? me.x : (MAP_W * TILE) / 2;
  const camY = me ? me.y : (MAP_H * TILE) / 2;

  // Clear
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMap(camX, camY);
  drawKeys(camX, camY);
  drawPlayers(camX, camY);
  drawGhost(camX, camY);
  drawFog(camX, camY);
  drawMinimap();

  // Ghost proximity alert
  const g = gameData.ghost;
  if (me && me.alive) {
    const dist = Math.hypot(me.x - g.x, me.y - g.y);
    if (dist < 120 && Date.now() - lastGhostAlert > 1500) {
      lastGhostAlert = Date.now();
      playGhostSound();
      triggerFlicker();
    }
  }
}
