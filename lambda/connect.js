// ══════════════════════════════════════════════════════════════════════════════
// $connect 路由 — 客户端建立 WebSocket 连接时调用
// 仅记录 connectionId，游戏关联在 create_game / join_game 消息中完成
// ══════════════════════════════════════════════════════════════════════════════
const { saveConnection } = require('./db');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  console.log('connect', connectionId);

  // 先以空 gameCode 写入，等 create_game/join_game 再更新
  await saveConnection(connectionId, '', '');

  return { statusCode: 200, body: 'Connected' };
};
