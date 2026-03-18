// ══════════════════════════════════════════════════════════════════════════════
// $disconnect 路由 — 客户端断开连接时调用
// ══════════════════════════════════════════════════════════════════════════════
const { getConnection, deleteConnection, getConnectionsByGame, getGame, saveGame } = require('./db');
const { broadcastGame } = require('./broadcast');
const { publicState, addLog } = require('./gameLogic');

const WS_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  console.log('disconnect', connectionId);

  const conn = await getConnection(connectionId);

  if (conn?.gameCode) {
    const game = await getGame(conn.gameCode);
    if (game) {
      const player = game.players[conn.playerId];
      if (player) {
        addLog(game, `👤 ${player.name} 断开了连接`, 'leave');
        delete game.players[conn.playerId];
      }

      const remaining = Object.keys(game.players).length;
      if (remaining === 0) {
        // 游戏无人则不保存（TTL 自动清理）
      } else {
        await saveGame(game);
        // 广播给其余玩家
        const connections = await getConnectionsByGame(conn.gameCode);
        const activeConns = connections.filter(c => c.connectionId !== connectionId);
        if (activeConns.length > 0) {
          await broadcastGame(game, activeConns, publicState, WS_ENDPOINT);
        }
      }
    }
  }

  await deleteConnection(connectionId);
  return { statusCode: 200, body: 'Disconnected' };
};
