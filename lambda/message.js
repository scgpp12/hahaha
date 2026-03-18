// ══════════════════════════════════════════════════════════════════════════════
// $default 路由 — 所有游戏消息的主处理器
// ══════════════════════════════════════════════════════════════════════════════
const {
  CHARACTERS, createGame, addLog, mkPending, startGame, nextTurn,
  handleRollDice, handleDrawCard, checkWin, publicState,
  genCode, genId, posKey, validMoves, attackTargets,
} = require('./gameLogic');
const { saveConnection, getConnection, getConnectionsByGame, saveGame, getGame } = require('./db');
const { broadcastGame, sendTo } = require('./broadcast');

const WS_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

// ── 工具 ──────────────────────────────────────────────────────────────────────
async function reply(connectionId, obj) {
  await sendTo(connectionId, obj, WS_ENDPOINT);
}

async function broadcast(game, connections) {
  await broadcastGame(game, connections, publicState, WS_ENDPOINT);
}

// ── 主 Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  let msg;
  try { msg = JSON.parse(event.body); } catch { return { statusCode: 400 }; }

  const { type, data = {} } = msg;
  console.log('message', type, connectionId);

  // ──────────────────────────────────────────────────────────────────────────
  // create_game — 创建新房间
  // ──────────────────────────────────────────────────────────────────────────
  if (type === 'create_game') {
    // 生成唯一房间码（最多重试10次）
    let code, existing;
    for (let i = 0; i < 10; i++) {
      code = genCode();
      existing = await getGame(code);
      if (!existing) break;
    }

    const playerId = genId();
    const game = createGame(code);
    game.hostId = playerId;
    game.players[playerId] = {
      id: playerId, name: data.name || '房主',
      charId: null, char: null,
      floor: 'ground', pos: { x: 3, y: 3 },
      stats: null, items: [], alive: true, isTraitor: false,
    };

    await saveGame(game);
    await saveConnection(connectionId, code, playerId);

    await reply(connectionId, { type: 'game_created', playerId, code });
    await reply(connectionId, { type: 'state', data: publicState(game, playerId) });
    return { statusCode: 200 };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // join_game — 加入已有房间
  // ──────────────────────────────────────────────────────────────────────────
  if (type === 'join_game') {
    const code = (data.code || '').toUpperCase().trim();
    const game = await getGame(code);
    if (!game)                                   { await reply(connectionId, { type: 'error', msg: '房间不存在' }); return { statusCode: 200 }; }
    if (game.phase !== 'lobby')                  { await reply(connectionId, { type: 'error', msg: '游戏已开始，无法加入' }); return { statusCode: 200 }; }
    if (Object.keys(game.players).length >= 6)   { await reply(connectionId, { type: 'error', msg: '房间已满（最多6人）' }); return { statusCode: 200 }; }

    const playerId = genId();
    game.players[playerId] = {
      id: playerId, name: data.name || `玩家${Object.keys(game.players).length + 1}`,
      charId: null, char: null,
      floor: 'ground', pos: { x: 3, y: 3 },
      stats: null, items: [], alive: true, isTraitor: false,
    };
    addLog(game, `👤 ${game.players[playerId].name} 加入了游戏`, 'join');

    await saveGame(game);
    await saveConnection(connectionId, code, playerId);

    await reply(connectionId, { type: 'game_joined', playerId, code });

    const connections = await getConnectionsByGame(code);
    await broadcast(game, connections);
    return { statusCode: 200 };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 以下消息需要已关联游戏的连接
  // ──────────────────────────────────────────────────────────────────────────
  const conn = await getConnection(connectionId);
  if (!conn?.gameCode) return { statusCode: 200 };

  const game = await getGame(conn.gameCode);
  if (!game) return { statusCode: 200 };

  const player = game.players[conn.playerId];
  if (!player) return { statusCode: 200 };

  const playerId = conn.playerId;

  switch (type) {

    case 'select_char': {
      const char = CHARACTERS.find(c => c.id === data.charId);
      if (!char) break;
      if (Object.values(game.players).some(p => p.id !== playerId && p.charId === char.id)) {
        await reply(connectionId, { type: 'error', msg: '该角色已被选择' }); break;
      }
      player.charId = char.id; player.char = char; player.stats = { ...char.stats };
      addLog(game, `${player.name} 选择了 ${char.emoji} ${char.name}（${char.title}）`, 'join');
      break;
    }

    case 'start_game': {
      if (playerId !== game.hostId) break;
      const ps = Object.values(game.players);
      if (ps.length < 2)           { await reply(connectionId, { type: 'error', msg: '至少需要2名玩家' }); break; }
      if (ps.some(p => !p.charId)) { await reply(connectionId, { type: 'error', msg: '所有玩家必须选择角色' }); break; }
      startGame(game);
      break;
    }

    case 'roll_dice': {
      if (game.phase === 'gameover') break;
      handleRollDice(game, player);
      checkWin(game);
      break;
    }

    case 'draw_card': {
      if (game.phase === 'gameover') break;
      handleDrawCard(game, player);
      checkWin(game);
      break;
    }

    case 'move': {
      if (game.phase === 'gameover') break;
      if (game.turnOrder[game.currentIdx] !== playerId) break;
      if (game.pendingAction) { await reply(connectionId, { type: 'error', msg: '请先完成当前事件' }); break; }
      if (game.movesLeft <= 0) { await reply(connectionId, { type: 'error', msg: '移动步数已用完' }); break; }

      const { floor, x, y } = data;
      const legal = validMoves(game, player);
      if (!legal.some(m => m.floor === floor && m.x === x && m.y === y)) {
        await reply(connectionId, { type: 'error', msg: '非法移动' }); break;
      }

      player.floor = floor; player.pos = { x, y };

      let room = game.board[floor][posKey(x, y)];
      let isNew = false;
      if (!room) {
        const deck = game.decks[floor];
        const tile = deck.length > 0 ? deck.pop() : { id: `hall_${x}_${y}`, name: '走廊', card: null };
        game.board[floor][posKey(x, y)] = tile;
        room = tile; isNew = true;
        addLog(game, `🔍 ${player.name} 发现了新房间：【${room.name}】`, 'explore');
      } else {
        addLog(game, `👣 ${player.name} 移动到【${room.name}】`, 'move');
      }

      if (isNew && room.card) {
        game.movesLeft = 0;
        game.pendingAction = mkPending('draw_card', playerId, { cardType: room.card, roomName: room.name });
        addLog(game, `📋 【${room.name}】有卡牌符号，须摸牌（摸牌后回合自动结束）`, 'normal');
      } else {
        game.movesLeft--;
      }
      break;
    }

    case 'end_turn': {
      if (game.turnOrder[game.currentIdx] !== playerId) break;
      if (game.pendingAction) { await reply(connectionId, { type: 'error', msg: '请先完成当前必要操作' }); break; }
      if (game.phase === 'gameover') break;
      addLog(game, `${player.name} 结束了回合。`, 'normal');
      nextTurn(game);
      break;
    }

    case 'attack': {
      if (game.phase !== 'haunt') { await reply(connectionId, { type: 'error', msg: '鬼魂降临前无法攻击' }); break; }
      if (game.turnOrder[game.currentIdx] !== playerId) break;
      if (game.hasAttackedThisTurn) { await reply(connectionId, { type: 'error', msg: '本回合已经攻击过了' }); break; }
      if (game.pendingAction) { await reply(connectionId, { type: 'error', msg: '请先完成当前事件' }); break; }

      const target = game.players[data.targetId];
      if (!target || !target.alive) break;
      if (player.isTraitor === target.isTraitor) break;
      if (target.floor !== player.floor || target.pos.x !== player.pos.x || target.pos.y !== player.pos.y) {
        await reply(connectionId, { type: 'error', msg: '必须与目标在同一房间才能攻击' }); break;
      }

      game.hasAttackedThisTurn = true;
      game.combatCtx = { attackerId: playerId, defenderId: target.id, atkTotal: 0 };
      game.pendingAction = mkPending('roll_combat_atk', playerId, {
        diceCount: player.stats.might, attackerId: playerId, defenderId: target.id,
      });
      addLog(game, `⚔️  ${player.name}（力量${player.stats.might}）向 ${target.name}（力量${target.stats.might}）发起攻击！`, 'combat');
      break;
    }

    case 'restart': {
      if (playerId !== game.hostId) break;
      const ng = createGame(game.code);
      ng.hostId = game.hostId;
      for (const [id, p] of Object.entries(game.players)) {
        ng.players[id] = { ...p, charId: null, char: null, stats: null, items: [], alive: true, isTraitor: false, floor: 'ground', pos: { x: 3, y: 3 } };
      }
      await saveGame(ng);
      const connections = await getConnectionsByGame(game.code);
      await broadcast(ng, connections);
      return { statusCode: 200 };
    }

    default:
      console.log('unknown message type:', type);
  }

  // 保存游戏状态并广播
  await saveGame(game);
  const connections = await getConnectionsByGame(conn.gameCode);
  await broadcast(game, connections);

  return { statusCode: 200 };
};
