// ══════════════════════════════════════════════════════════════════════════════
// API Gateway WebSocket 广播封装
// ══════════════════════════════════════════════════════════════════════════════
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');
const { deleteConnection } = require('./db');

function makeClient(endpoint) {
  return new ApiGatewayManagementApiClient({ endpoint });
}

// 向单个连接发送消息
async function sendTo(connectionId, data, endpoint) {
  const client = makeClient(endpoint);
  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data)),
    }));
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 410) {
      // 连接已失效，从 DynamoDB 清除
      await deleteConnection(connectionId).catch(() => {});
    } else {
      console.error('sendTo error', connectionId, e.message);
    }
  }
}

// 向游戏所有连接广播状态（每个玩家看到的状态不同，通过 publicState 区分）
async function broadcastGame(game, connections, publicStateFn, endpoint) {
  await Promise.all(
    connections.map(conn =>
      sendTo(
        conn.connectionId,
        { type: 'state', data: publicStateFn(game, conn.playerId) },
        endpoint
      )
    )
  );
}

module.exports = { sendTo, broadcastGame };
