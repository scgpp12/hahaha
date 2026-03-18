// ══════════════════════════════════════════════════════════════════════════════
// $connect 路由 — 客户端建立 WebSocket 连接时调用
// 仅记录 connectionId，游戏关联在 create_game / join_game 消息中完成
// ══════════════════════════════════════════════════════════════════════════════
const { saveConnection } = require('./db');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  console.log('connect', connectionId);

  // 仅写入 connectionId，gameCode/playerId 在 create_game/join_game 时更新
  await saveConnection(connectionId, null, null);

  return { statusCode: 200, body: 'Connected' };
};
