// ══════════════════════════════════════════════════════════════════════════════
// DynamoDB 操作封装
// 表结构：
//   SwjhConnections  PK: connectionId  GSI: gameCode-index (gameCode)
//   SwjhGames        PK: gameCode
// ══════════════════════════════════════════════════════════════════════════════
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand, GetCommand, DeleteCommand, QueryCommand
} = require('@aws-sdk/lib-dynamodb');

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONN_TABLE  = process.env.CONNECTIONS_TABLE || 'SwjhConnections';
const GAMES_TABLE = process.env.GAMES_TABLE       || 'SwjhGames';
const TTL_SEC     = 86400; // 24 小时 DynamoDB TTL

// ── 连接表 ────────────────────────────────────────────────────────────────────
async function saveConnection(connectionId, gameCode, playerId) {
  await dynamo.send(new PutCommand({
    TableName: CONN_TABLE,
    Item: {
      connectionId,
      gameCode,
      playerId,
      ttl: Math.floor(Date.now() / 1000) + TTL_SEC,
    },
  }));
}

async function getConnection(connectionId) {
  const res = await dynamo.send(new GetCommand({
    TableName: CONN_TABLE,
    Key: { connectionId },
  }));
  return res.Item || null;
}

async function deleteConnection(connectionId) {
  await dynamo.send(new DeleteCommand({
    TableName: CONN_TABLE,
    Key: { connectionId },
  }));
}

// 根据 gameCode 查询所有连接（通过 GSI）
async function getConnectionsByGame(gameCode) {
  const res = await dynamo.send(new QueryCommand({
    TableName: CONN_TABLE,
    IndexName: 'gameCode-index',
    KeyConditionExpression: 'gameCode = :gc',
    ExpressionAttributeValues: { ':gc': gameCode },
  }));
  return res.Items || [];
}

// ── 游戏表 ────────────────────────────────────────────────────────────────────
async function saveGame(game) {
  // 序列化时去掉不可序列化的字段（如 ws 引用）
  const clean = JSON.parse(JSON.stringify(game, (k, v) =>
    k === 'ws' ? undefined : v
  ));
  await dynamo.send(new PutCommand({
    TableName: GAMES_TABLE,
    Item: {
      gameCode: game.code,
      state:    JSON.stringify(clean),
      ttl:      Math.floor(Date.now() / 1000) + TTL_SEC,
    },
  }));
}

async function getGame(gameCode) {
  const res = await dynamo.send(new GetCommand({
    TableName: GAMES_TABLE,
    Key: { gameCode },
  }));
  if (!res.Item) return null;
  return JSON.parse(res.Item.state);
}

async function deleteGame(gameCode) {
  await dynamo.send(new DeleteCommand({
    TableName: GAMES_TABLE,
    Key: { gameCode },
  }));
}

module.exports = {
  saveConnection, getConnection, deleteConnection, getConnectionsByGame,
  saveGame, getGame, deleteGame,
};
