// ══════════════════════════════════════════════════════════════════════════════
// 山屋惊魂 v3 — Client (Vercel 版)
// WebSocket 端点从 config.js 中的 window.WS_ENDPOINT 读取
// ══════════════════════════════════════════════════════════════════════════════
window.Game = (() => {
  let ws, myId, state;
  let currentFloor = 'ground';
  let lastHauntShown = false;
  let lastGameoverShown = false;
  let diceRollInProgress = false;

  // ── Session 持久化（刷新恢复用）─────────────────────────────────────────────
  const SESSION_KEY = 'swjh_session';

  function saveSession() {
    if (myId && state?.code) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ myId, gameCode: state.code }));
    }
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  let _reconnectTimer = null;
  let _reconnectDelay = 1000;   // 首次重连等1秒，之后指数退避
  let _pendingOnOpen = null;    // 重连成功后需要执行的动作
  let _waitingForRejoin = false; // 标记：正在等待 rejoin 响应（刷新恢复）

  const WS_URL = (window.WS_ENDPOINT && !window.WS_ENDPOINT.includes('YOUR_API_ID'))
    ? window.WS_ENDPOINT
    : (() => { const p = location.protocol === 'https:' ? 'wss:' : 'ws:'; return `${p}//${location.host}`; })();

  function _createSocket() {
    console.log('[WS] connecting to', WS_URL);
    const socket = new WebSocket(WS_URL);
    ws = socket;

    socket.addEventListener('open', () => {
      console.log('[WS] open');
      _reconnectDelay = 1000; // 重置退避
      clearTimeout(_reconnectTimer);

      // 断网自动重连成功：state 已有，直接发 rejoin
      if (state && !_pendingOnOpen) {
        send({ type: 'rejoin', data: { gameCode: state.code, playerId: myId } });
      }

      if (_pendingOnOpen) {
        _pendingOnOpen();
        _pendingOnOpen = null;
      }
    }, { once: true });

    socket.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch(err) { console.error('[WS] bad json', e.data); return; }
      if (msg.type === 'game_created' || msg.type === 'game_joined') {
        myId = msg.playerId;
        switchScreen('charsel');
        document.getElementById('codeDisplay').textContent = msg.code;
        document.getElementById('tbCode').textContent = msg.code;
        saveSession();
      } else if (msg.type === 'state') {
        const prev = state;
        state = msg.data;
        saveSession(); // 每次收到状态更新都持久化
        // 收到 state 即表示连接/重连成功，清除重连横幅
        if (_waitingForRejoin) {
          _waitingForRejoin = false;
          showReconnectBanner(false);
        } else {
          // 网络断开自动重连后，横幅也可能在显示
          const banner = document.getElementById('reconnectBanner');
          if (banner && banner.style.display !== 'none') showReconnectBanner(false);
        }
        if (state.phase !== 'lobby') switchScreen('game');
        render(prev);
      } else if (msg.type === 'error') {
        showError(msg.msg);
      }
    };

    socket.onerror = () => { console.error('[WS] error'); };
    socket.onclose = (e) => {
      console.warn('[WS] closed', e.code, e.reason);
      if (ws === socket) ws = null;

      // 游戏进行中断线 → 自动重连
      if (state && state.phase !== 'gameover') {
        showReconnectBanner(true);
        _reconnectTimer = setTimeout(() => {
          _reconnectDelay = Math.min(_reconnectDelay * 2, 16000);
          _createSocket();
        }, _reconnectDelay);
      } else if (state) {
        showError('与服务器的连接已断开');
      }
    };
  }

  function showReconnectBanner(show) {
    let banner = document.getElementById('reconnectBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'reconnectBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c62828;color:#fff;text-align:center;padding:8px;z-index:9999;font-size:14px;';
      document.body.appendChild(banner);
    }
    if (show) {
      banner.textContent = '⚠ 连接已断开，正在重连...';
      banner.style.display = 'block';
    } else {
      banner.textContent = '✓ 已重新连接';
      banner.style.background = '#2e7d32';
      setTimeout(() => { banner.style.display = 'none'; banner.style.background = '#c62828'; }, 2000);
    }
  }

  function connect(onOpen) {
    // 若已有连接正在建立或已开启，不重复创建
    if (ws && ws.readyState === WebSocket.OPEN) { onOpen(); return; }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      _pendingOnOpen = onOpen;
      return;
    }
    _pendingOnOpen = onOpen;
    _createSocket();
  }

  function send(obj) {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
        console.log('[WS] sent', obj.type);
      } catch(e) {
        console.error('[WS] send error', e);
      }
    } else {
      console.warn('[WS] send skipped, readyState=', ws?.readyState);
      // 如果连接还未建立，给用户可见提示
      if (obj.type !== 'rejoin') {
        showError('正在重新连接服务器，请稍候再试…');
      }
    }
  }

  function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${id}`)?.classList.add('active');
  }

  function showError(msg) {
    let el = document.getElementById('lobbyError');
    if (el) { el.textContent = msg; setTimeout(() => el.textContent='', 4000); }
    else alert(msg);
  }

  function createRoom() {
    clearSession();
    const name = document.getElementById('createName').value.trim() || '房主';
    connect(() => send({ type:'create_game', data:{ name } }));
  }

  function joinRoom() {
    clearSession();
    const name = document.getElementById('joinName').value.trim() || '玩家';
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    if (!code) { showError('请输入房间代码'); return; }
    connect(() => send({ type:'join_game', data:{ name, code } }));
  }

  // ── 页面加载时检查是否有未完成的会话（刷新恢复）──────────────────────────────
  function tryRestoreSession() {
    const saved = loadSession();
    if (!saved?.myId || !saved?.gameCode) return;
    myId = saved.myId;
    _waitingForRejoin = true;
    showReconnectBanner(true);
    connect(() => {
      send({ type: 'rejoin', data: { gameCode: saved.gameCode, playerId: saved.myId } });
    });
  }

  const CHARS = [
    { id:'zoe',    name:'佐伊',   title:'小女孩',   color:'#e91e63', emoji:'👧', stats:{speed:4,might:2,sanity:4,knowledge:3}, desc:'直觉敏锐，感知神秘力量，但体力较弱。' },
    { id:'ox',     name:'牛仔',   title:'运动员',   color:'#ff5722', emoji:'🤠', stats:{speed:3,might:5,sanity:3,knowledge:2}, desc:'力大无穷，是战斗中最可靠的伙伴。' },
    { id:'father', name:'神父',   title:'传教士',   color:'#9c27b0', emoji:'✝️',  stats:{speed:2,might:3,sanity:5,knowledge:4}, desc:'信仰坚定，神志超强，知识渊博。' },
    { id:'vivian', name:'薇薇安', title:'灵媒',     color:'#3f51b5', emoji:'🔮', stats:{speed:3,might:2,sanity:4,knowledge:5}, desc:'洞察灵界，知识惊人，但体力不足。' },
    { id:'darrin', name:'达林',   title:'运动明星', color:'#009688', emoji:'⚡', stats:{speed:5,might:4,sanity:3,knowledge:2}, desc:'速度最快，行动灵活，适合探索。' },
    { id:'jenny',  name:'珍妮',   title:'侦探',     color:'#795548', emoji:'🔍', stats:{speed:4,might:3,sanity:3,knowledge:4}, desc:'均衡发展，洞察力强，适应性极佳。' },
  ];

  function renderCharSel() {
    if (!state) return;
    const grid = document.getElementById('charCards');
    if (!grid) return;
    const taken = state.players.filter(p=>p.id!==myId && p.charId).map(p=>p.charId);
    const myChar = state.players.find(p=>p.id===myId)?.charId;
    grid.innerHTML = CHARS.map(c => {
      const isTaken = taken.includes(c.id), isMe = myChar === c.id;
      return `<div class="char-card ${isTaken?'taken':''} ${isMe?'selected':''}" style="--char-color:${c.color}"
                   onclick="${isTaken&&!isMe?'':` Game.selectChar('${c.id}')`}">
        <div class="char-emoji">${c.emoji}</div>
        <div class="char-name">${c.name}</div>
        <div class="char-title">${c.title}</div>
        <div class="char-stats">${['速','力','志','知'].map((l,i)=>statBar(l,[c.stats.speed,c.stats.might,c.stats.sanity,c.stats.knowledge][i])).join('')}</div>
        <div class="char-desc">${c.desc}</div>
        ${isTaken ? '<div class="char-taken-label">已被选择</div>' : ''}
        ${isMe    ? '<div class="char-mine-label">✓</div>' : ''}
      </div>`;
    }).join('');
    const all=state.players, ready=all.filter(p=>p.charId).length;
    document.getElementById('charselStatus').textContent=`${ready}/${all.length} 名玩家已选择角色`;
    const isHost=state.hostId===myId, allReady=all.length>=2&&all.every(p=>p.charId);
    const btn=document.getElementById('startBtn');
    if (isHost) {
      btn.style.display='inline-block';
      btn.disabled=!allReady;
      btn.textContent=allReady?'▶ 开始游戏':'等待所有人选择角色…';
    }
  }

  function statBar(label,val) {
    return `<div class="stat-row"><span>${label}</span><div class="pips">${Array.from({length:8},(_,i)=>`<div class="pip ${i<val?'filled':''}"></div>`).join('')}</div><span>${val}</span></div>`;
  }

  function selectChar(charId) { send({ type:'select_char', data:{ charId } }); }
  function startGame()        { send({ type:'start_game',  data:{} }); }

  function render(prev) {
    if (!state) return;
    if (state.phase === 'lobby') { renderCharSel(); return; }
    const me = state.players.find(p=>p.id===myId);
    if (!me?.char) { renderCharSel(); return; }
    renderTopbar(); renderPlayers(); renderBoard();
    renderActionConsole(); renderLog(); renderCardHistory(); renderOverlays(prev);
  }

  function renderTopbar() {
    const phases = { exploring:'探索中', haunt:'幽灵降临', gameover:'游戏结束' };
    document.getElementById('tbPhase').textContent = phases[state.phase]||state.phase;
    document.getElementById('tbPhase').className = `tb-badge phase-${state.phase}`;
    document.getElementById('omenVal').textContent = state.omenCount;
    document.getElementById('tbCode').textContent = state.code;
    const cur = state.players.find(p=>p.id===state.currentId);
    if (cur) {
      const isMe = cur.id===myId;
      document.getElementById('tbTurn').textContent = isMe ? '⭐ 你的回合' : `${cur.char?.emoji||'👤'} ${cur.name} 的回合`;
      document.getElementById('tbTurn').style.color = isMe ? '#f1c40f' : '#aaa';
    }
  }

  function renderPlayers() {
    const el = document.getElementById('playersList');
    if (!el) return;
    el.innerHTML = state.players.map(p => {
      if (!p.char) return '';
      const isMe=p.id===myId, isCur=p.id===state.currentId;
      const floorLabel={ground:'地面',upper:'二楼',basement:'地下'}[p.floor]||'';
      const artifacts = (p.items||[]).filter(i=>i.isArtifact).length;
      return `<div class="player-card ${isCur?'current':''} ${!p.alive?'dead':''} ${isMe?'mine':''}" style="--pc:${p.char.color}">
        <div class="pc-header">
          <span class="pc-emoji">${p.char.emoji}</span>
          <span class="pc-name">${p.name}${isMe?' (我)':''}</span>
          ${p.isTraitor?'<span class="traitor-badge">叛徒</span>':''}
          <span class="pc-floor">${floorLabel}</span>
        </div>
        <div class="pc-charname">${p.char.name} · ${p.char.title}</div>
        <div class="pc-stats">
          ${miniStat('⚡',p.stats.speed,p.char.stats.speed)}${miniStat('💪',p.stats.might,p.char.stats.might)}
          ${miniStat('🧠',p.stats.sanity,p.char.stats.sanity)}${miniStat('📚',p.stats.knowledge,p.char.stats.knowledge)}
        </div>
        ${p.items?.length ? `<div class="pc-items">${p.items.map(i=>`<span class="item-tag ${i.isArtifact?'artifact':''}" onclick="Game.showCard(${JSON.stringify(i).replace(/"/g,"'")})">${i.isArtifact?'✨':''} ${i.name}</span>`).join('')}</div>` : ''}
        ${artifacts>0 ? `<div class="artifact-count">神器 ${artifacts}/3 ${artifacts>=3?'⭐':'...'}</div>` : ''}
        ${!p.alive ? '<div class="dead-label">💀 已倒下</div>' : ''}
      </div>`;
    }).join('');
  }

  function miniStat(icon,cur,base) {
    const pct=Math.max(0,(cur/8)*100);
    const color=cur<base?'#e74c3c':cur>base?'#2ecc71':'#aaa';
    return `<div class="mini-stat"><span>${icon}</span><div class="mini-bar"><div class="mini-fill" style="width:${pct}%;background:${color}"></div></div><span style="color:${color}">${cur}</span></div>`;
  }

  function renderBoard() {
    const grid = document.getElementById('boardGrid');
    if (!grid) return;
    const board = state.board[currentFloor];
    const CARD_ICON = { item:'📦', event:'⚡', omen:'🩸' };
    const me = state.players.find(p=>p.id===myId);
    const isMyTurn = state.currentId===myId && !state.pendingAction && state.movesLeft>0;
    const revealed = new Set(Object.keys(board));
    const explorable = new Set();
    for (const key of revealed) {
      const [x,y] = key.split(',').map(Number);
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx=x+dx,ny=y+dy;
        if (nx>=0&&ny>=0&&nx<=6&&ny<=6&&!revealed.has(`${nx},${ny}`)) explorable.add(`${nx},${ny}`);
      }
    }
    const vm = new Set((state.validMoves||[]).filter(m=>m.floor===currentFloor).map(m=>`${m.x},${m.y}`));
    const stairMoves = (state.validMoves||[]).filter(m=>m.floor!==currentFloor);
    let html = '<div class="board-inner">';
    for (let y=0;y<=6;y++) {
      for (let x=0;x<=6;x++) {
        const k=`${x},${y}`, room=board[k];
        const isExplore=!room&&explorable.has(k), isVM=vm.has(k);
        const isHere=me&&me.floor===currentFloor&&me.pos.x===x&&me.pos.y===y;
        const occupants=state.players.filter(p=>p.alive&&p.floor===currentFloor&&p.pos.x===x&&p.pos.y===y);
        const clickable=isVM&&isMyTurn;
        if (room) {
          html+=`<div class="cell room-cell ${isHere?'here':''} ${clickable?'valid-move':''} ${room.special==='ritual_target'?'ritual':''}"
                      onclick="${clickable?`Game.move('${currentFloor}',${x},${y})`:''}">
            <div class="room-name">${room.name}${room.stairTo?' 🪜':''}</div>
            ${room.card?`<div class="room-cardtype">${CARD_ICON[room.card]}</div>`:''}
            ${room.special==='ritual_target'?'<div class="ritual-mark">⭐</div>':''}
            <div class="room-occupants">${occupants.map(p=>`<span class="token" style="background:${p.char?.color||'#888'}" title="${p.name}">${p.char?.emoji||'👤'}</span>`).join('')}</div>
          </div>`;
        } else if (isExplore) {
          html+=`<div class="cell explore-cell ${clickable?'valid-move':''}" onclick="${clickable?`Game.move('${currentFloor}',${x},${y})`:''}"><div class="explore-q">?</div></div>`;
        } else {
          html+=`<div class="cell empty-cell"></div>`;
        }
      }
    }
    html+='</div>';
    if (stairMoves.length && isMyTurn) {
      stairMoves.forEach(m => {
        const fl={upper:'二楼',basement:'地下室',ground:'地面层'}[m.floor]||m.floor;
        html+=`<button class="stair-btn" onclick="Game.move('${m.floor}',${m.x},${m.y})">🪜 前往${fl}</button>`;
      });
    }
    grid.innerHTML = html;
  }

  function switchFloor(floor) {
    currentFloor = floor;
    document.querySelectorAll('.floor-tab').forEach(t => t.classList.toggle('active', t.dataset.floor===floor));
    renderBoard();
  }

  function renderActionConsole() {
    const el = document.getElementById('actionConsole');
    if (!el) return;
    const pa = state.pendingAction;
    const isMyTurn = state.currentId === myId;
    const STAT_NAME = {speed:'速度',might:'力量',sanity:'神志',knowledge:'知识'};
    const rollDisplay = state.lastRoll ? renderDiceResult(state.lastRoll) : '';

    if (!pa || state.phase==='gameover') {
      if (state.phase==='gameover') { el.innerHTML=`<div class="ac-idle"><div class="ac-gameover">🏁 游戏结束</div></div>`; return; }
      const curPlayer = state.players.find(p=>p.id===state.currentId);
      const attacks = (state.attackTargets||[]);
      if (isMyTurn) {
        const moveHint = state.movesLeft > 0
          ? `<div class="ac-moves-info"><span class="ac-moves-icon">👣</span><span>剩余步数 <b>${state.movesLeft}</b> 步</span></div><div class="ac-hint">点击绿色格子移动，也可使用楼梯</div>`
          : `<div class="ac-moves-info moves-done"><span class="ac-moves-icon">✓</span><span>本回合移动步数已用完</span></div>`;
        const attackSection = attacks.length
          ? `<div class="ac-attack-section"><div class="ac-attack-label">⚔️ 可攻击目标（同房间）：</div>${attacks.map(tid=>{const t=state.players.find(p=>p.id===tid);return t?`<button class="btn-attack" onclick="Game.attack('${tid}')">⚔️ 攻击 ${t.char?.emoji||''} <b>${t.name}</b></button>`:''}).join('')}</div>`
          : state.phase==='haunt'&&state.hasAttackedThisTurn ? `<div class="ac-attacked-note">✓ 本回合已使用攻击</div>`
          : state.phase==='haunt' ? `<div class="ac-hint-dim">⚔️ 需与目标在同一房间才能攻击</div>`
          : `<div class="ac-hint-dim">🩸 鬼魂降临后可发起攻击</div>`;
        el.innerHTML=`<div class="ac-active-turn"><div class="ac-title-turn">⭐ 你的回合</div>${moveHint}${attackSection}${rollDisplay}<button class="btn-end-turn" onclick="Game.endTurn()">✓ 结束回合</button></div>`;
      } else {
        el.innerHTML=`<div class="ac-waiting"><div class="ac-wait-icon">⏳</div><div class="ac-wait-name">${curPlayer?.char?.emoji||'👤'} <b>${curPlayer?.name||'?'}</b> 的回合</div><div class="ac-wait-detail">剩余步数：<b>${state.movesLeft}</b> 步${state.hasAttackedThisTurn?' · 已攻击':''}</div></div>`;
      }
      return;
    }

    const isMyAction = pa.playerId === myId;
    const actPlayer = state.players.find(p=>p.id===pa.playerId);

    if (pa.type === 'draw_card') {
      const typeLabel={item:'物品',event:'事件',omen:'凶兆'}[pa.cardType]||pa.cardType;
      const typeIcon={item:'📦',event:'⚡',omen:'🩸'}[pa.cardType]||'🃏';
      const note=pa.cardType==='omen'?'<div class="ac-omen-note">🩸 摸牌后将进行凶兆检定，之后回合自动结束</div>':'<div class="ac-note">📋 摸牌后本回合自动结束</div>';
      el.innerHTML=`<div class="ac-draw-request"><div class="ac-title">${typeIcon} ${actPlayer?.name||'?'} — 摸${typeLabel}牌</div><div class="ac-subtitle">进入【${pa.roomName||'?'}】，须翻开一张${typeLabel}牌</div>${note}${isMyAction?`<button class="btn-draw btn-${pa.cardType}" onclick="Game.drawCard()">🃏 翻牌！</button>`:`<div class="ac-wait-other">等待 ${actPlayer?.name||'?'} 翻牌…</div>`}</div>`;
    }
    else if (pa.type === 'roll_check') {
      const card=pa.card||state.currentCard, matchedIdx=state.lastRoll?.matchedOutcomeIdx;
      const effLabel=e=>{if(e.type==='stat')return`${STAT_NAME[e.stat]||e.stat}${e.val>0?'+':''}${e.val}`;if(e.type==='teleport')return`传送`;if(e.type==='next_turn_bonus')return`下回合+${e.steps}步`;return'';};
      const tiersHtml=pa.outcomes?`<div class="ac-tiers">${pa.outcomes.map((o,i)=>{const isM=matchedIdx!==undefined&&matchedIdx===i;const eff=(o.effects||[]).map(effLabel).filter(Boolean).join('，')||'无效果';return`<div class="ac-tier${isM?' matched':''}"><span class="tier-label">${o.label}</span><span class="tier-body"><span class="tier-desc">${o.desc}</span><span class="tier-eff">${eff}</span></span></div>`;}).join('')}</div>`:'';
      const afterNote=pa.isOmenCard?'<div class="ac-omen-note">🩸 检定后还需进行凶兆检定（掷6枚骰）</div>':'<div class="ac-note">📋 检定后本回合自动结束</div>';
      el.innerHTML=`<div class="ac-check"><div class="ac-title">🎲 ${STAT_NAME[pa.checkStat]}检定${pa.isOmenCard?' 🩸':''} — 掷 <b>${pa.diceCount}</b> 枚骰</div>${card?`<div class="ac-card-inline"><div class="ac-card-name">${card.name}</div><div class="ac-card-flavor">"${card.flavor||''}"</div></div>`:''} ${tiersHtml}${rollDisplay}${afterNote}${isMyAction?`<button class="btn-dice" onclick="Game.rollDice()" ${diceRollInProgress?'disabled':''}>🎲 掷${STAT_NAME[pa.checkStat]}骰！</button>`:`<div class="ac-wait-other">等待 ${actPlayer?.name||'?'} 掷骰…</div>`}</div>`;
    }
    else if (pa.type === 'roll_haunt') {
      el.innerHTML=`<div class="ac-haunt-check"><div class="ac-title">🩸 凶兆检定！</div><div class="ac-subtitle">固定掷 <b>6</b> 枚骰，已积累 <b>${state.omenCount}</b> 个凶兆</div><div class="ac-check-rule">结果 <b class="danger">小于 ${state.omenCount}</b> → 幽灵降临！ 结果 <b class="success">≥ ${state.omenCount}</b> → 暂时安全</div><div class="ac-note">📋 检定后本回合自动结束</div>${rollDisplay}${isMyAction?`<button class="btn-dice btn-haunt" onclick="Game.rollDice()" ${diceRollInProgress?'disabled':''}>🎲 进行凶兆检定！</button>`:`<div class="ac-wait-other">等待 ${actPlayer?.name||'?'} 掷骰…</div>`}</div>`;
    }
    else if (pa.type === 'roll_combat_atk') {
      const atk=state.players.find(p=>p.id===pa.attackerId), def=state.players.find(p=>p.id===pa.defenderId);
      el.innerHTML=`<div class="ac-combat"><div class="ac-title">⚔️ 战斗 — 攻击方掷骰</div><div class="ac-combat-matchup"><span style="color:${atk?.char?.color||'#fff'}">${atk?.char?.emoji||''} ${atk?.name||'?'}</span><span class="vs">⚔️</span><span style="color:${def?.char?.color||'#fff'}">${def?.char?.emoji||''} ${def?.name||'?'}</span></div><div class="ac-subtitle"><b>${atk?.name||'?'}</b> 掷力量骰（${pa.diceCount}枚）</div><div class="ac-combat-rule">攻方总数 − 守方总数 = 守方受到的伤害</div>${rollDisplay}${isMyAction?`<button class="btn-dice btn-attack-dice" onclick="Game.rollDice()" ${diceRollInProgress?'disabled':''}>🎲 掷攻击骰！</button>`:`<div class="ac-wait-other">等待 ${atk?.name||'?'} 掷骰…</div>`}</div>`;
    }
    else if (pa.type === 'roll_combat_def') {
      const atk=state.players.find(p=>p.id===pa.attackerId), def=state.players.find(p=>p.id===pa.defenderId);
      el.innerHTML=`<div class="ac-combat"><div class="ac-title">🛡 战斗 — 防御方掷骰</div><div class="ac-combat-matchup"><span style="color:${atk?.char?.color||'#fff'}">${atk?.char?.emoji||''} 攻击值 = <b>${pa.atkTotal}</b></span></div><div class="ac-subtitle"><b>${def?.name||'?'}</b> 掷力量骰（${pa.diceCount}枚）</div><div class="ac-combat-rule">防御总数 ≥ 攻击值 → 防御成功；否则受差值伤害</div>${rollDisplay}${isMyAction?`<button class="btn-dice btn-defend-dice" onclick="Game.rollDice()" ${diceRollInProgress?'disabled':''}>🎲 掷防御骰！</button>`:`<div class="ac-wait-other">等待 ${def?.name||'?'} 掷骰…</div>`}</div>`;
    }
  }

  function renderDiceResult(roll) {
    if (!roll) return '';
    return `<div class="dice-result"><div class="dice-row">${roll.dice.map(d=>`<div class="die die-${d}">${d}</div>`).join('')}</div><div class="dice-total">总计 <b>${roll.total}</b></div></div>`;
  }

  function renderCardHistory() {
    const el = document.getElementById('cardHistory');
    if (!el) return;
    const cards = state.drawnCards || [];
    if (!cards.length) { el.innerHTML = '<div class="history-empty">暂无翻开的牌</div>'; return; }
    el.innerHTML = cards.slice().reverse().map(c => {
      const typeIcon={item:'📦',event:'⚡',omen:'🩸'}[c.type]||'🃏';
      const drawerName=state.players.find(p=>p.id===c.drawnBy)?.name||'?';
      return `<div class="history-card history-${c.type}" onclick="Game.showCardById('${c.id}')"><span class="hc-icon">${typeIcon}</span><span class="hc-name">${c.name}</span><span class="hc-who">${drawerName}</span></div>`;
    }).join('');
  }

  function renderLog() {
    const el = document.getElementById('eventLog');
    if (!el) return;
    el.innerHTML = state.log.map(e=>`<div class="log-entry log-${e.type||'normal'}">${e.text}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  function showCard(card) {
    if (!card) return;
    const typeLabel={item:'物品牌',event:'事件牌',omen:'凶兆牌'}[card.type]||card.type;
    const modal = document.getElementById('cardModal');
    document.getElementById('modalType').textContent = typeLabel;
    document.getElementById('modalType').className = `modal-type mtype-${card.type}`;
    document.getElementById('modalName').textContent = card.name;
    document.getElementById('modalFlavor').textContent = `"${card.flavor||card.desc||''}"`;
    const sn={speed:'速度',might:'力量',sanity:'神志',knowledge:'知识'};
    const effLabel=e=>{if(e.type==='stat')return`${sn[e.stat]||e.stat}${e.val>0?'+':''}${e.val}`;if(e.type==='teleport')return`传送`;if(e.type==='next_turn_bonus')return`下回合+${e.steps}步`;return'';};
    let effectHtml='';
    if (card.outcomes) {
      effectHtml=`<div class="modal-check"><div class="modal-check-header">【${sn[card.checkStat]}检定】掷当前属性值数量骰子</div><div class="modal-tiers">${card.outcomes.map(o=>`<div class="modal-tier"><span class="modal-tier-label">${o.label}</span><div class="modal-tier-content"><div class="modal-tier-desc">${o.desc}</div><div class="modal-tier-eff">${(o.effects||[]).map(effLabel).filter(Boolean).join('，')||'无效果'}</div></div></div>`).join('')}</div>${card.type==='omen'?'<div class="modal-omen-note">🩸 检定后还需进行凶兆检定（掷6枚骰子）</div>':''}</div>`;
    } else if (card.effects?.length || card.effectDesc) {
      effectHtml=`<div class="modal-effect-flat">${card.effectDesc||card.effects?.map(effLabel).filter(Boolean).join('，')||''}</div>`;
      if (card.type==='omen') effectHtml+='<div class="modal-omen-note">🩸 摸到后进行凶兆检定（掷6枚骰子）</div>';
    }
    if (card.isArtifact) effectHtml+='<div class="modal-artifact">✨ 仪式神器 — 收集三件在五芒星室完成仪式！</div>';
    document.getElementById('modalEffectArea').innerHTML = effectHtml;
    modal.style.display = 'flex';
  }

  function showCardById(id) { const card=state.drawnCards?.find(c=>c.id===id); if(card) showCard(card); }
  function showCurrentCard() { showCard(state?.currentCard); }

  function renderOverlays(prev) {
    if (state.haunt && !lastHauntShown) {
      lastHauntShown=true;
      const am=state.haunt.amTraitor;
      document.getElementById('hauntScenario').textContent=state.haunt.scenario;
      document.getElementById('hauntRole').textContent=am?'☠️  你是叛徒！':'🦸 你是英雄！';
      document.getElementById('hauntRole').style.color=am?'#e74c3c':'#2ecc71';
      document.getElementById('hauntGoal').textContent=am?state.haunt.traitorGoal:state.haunt.heroGoal;
      document.getElementById('hauntOverlay').style.display='flex';
    }
    if (state.phase==='gameover' && !lastGameoverShown) {
      lastGameoverShown=true;
      clearSession(); // 游戏正式结束，清除恢复凭证
      const win=state.winner;
      document.getElementById('goIcon').textContent=win==='heroes'?'🎉':'💀';
      document.getElementById('goTitle').textContent=win==='heroes'?'英雄胜利！':'叛徒胜利！';
      document.getElementById('goMsg').textContent=state.log[state.log.length-1]?.text||'';
      if(state.hostId===myId) document.getElementById('goRestart').style.display='inline-block';
      document.getElementById('gameoverOverlay').style.display='flex';
    }
  }

  function rollDice() {
    if (diceRollInProgress) return;
    diceRollInProgress=true;
    setTimeout(()=>{ diceRollInProgress=false; send({type:'roll_dice',data:{}}); }, 400);
  }

  function drawCard()          { send({type:'draw_card',data:{}}); }
  function move(floor,x,y)    { send({type:'move',data:{floor,x:+x,y:+y}}); }
  function endTurn()           { send({type:'end_turn',data:{}}); }
  function attack(targetId)    { send({type:'attack',data:{targetId}}); }
  function restart() {
    clearSession();
    lastHauntShown=false; lastGameoverShown=false;
    send({type:'restart',data:{}});
    document.getElementById('gameoverOverlay').style.display='none';
    document.getElementById('hauntOverlay').style.display='none';
    switchScreen('charsel');
  }

  document.addEventListener('keydown', e => {
    if (e.key==='Tab' && document.getElementById('screen-game').classList.contains('active')) {
      e.preventDefault();
      const floors=['ground','upper','basement'];
      switchFloor(floors[(floors.indexOf(currentFloor)+1)%3]);
    }
  });

  // 游戏结束时清除 session
  const _origRenderOverlays = renderOverlays;

  // ── 页面加载：若有未完成会话，自动重连恢复 ────────────────────────────────────
  // client.js 在 <body> 底部加载，DOM 已就绪，直接调用（不能等 DOMContentLoaded，因为事件已触发）
  tryRestoreSession();

  return { createRoom, joinRoom, selectChar, startGame, rollDice, drawCard, move, endTurn, attack, switchFloor, restart, showCard, showCardById, showCurrentCard };
})();
