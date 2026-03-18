// ══════════════════════════════════════════════════════════════════════════════
// 山屋惊魂 — WebSocket 多人桌游服务器  v3 (严格遵照官方规则)
// ══════════════════════════════════════════════════════════════════════════════
// 关键规则：
//  1. 移动不掷骰，步数 = 当前速度属性值
//  2. 进入有符号的新房间时，必须停止移动并摸牌
//  3. 触发任何卡牌事件（摸牌+结算）后，本回合自动结束
//  4. 凶兆检定固定掷 6 枚骰子（对比总凶兆数）
//  5. 鬼魂降临前，属性最低为 1，不会死亡
//  6. 每回合只能攻击一次（鬼魂降临后），攻击不结束回合
//  7. 攻击双方需在同一房间（同一格）
// ══════════════════════════════════════════════════════════════════════════════
const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req, res) => {
  const fp = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    res.end(data);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GAME DATA
// ══════════════════════════════════════════════════════════════════════════════

const CHARACTERS = [
  { id:'zoe',    name:'佐伊',   title:'小女孩',   color:'#e91e63', emoji:'👧', stats:{ speed:4, might:2, sanity:4, knowledge:3 }, desc:'直觉敏锐，感知神秘力量，但体力较弱。' },
  { id:'ox',     name:'牛仔',   title:'运动员',   color:'#ff5722', emoji:'🤠', stats:{ speed:3, might:5, sanity:3, knowledge:2 }, desc:'力大无穷，是战斗中最可靠的伙伴。' },
  { id:'father', name:'神父',   title:'传教士',   color:'#9c27b0', emoji:'✝️',  stats:{ speed:2, might:3, sanity:5, knowledge:4 }, desc:'信仰坚定，神志超强，知识渊博。' },
  { id:'vivian', name:'薇薇安', title:'灵媒',     color:'#3f51b5', emoji:'🔮', stats:{ speed:3, might:2, sanity:4, knowledge:5 }, desc:'洞察灵界，知识惊人，但体力不足。' },
  { id:'darrin', name:'达林',   title:'运动明星', color:'#009688', emoji:'⚡', stats:{ speed:5, might:4, sanity:3, knowledge:2 }, desc:'速度最快，行动灵活，适合探索。' },
  { id:'jenny',  name:'珍妮',   title:'侦探',     color:'#795548', emoji:'🔍', stats:{ speed:4, might:3, sanity:3, knowledge:4 }, desc:'均衡发展，洞察力强，适应性极佳。' },
];

const STARTING_ROOMS = {
  ground: [
    { id:'entrance', name:'门厅',   card:null, desc:'古宅正门，四周弥漫着霉味，门已经关不上了。',                     pos:{x:3,y:3} },
    { id:'foyer',    name:'前厅',   card:null, desc:'一架古旧的楼梯通向地下室，每一步都发出刺耳的嘎吱声。',           pos:{x:3,y:4}, stairTo:{floor:'basement',x:3,y:3} },
    { id:'stair_g',  name:'大楼梯', card:null, desc:'华丽的螺旋楼梯通向二楼，扶手已经腐烂断裂，不知多久没人走过。',  pos:{x:4,y:3}, stairTo:{floor:'upper',x:3,y:3} },
  ],
  upper: [
    { id:'upper_hall', name:'二楼走廊', card:null, desc:'昏暗的走廊延伸向黑暗深处，地板吱吱作响，窗外是漆黑的夜。', pos:{x:3,y:3}, stairTo:{floor:'ground',x:4,y:3} },
  ],
  basement: [
    { id:'base_hall', name:'地下走廊', card:null, desc:'潮湿的墙壁上布满苔藓，滴水声在黑暗中规律地回响。',            pos:{x:3,y:3}, stairTo:{floor:'ground',x:3,y:4} },
  ],
};

const TILE_DECK = {
  ground: [
    { id:'dining',   name:'餐厅',     card:'event', desc:'长桌上摆着腐烂的食物，空气中弥漫着死亡的气息。' },
    { id:'kitchen',  name:'厨房',     card:'item',  desc:'铁锅还在冒着黑烟，灶台上散落着奇怪的东西。' },
    { id:'parlor',   name:'客厅',     card:'event', desc:'挂毯上描绘着可怕的图案，壁炉里燃烧着蓝色火焰。' },
    { id:'library',  name:'书房',     card:'omen',  desc:'书架上全是禁忌书籍，有几本封面在微微颤抖。' },
    { id:'ballroom', name:'舞厅',     card:'event', desc:'幽灵的舞步在地板上留下了足迹，音乐无声回响。' },
    { id:'garden',   name:'花园',     card:'item',  desc:'枯萎的玫瑰丛中隐藏着遗落的物品。' },
    { id:'cloak',    name:'衣帽间',   card:'item',  desc:'厚重的外套里可能藏着有用的东西。' },
    { id:'conserv',  name:'温室',     card:'omen',  desc:'植物在黑暗中低语，触手般的藤蔓悄悄伸向你。' },
    { id:'pent',     name:'五芒星室', card:null,    desc:'地板上刻着五芒星阵，这里是完成仪式的神圣之地。', special:'ritual_target' },
  ],
  upper: [
    { id:'master',    name:'主卧室',  card:'omen',  desc:'床铺久未整理，枕头上有不明液体的深色痕迹。' },
    { id:'bedroom',   name:'卧室',    card:'event', desc:'镜子里出现了陌生的面孔，随即消失在黑暗中。' },
    { id:'nursery',   name:'育儿室',  card:'omen',  desc:'摇篮在无风中自顾自地摇动，令人毛骨悚然。' },
    { id:'attic',     name:'阁楼',    card:'omen',  desc:'被锁住的木箱里传出抓挠声，越来越急促。' },
    { id:'gallery',   name:'画廊',    card:'event', desc:'画中人的眼睛随着你的移动而转动，始终盯着你。' },
    { id:'trophy',    name:'荣耀室',  card:'item',  desc:'墙上挂满了猎物标本，架子上散落着战利品。' },
    { id:'collapsed', name:'废墟',    card:'event', desc:'这里的地板已经腐烂，脚踩上去随时可能塌陷。' },
    { id:'storage',   name:'储藏室',  card:'item',  desc:'杂乱的储藏室里不知道埋藏着什么秘密。' },
  ],
  basement: [
    { id:'furnace',   name:'锅炉房',  card:'event', desc:'巨大的锅炉轰鸣着，高温和蒸汽让人窒息喘不过气。' },
    { id:'vault',     name:'密室',    card:'item',  desc:'厚重的铁门后隐藏着上任主人的宝贵遗产。' },
    { id:'catacombs', name:'地下墓穴', card:'omen', desc:'无数头骨堆砌在墙边，空洞的眼眶凝视着你。' },
    { id:'crypt',     name:'地窖',    card:'omen',  desc:'腐臭扑鼻，不明液体在石缝中缓缓流淌。' },
    { id:'coal',      name:'煤炭间',  card:'item',  desc:'煤灰之下埋藏着前人遗落的物品。' },
    { id:'ritual',    name:'祭祀室',  card:'omen',  desc:'祭坛上的鲜血还是湿的，火把依旧诡异地燃烧。' },
    { id:'tunnel',    name:'秘道',    card:'event', desc:'黑暗的隧道通向未知的方向，空气中有低语声。' },
  ],
};

// ── 物品牌（道具卡） ──────────────────────────────────────────────────────────
// 摸到物品牌：放在面前，立即生效一次，回合结束
const ITEM_CARDS = [
  { id:'candle',  name:'古老蜡烛', type:'item', flavor:'一根插在骷髅烛台上的蜡烛，火焰呈诡异的蓝色。',   checkStat:null, effects:[{type:'stat',stat:'knowledge',val:1}], effectDesc:'知识 +1', isArtifact:false },
  { id:'knife',   name:'锈迹匕首', type:'item', flavor:'一把旧匕首，锈迹斑斑，但刃口依然锋利。',          checkStat:null, effects:[{type:'stat',stat:'might',val:1}],    effectDesc:'力量 +1', isArtifact:false },
  { id:'amulet',  name:'护身符',   type:'item', flavor:'古老的符文护身符，戴上后感觉轻松了许多。',         checkStat:null, effects:[{type:'stat',stat:'sanity',val:2}],   effectDesc:'神志 +2', isArtifact:false },
  { id:'tome',    name:'禁忌古籍', type:'item', flavor:'充满了可怕的知识，既让人着迷又令人恐惧。',         checkStat:null, effects:[{type:'stat',stat:'knowledge',val:2},{type:'stat',stat:'sanity',val:-1}], effectDesc:'知识 +2，神志 -1', isArtifact:false },
  { id:'ring',    name:'神秘戒指', type:'item', flavor:'戴上后浑身充满活力，步伐也轻盈了起来。',           checkStat:null, effects:[{type:'stat',stat:'speed',val:1}],    effectDesc:'速度 +1', isArtifact:false },
  { id:'armor',   name:'古代铠甲', type:'item', flavor:'虽然陈旧，但穿上后感到有力量支撑着你。',           checkStat:null, effects:[{type:'stat',stat:'might',val:2}],    effectDesc:'力量 +2', isArtifact:false },
  { id:'idol',    name:'邪神像',   type:'item', flavor:'精工铸造的神像，散发着一种令人不安的气息。',       checkStat:null, effects:[], effectDesc:'仪式神器，收集三件即可完成仪式！', isArtifact:true },
  { id:'crystal', name:'黑水晶',   type:'item', flavor:'漆黑的水晶内部有微光流动，像是有什么东西活着。', checkStat:null, effects:[], effectDesc:'仪式神器，收集三件即可完成仪式！', isArtifact:true },
  { id:'scroll',  name:'古卷轴',   type:'item', flavor:'羊皮纸上写满了古老的咒文，触碰时手指微微发麻。', checkStat:null, effects:[], effectDesc:'仪式神器，收集三件即可完成仪式！', isArtifact:true },
];

// ── 事件牌 ────────────────────────────────────────────────────────────────────
// 需要进行属性检定，多档结果。摸牌后 → 进行检定 → 回合结束
const EVENT_CARDS = [
  { id:'ev1', name:'迷失神志', type:'event',
    flavor:'黑暗中传来低语，意识开始模糊，你分不清幻觉与现实……',
    checkStat:'sanity', outcomes:[
      { minRoll:5, label:'≥5',  desc:'意志力抵挡了侵袭，你看穿了幻觉本质。神志 +1。',       effects:[{type:'stat',stat:'sanity',val:1}] },
      { minRoll:3, label:'3–4', desc:'幻觉散去，只留下轻微不适。',                           effects:[] },
      { minRoll:1, label:'1–2', desc:'神志动摇，现实感受到严重冲击！神志 -2。',              effects:[{type:'stat',stat:'sanity',val:-2}] },
      { minRoll:0, label:'0',   desc:'你完全迷失！神志 -3，被传送到地下走廊。',               effects:[{type:'stat',stat:'sanity',val:-3},{type:'teleport',floor:'basement',roomId:'base_hall'}] },
    ]
  },
  { id:'ev2', name:'血腥影像', type:'event',
    flavor:'眼前浮现出无数扭曲的面孔，鲜血从墙壁上缓缓渗出……',
    checkStat:'sanity', outcomes:[
      { minRoll:4, label:'≥4',  desc:'你直面最深的恐惧，更加坚定。神志 +1，力量 +1。',      effects:[{type:'stat',stat:'sanity',val:1},{type:'stat',stat:'might',val:1}] },
      { minRoll:2, label:'2–3', desc:'影像消散，阴影留在心里。神志 -1。',                    effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:0, label:'0–1', desc:'被血腥幻象完全淹没，几乎昏厥！神志 -3。',              effects:[{type:'stat',stat:'sanity',val:-3}] },
    ]
  },
  { id:'ev3', name:'滴……滴……滴……', type:'event',
    flavor:'某处传来规律的滴水声，随后是蜿蜒而来的黑色液体——不是水。',
    checkStat:'speed', outcomes:[
      { minRoll:4, label:'≥4',  desc:'迅速退开，完全避开！本回合结束后，额外获得下回合 +2 步移动。', effects:[{type:'next_turn_bonus',steps:2}] },
      { minRoll:2, label:'2–3', desc:'勉强躲过，脚步踉跄。神志 -1。',                        effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:0, label:'0–1', desc:'液体溅到你身上！速度 -1，神志 -1。',                   effects:[{type:'stat',stat:'speed',val:-1},{type:'stat',stat:'sanity',val:-1}] },
    ]
  },
  { id:'ev4', name:'古老铭文', type:'event',
    flavor:'墙上刻满古老铭文，文字在烛火中扭动，仿佛有生命一般。',
    checkStat:'knowledge', outcomes:[
      { minRoll:5, label:'≥5',  desc:'古老秘密向你揭开！知识 +2。',                          effects:[{type:'stat',stat:'knowledge',val:2}] },
      { minRoll:3, label:'3–4', desc:'只能解读部分，略有收获。知识 +1。',                    effects:[{type:'stat',stat:'knowledge',val:1}] },
      { minRoll:0, label:'0–2', desc:'铭文暗藏诅咒，理智受到冲击。知识 -1，神志 -1。',       effects:[{type:'stat',stat:'knowledge',val:-1},{type:'stat',stat:'sanity',val:-1}] },
    ]
  },
  { id:'ev5', name:'蛛网缠绕', type:'event',
    flavor:'无数蛛丝从暗处垂落，将你缠绕，拖拽向黑暗深处……',
    checkStat:'speed', outcomes:[
      { minRoll:4, label:'≥4',  desc:'挣脱蛛网，毫发无伤！',                                effects:[] },
      { minRoll:2, label:'2–3', desc:'挣脱时撕裂蛛网，速度 -1。',                            effects:[{type:'stat',stat:'speed',val:-1}] },
      { minRoll:0, label:'0–1', desc:'被完全困住！传送到地下走廊，速度 -1。',                 effects:[{type:'stat',stat:'speed',val:-1},{type:'teleport',floor:'basement',roomId:'base_hall'}] },
    ]
  },
  { id:'ev6', name:'幽灵触碰', type:'event',
    flavor:'一双冰冷的手从身后触碰你的肩膀，回头却什么都没有……',
    checkStat:'sanity', outcomes:[
      { minRoll:5, label:'≥5',  desc:'感受到了亡灵的善意！神志 +1，知识 +1。',               effects:[{type:'stat',stat:'sanity',val:1},{type:'stat',stat:'knowledge',val:1}] },
      { minRoll:2, label:'2–4', desc:'幽冷触感令你颤栗不已。神志 -1。',                      effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:0, label:'0–1', desc:'幽灵穿透你的意识！神志 -3。',                          effects:[{type:'stat',stat:'sanity',val:-3}] },
    ]
  },
  { id:'ev7', name:'力量考验', type:'event',
    flavor:'一根沉重的横梁挡住去路，必须用尽全力才能推开。',
    checkStat:'might', outcomes:[
      { minRoll:5, label:'≥5',  desc:'轻松推开！力量 +1。',                                  effects:[{type:'stat',stat:'might',val:1}] },
      { minRoll:3, label:'3–4', desc:'勉强推开，无事发生。',                                 effects:[] },
      { minRoll:0, label:'0–2', desc:'横梁砸在你身上！力量 -1。',                            effects:[{type:'stat',stat:'might',val:-1}] },
    ]
  },
  { id:'ev8', name:'神秘祝福', type:'event',
    flavor:'某种温暖的神秘力量笼罩了你，心神安宁，浑身轻盈。',
    checkStat:null, outcomes:null,
    effects:[{type:'stat',stat:'sanity',val:1}], effectDesc:'神志 +1（无需检定）'
  },
];

// ── 凶兆牌 ────────────────────────────────────────────────────────────────────
// 摸到凶兆牌 → 放在面前 → 可能有属性检定 → 回合末进行凶兆检定（固定6枚骰子）→ 回合结束
const OMEN_CARDS = [
  { id:'om1', name:'鲜血符文',   type:'omen',
    flavor:'墙上有人用鲜血写下了召唤符文，血迹似乎还是温热的……',
    checkStat:null, outcomes:null,
    effects:[{type:'stat',stat:'sanity',val:-2}], effectDesc:'神志 -2，然后进行凶兆检定' },
  { id:'om2', name:'失踪的孩子', type:'omen',
    flavor:'你发现了一件沾满污渍的儿童衣物，显然在这里很久了……',
    checkStat:'sanity', outcomes:[
      { minRoll:4, label:'≥4',  desc:'强迫自己冷静下来。神志 -1。',                          effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:0, label:'0–3', desc:'那件衣物上还有一只小手！神志 -3。',                     effects:[{type:'stat',stat:'sanity',val:-3}] },
    ]
  },
  { id:'om3', name:'黑猫',       type:'omen',
    flavor:'一只通体漆黑的猫从黑暗中凝视你，随后无声无息地消失在虚空……',
    checkStat:'knowledge', outcomes:[
      { minRoll:3, label:'≥3',  desc:'你认出这是某种预兆，但无大碍。',                       effects:[] },
      { minRoll:0, label:'0–2', desc:'不祥之兆侵蚀心神！神志 -1。',                          effects:[{type:'stat',stat:'sanity',val:-1}] },
    ]
  },
  { id:'om4', name:'神秘仪式',   type:'omen',
    flavor:'有人在这里进行过秘密仪式，圆圈内残留着未燃尽的蜡烛……',
    checkStat:'knowledge', outcomes:[
      { minRoll:4, label:'≥4',  desc:'你识破了仪式秘密！知识 +2，神志 -1。',                 effects:[{type:'stat',stat:'knowledge',val:2},{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:2, label:'2–3', desc:'仪式令你不安，神志 -1。',                              effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:0, label:'0–1', desc:'残留力量侵袭！神志 -2，知识 -1。',                     effects:[{type:'stat',stat:'sanity',val:-2},{type:'stat',stat:'knowledge',val:-1}] },
    ]
  },
  { id:'om5', name:'幽灵显现',   type:'omen',
    flavor:'幽灵在你面前完整显现，发出刺耳的嘶鸣——那张脸，你认识……',
    checkStat:'sanity', outcomes:[
      { minRoll:5, label:'≥5',  desc:'以意志力驱散了幽灵！神志 -1。',                        effects:[{type:'stat',stat:'sanity',val:-1}] },
      { minRoll:2, label:'2–4', desc:'幽灵消散，但你被吓得僵住。神志 -2。',                  effects:[{type:'stat',stat:'sanity',val:-2}] },
      { minRoll:0, label:'0–1', desc:'被幽灵存在击溃！神志 -3，知识 -1。',                   effects:[{type:'stat',stat:'sanity',val:-3},{type:'stat',stat:'knowledge',val:-1}] },
    ]
  },
  { id:'om6', name:'古老诅咒',   type:'omen',
    flavor:'你感受到诅咒的力量，无处可逃，全身属性开始缓缓衰退……',
    checkStat:null, outcomes:null,
    effects:[{type:'stat',stat:'speed',val:-1},{type:'stat',stat:'might',val:-1},{type:'stat',stat:'sanity',val:-1},{type:'stat',stat:'knowledge',val:-1}],
    effectDesc:'全属性 -1，然后进行凶兆检定' },
];

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

// 山屋惊魂骰子：每枚骰子面值为 0,0,1,1,2,2（平均1点）
function rollDice(n) {
  if (n <= 0) return { dice:[], total:0 };
  const dice = Array.from({length:n}, () => Math.floor(Math.random()*3));
  return { dice, total: dice.reduce((s,v)=>s+v,0) };
}

function posKey(x,y) { return `${x},${y}`; }
function adjCells(x,y) { return [{x:x-1,y},{x:x+1,y},{x,y:y-1},{x,y:y+1}]; }
function statLabel(s) { return {speed:'速度',might:'力量',sanity:'神志',knowledge:'知识'}[s]||s; }

// ══════════════════════════════════════════════════════════════════════════════
// GAME STATE & LOGIC
// ══════════════════════════════════════════════════════════════════════════════

let playerIdCounter = 0;

// pendingAction — 当前必须完成的步骤
// type: 'draw_card' | 'roll_check' | 'roll_haunt' | 'roll_combat_atk' | 'roll_combat_def'
// 注意：v3 中不再有 'roll_move'
function mkPending(type, playerId, extra={}) {
  return { type, playerId, ...extra };
}

function createGame(code) {
  const game = {
    code,
    phase: 'lobby',       // lobby | exploring | haunt | gameover
    players: {},
    hostId: null,
    board: { ground:{}, upper:{}, basement:{} },
    decks: { ground:[], upper:[], basement:[], items:[], events:[], omens:[] },
    turnOrder: [],
    currentIdx: 0,
    movesLeft: 0,
    hasAttackedThisTurn: false,  // 每回合只能攻击一次
    nextTurnBonusMoves: 0,       // 下回合额外移动步数（某些事件效果）
    pendingAction: null,
    lastRoll: null,
    drawnCards: [],
    currentCard: null,
    omenCount: 0,
    haunt: null,
    winner: null,
    combatCtx: null,
    log: [],
  };
  for (const floor of ['ground','upper','basement'])
    for (const r of STARTING_ROOMS[floor])
      game.board[floor][posKey(r.pos.x,r.pos.y)] = { ...r };
  return game;
}

function addLog(game, text, type='normal') {
  game.log.push({ text, type, ts:Date.now() });
  if (game.log.length > 60) game.log.shift();
}

// resolveEffect: 单个效果结算
// 规则：鬼魂降临前，属性最低为 1（不会死亡）；降临后最低为 0（可死亡）
function resolveEffect(game, player, effect) {
  if (!effect) return;
  const type = effect.type || (effect.stat ? 'stat' : null);
  switch(type) {
    case 'stat': {
      const minVal = game.haunt ? 0 : 1;  // 鬼魂降临前不会死
      player.stats[effect.stat] = Math.min(8, Math.max(minVal, player.stats[effect.stat] + effect.val));
      break;
    }
    case 'teleport': {
      const tFloor = effect.floor || player.floor;
      const entry = Object.entries(game.board[tFloor]||{}).find(([,r])=>r.id===effect.roomId);
      if (entry) {
        const [k, room] = entry;
        const [tx,ty] = k.split(',').map(Number);
        player.floor = tFloor; player.pos = {x:tx,y:ty};
        addLog(game, `🌀 ${player.name} 被传送到【${room.name}】！`, 'event');
      }
      break;
    }
    case 'next_turn_bonus':
      game.nextTurnBonusMoves += (effect.steps||1);
      addLog(game, `✨ ${player.name} 下回合额外获得 ${effect.steps||1} 步移动力！`, 'event');
      break;
  }
}

function resolveEffects(game, player, effects) {
  if (!effects || !effects.length) return;
  for (const e of effects) resolveEffect(game, player, e);
  checkPlayerDeath(game, player);
}

// 死亡检测：只有在鬼魂降临后才检测
function checkPlayerDeath(game, player) {
  if (!player.alive) return;
  if (!game.haunt) return;  // 鬼魂降临前不会死亡
  for (const [stat, val] of Object.entries(player.stats)) {
    if (val <= 0) {
      player.alive = false;
      addLog(game, `💀 ${player.name} 的${statLabel(stat)}归零，永远倒下了！`, 'death');
      return;
    }
  }
}

function explorableCells(game, floor) {
  const board = game.board[floor];
  const revealed = new Set(Object.keys(board));
  const result = new Set();
  for (const key of revealed) {
    const [x,y] = key.split(',').map(Number);
    for (const {x:nx,y:ny} of adjCells(x,y)) {
      if (nx<0||ny<0||nx>6||ny>6) continue;
      const k = posKey(nx,ny);
      if (!revealed.has(k)) result.add(k);
    }
  }
  return result;
}

// 有效移动格：pendingAction为null时才可移动
function validMoves(game, player) {
  if (game.pendingAction) return [];   // 有待处理事项时不能移动
  if (game.movesLeft <= 0) return [];
  if (game.turnOrder[game.currentIdx] !== player.id) return [];
  const { floor, pos:{x,y} } = player;
  const board = game.board[floor];
  const explorable = explorableCells(game, floor);
  const moves = [];
  for (const {x:nx,y:ny} of adjCells(x,y)) {
    if (nx<0||ny<0||nx>6||ny>6) continue;
    const k = posKey(nx,ny);
    if (board[k])              moves.push({ floor,x:nx,y:ny,type:'move' });
    else if (explorable.has(k)) moves.push({ floor,x:nx,y:ny,type:'explore' });
  }
  const here = board[posKey(x,y)];
  if (here?.stairTo) {
    const {floor:df,x:dx,y:dy} = here.stairTo;
    moves.push({ floor:df, x:dx, y:dy, type:'stair' });
  }
  return moves;
}

// 攻击目标：鬼魂降临后，同一格，且本回合未攻击过
function attackTargets(game, player) {
  if (game.phase !== 'haunt') return [];
  if (game.turnOrder[game.currentIdx] !== player.id) return [];
  if (game.hasAttackedThisTurn) return [];          // 每回合只能攻击一次
  if (game.pendingAction) return [];                // 有待处理事项时不能攻击
  return Object.values(game.players).filter(t => {
    if (!t.alive || t.id === player.id) return false;
    if (player.isTraitor === t.isTraitor) return false;  // 不能攻击同队
    if (t.floor !== player.floor) return false;
    // 必须在同一个格（同一房间）
    return t.pos.x === player.pos.x && t.pos.y === player.pos.y;
  }).map(t=>t.id);
}

function drawFromDeck(game, type) {
  const key = {item:'items', event:'events', omen:'omens'}[type];
  const deck = game.decks[key];
  if (!deck.length) return null;
  const card = deck.pop();
  game.drawnCards.push({ ...card, drawnBy: game.turnOrder[game.currentIdx], drawnAt: Date.now() });
  game.currentCard = card;
  return card;
}

function triggerHaunt(game, traitorId) {
  game.phase = 'haunt';
  const traitor = game.players[traitorId];
  if (traitor) {
    traitor.isTraitor = true;
    traitor.stats.might = Math.min(8, traitor.stats.might + 2);
    traitor.stats.speed = Math.min(8, traitor.stats.speed + 1);
  }
  game.haunt = {
    traitorId,
    scenario:    '活死人之夜',
    heroGoal:    '收集【邪神像】【黑水晶】【古卷轴】三件神器，在五芒星室完成仪式！',
    traitorGoal: '将所有英雄的力量降为 0，把他们变成行尸走肉！',
  };
  addLog(game, '☠️  幽灵降临！古宅中潜藏的邪恶力量苏醒了……', 'haunt');
  addLog(game, `${traitor?.name||'某人'} 成为了叛徒！（叛徒力量+2，速度+1）`, 'haunt');
}

function checkWin(game) {
  if (!game.haunt || game.phase==='gameover') return;
  const heroes  = Object.values(game.players).filter(p=>!p.isTraitor && p.alive);
  const traitor = Object.values(game.players).find(p=>p.isTraitor);
  if (traitor && !traitor.alive) {
    endGame(game,'heroes','英雄胜利！叛徒被消灭，古宅重归平静……'); return;
  }
  const ritualist = heroes.find(p => {
    const room = game.board[p.floor]?.[posKey(p.pos.x,p.pos.y)];
    return room?.special==='ritual_target' && p.items.filter(i=>i.isArtifact).length>=3;
  });
  if (ritualist) { endGame(game,'heroes','英雄胜利！仪式完成，邪恶力量被永久封印！'); return; }
  if (heroes.length===0) endGame(game,'traitor','叛徒胜利！所有英雄都变成了行尸走肉……古宅永远沉睡在黑暗中。');
}

function endGame(game, winner, msg) {
  game.phase='gameover'; game.winner=winner;
  game.pendingAction=null;
  addLog(game, `🏁 ${msg}`, winner==='heroes'?'win':'death');
}

// nextTurn: 切换到下一个玩家，重置回合状态
// 规则：不再有"掷移动骰"，移动步数直接等于速度属性
function nextTurn(game) {
  if (game.phase==='gameover') return;
  const alive = game.turnOrder.filter(id=>game.players[id]?.alive);
  if (!alive.length) return;
  let tries=0;
  do {
    game.currentIdx = (game.currentIdx+1) % game.turnOrder.length;
    tries++;
  } while (!game.players[game.turnOrder[game.currentIdx]]?.alive && tries<game.turnOrder.length);

  const p = game.players[game.turnOrder[game.currentIdx]];
  if (!p) return;

  // 步数 = 速度属性值 + 上回合获得的额外步数（某些事件效果）
  game.movesLeft = p.stats.speed + game.nextTurnBonusMoves;
  game.nextTurnBonusMoves = 0;
  game.hasAttackedThisTurn = false;
  game.pendingAction = null;
  game.combatCtx = null;
  game.lastRoll = null;

  addLog(game, `━━ ${p.char?.emoji||'👤'} ${p.name} 的回合开始（速度 ${p.stats.speed}，可移动 ${game.movesLeft} 步）━━`, 'turn');
}

function startGame(game) {
  game.phase = 'exploring';
  game.decks = {
    ground:   shuffle(TILE_DECK.ground),
    upper:    shuffle(TILE_DECK.upper),
    basement: shuffle(TILE_DECK.basement),
    items:    shuffle(ITEM_CARDS),
    events:   shuffle(EVENT_CARDS),
    omens:    shuffle(OMEN_CARDS),
  };
  game.turnOrder = shuffle(Object.keys(game.players));
  game.currentIdx = -1;
  for (const p of Object.values(game.players)) {
    p.floor='ground'; p.pos={x:3,y:3};
  }
  addLog(game,'🏚  游戏开始！探索这座神秘的古宅……','system');
  nextTurn(game);
}

// ── 处理掷骰消息 ──────────────────────────────────────────────────────────────
function handleRollDice(game, player) {
  const pa = game.pendingAction;
  if (!pa || pa.playerId !== player.id) return;

  const result = rollDice(pa.diceCount || 0);
  game.lastRoll = { playerId:player.id, dice:result.dice, total:result.total, purpose:pa.type };

  // ── 属性检定（来自事件牌/凶兆牌）──
  if (pa.type === 'roll_check') {
    if (pa.outcomes) {
      const matched = pa.outcomes.find(o => result.total >= o.minRoll);
      const matchedIdx = matched ? pa.outcomes.indexOf(matched) : pa.outcomes.length-1;
      game.lastRoll.matchedOutcomeIdx = matchedIdx;
      addLog(game, `🎲 ${player.name} 掷${statLabel(pa.checkStat)}骰（${pa.diceCount}枚）：[${result.dice.join(',')}] = ${result.total} → 【${matched?.label||'0'}】`, 'roll');
      if (matched?.desc) addLog(game, `💬 ${matched.desc}`, 'event');
      if (matched?.effects?.length) resolveEffects(game, player, matched.effects);
    }

    if (pa.isOmenCard) {
      // 凶兆牌检定后 → 凶兆数+1 → 进行凶兆检定（固定6枚骰子）
      game.omenCount++;
      addLog(game, `🩸 凶兆数现在是 ${game.omenCount}，需要进行凶兆检定！`, 'omen');
      game.pendingAction = mkPending('roll_haunt', player.id, { diceCount: 6 });
    } else {
      // 事件牌检定完毕 → 本回合结束
      addLog(game, `📋 事件结算完毕，${player.name} 的回合结束。`, 'normal');
      game.pendingAction = null;
      nextTurn(game);
    }
  }

  // ── 凶兆检定（固定6枚骰子）──
  else if (pa.type === 'roll_haunt') {
    const triggered = result.total < game.omenCount;
    addLog(game, `🎲 凶兆检定（6枚骰）：[${result.dice.join(',')}] = ${result.total} vs 凶兆数 ${game.omenCount} → ${triggered?'☠️ 幽灵降临！':'😮‍💨 安全，暂无危险…'}`, 'roll');
    if (triggered) {
      triggerHaunt(game, player.id);
    }
    // 无论是否触发，回合结束
    game.pendingAction = null;
    nextTurn(game);
  }

  // ── 攻击方掷骰 ──
  else if (pa.type === 'roll_combat_atk') {
    addLog(game, `⚔️  ${player.name} 攻击骰（${pa.diceCount}枚）：[${result.dice.join(',')}] = ${result.total}`, 'combat');
    const defender = game.players[pa.defenderId];
    game.combatCtx = { ...game.combatCtx, atkTotal: result.total };
    game.pendingAction = mkPending('roll_combat_def', pa.defenderId, {
      diceCount:  defender?.stats?.might || 2,
      attackerId: pa.attackerId,
      defenderId: pa.defenderId,
      atkTotal:   result.total,
    });
    addLog(game, `🛡  现在由 ${defender?.name||'?'} 掷防御骰（力量 ${defender?.stats?.might}枚）……`, 'combat');
  }

  // ── 防御方掷骰 ──
  else if (pa.type === 'roll_combat_def') {
    const atk = pa.atkTotal;
    const dmg = Math.max(0, atk - result.total);
    const attacker = game.players[pa.attackerId];
    addLog(game, `🛡  ${player.name} 防御骰（${pa.diceCount}枚）：[${result.dice.join(',')}] = ${result.total}`, 'combat');
    if (dmg > 0) {
      // 物理伤害减少力量（和/或速度），这里简化为减少力量
      resolveEffects(game, player, [{type:'stat', stat:'might', val:-dmg}]);
      addLog(game, `💥 ${player.name} 受到 ${dmg} 点伤害！（力量→${player.stats.might}）`, 'combat');
    } else {
      addLog(game, `🛡  防御成功！${player.name} 完全挡住了攻击！`, 'combat');
    }
    // 攻击结算完毕，清除pendingAction，但回合继续（不自动结束）
    // 攻击方本回合只能攻击一次，已在 attack 处理中标记
    game.combatCtx = null;
    game.pendingAction = null;
    checkWin(game);
    addLog(game, `⚔️  战斗结束，${attacker?.name||'?'} 可继续移动或结束回合。`, 'combat');
  }
}

// ── 处理摸牌消息 ──────────────────────────────────────────────────────────────
function handleDrawCard(game, player) {
  const pa = game.pendingAction;
  if (!pa || pa.type !== 'draw_card' || pa.playerId !== player.id) return;

  const card = drawFromDeck(game, pa.cardType);
  if (!card) {
    addLog(game, `牌堆已空！跳过摸牌。`, 'normal');
    game.pendingAction = null;
    nextTurn(game);
    return;
  }

  addLog(game, `${player.name} 翻开了【${card.name}】（${pa.cardType==='item'?'物品':pa.cardType==='event'?'事件':'凶兆'}牌）`, pa.cardType);

  if (pa.cardType === 'item') {
    // 物品牌：拾起，立即生效，回合结束
    player.items.push(card);
    resolveEffects(game, player, card.effects||[]);
    const artifactNote = card.isArtifact ? ' ✨这是仪式神器！' : '';
    addLog(game, `📦 ${player.name} 获得【${card.name}】：${card.effectDesc}${artifactNote}`, 'item');
    addLog(game, `📋 物品获得，${player.name} 的回合结束。`, 'normal');
    game.pendingAction = null;
    nextTurn(game);

  } else if (pa.cardType === 'event') {
    if (card.checkStat && card.outcomes) {
      // 事件牌需要属性检定
      const statVal = player.stats[card.checkStat];
      game.pendingAction = mkPending('roll_check', player.id, {
        diceCount:  statVal,
        checkStat:  card.checkStat,
        outcomes:   card.outcomes,
        isOmenCard: false,
        card,
      });
      addLog(game, `⚡ 需要进行【${statLabel(card.checkStat)}检定】（掷 ${statVal} 枚骰）`, 'event');
    } else {
      // 无需检定的事件牌，直接生效，回合结束
      resolveEffects(game, player, card.effects||[]);
      addLog(game, `⚡ ${card.effectDesc||'事件结算'}`, 'event');
      addLog(game, `📋 事件结算完毕，${player.name} 的回合结束。`, 'normal');
      game.pendingAction = null;
      nextTurn(game);
    }

  } else if (pa.cardType === 'omen') {
    if (card.checkStat && card.outcomes) {
      // 凶兆牌需要先进行属性检定，再进行凶兆检定
      const statVal = player.stats[card.checkStat];
      game.pendingAction = mkPending('roll_check', player.id, {
        diceCount:  statVal,
        checkStat:  card.checkStat,
        outcomes:   card.outcomes,
        isOmenCard: true,  // 检定后还要进行凶兆检定
        card,
      });
      addLog(game, `🩸 凶兆牌：需要进行【${statLabel(card.checkStat)}检定】（掷 ${statVal} 枚骰），之后进行凶兆检定`, 'omen');
    } else {
      // 无需检定的凶兆牌，直接生效，然后进行凶兆检定
      if (card.effects?.length) {
        resolveEffects(game, player, card.effects);
        addLog(game, `🩸 ${card.effectDesc||'凶兆效果生效'}`, 'omen');
      }
      game.omenCount++;
      addLog(game, `🩸 凶兆数现在是 ${game.omenCount}，需要进行凶兆检定！`, 'omen');
      // 凶兆检定固定6枚骰子
      game.pendingAction = mkPending('roll_haunt', player.id, { diceCount: 6 });
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ══════════════════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ server });
const games    = new Map();
const wsPlayer = new Map();

function genCode() {
  const C='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4},()=>C[Math.floor(Math.random()*C.length)]).join('');
}

function publicState(game, forId) {
  const me = Object.values(game.players).find(p=>p.id===forId);
  return {
    code:       game.code,
    phase:      game.phase,
    winner:     game.winner,
    hostId:     game.hostId,
    players: Object.values(game.players).map(p=>({
      id:p.id, name:p.name, charId:p.charId, char:p.char,
      floor:p.floor, pos:p.pos, stats:p.stats, items:p.items,
      alive:p.alive,
      isTraitor: p.id===forId ? p.isTraitor : (game.phase==='gameover'?p.isTraitor:null),
    })),
    board:      game.board,
    currentId:  game.turnOrder[game.currentIdx]||null,
    movesLeft:  game.movesLeft,
    hasAttackedThisTurn: game.hasAttackedThisTurn,
    pendingAction: game.pendingAction,
    lastRoll:   game.lastRoll,
    drawnCards: game.drawnCards,
    currentCard:game.currentCard,
    omenCount:  game.omenCount,
    haunt: game.haunt ? {
      started:     true,
      scenario:    game.haunt.scenario,
      heroGoal:    game.haunt.heroGoal,
      traitorGoal: game.haunt.traitorGoal,
      traitorId:   forId===game.haunt.traitorId ? game.haunt.traitorId : null,
      amTraitor:   forId===game.haunt.traitorId,
    } : null,
    log:          game.log.slice(-25),
    validMoves:   me && game.turnOrder[game.currentIdx]===forId ? validMoves(game,me) : [],
    attackTargets: me ? attackTargets(game,me) : [],
  };
}

function broadcast(game) {
  for (const p of Object.values(game.players)) {
    if (p.ws?.readyState===WebSocket.OPEN)
      p.ws.send(JSON.stringify({type:'state', data:publicState(game,p.id)}));
  }
}

function send(ws, obj) { if (ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg=JSON.parse(raw); } catch { return; }
    const {type, data={}} = msg;

    if (type==='create_game') {
      let code; do { code=genCode(); } while(games.has(code));
      const game=createGame(code);
      const pid=`p${++playerIdCounter}`;
      game.hostId=pid;
      game.players[pid]={id:pid,name:data.name||'房主',charId:null,char:null,
        floor:'ground',pos:{x:3,y:3},stats:null,items:[],alive:true,isTraitor:false,ws};
      games.set(code,game);
      wsPlayer.set(ws,{gameCode:code,playerId:pid});
      send(ws,{type:'game_created',playerId:pid,code});
      broadcast(game);
      return;
    }

    if (type==='join_game') {
      const code=(data.code||'').toUpperCase().trim();
      const game=games.get(code);
      if (!game)                               { send(ws,{type:'error',msg:'房间不存在'}); return; }
      if (game.phase!=='lobby')                { send(ws,{type:'error',msg:'游戏已开始，无法加入'}); return; }
      if (Object.keys(game.players).length>=6) { send(ws,{type:'error',msg:'房间已满（最多6人）'}); return; }
      const pid=`p${++playerIdCounter}`;
      game.players[pid]={id:pid,name:data.name||`玩家${Object.keys(game.players).length+1}`,
        charId:null,char:null,floor:'ground',pos:{x:3,y:3},stats:null,items:[],alive:true,isTraitor:false,ws};
      wsPlayer.set(ws,{gameCode:code,playerId:pid});
      addLog(game,`👤 ${game.players[pid].name} 加入了游戏`,'join');
      send(ws,{type:'game_joined',playerId:pid,code});
      broadcast(game);
      return;
    }

    const ctx=wsPlayer.get(ws);
    if (!ctx) return;
    const {gameCode,playerId}=ctx;
    const game=games.get(gameCode);
    if (!game) return;
    const player=game.players[playerId];
    if (!player) return;

    switch(type) {

      case 'select_char': {
        const char=CHARACTERS.find(c=>c.id===data.charId);
        if (!char) return;
        if (Object.values(game.players).some(p=>p.id!==playerId && p.charId===char.id)) {
          send(ws,{type:'error',msg:'该角色已被其他玩家选择'}); return;
        }
        player.charId=char.id; player.char=char; player.stats={...char.stats};
        addLog(game,`${player.name} 选择了 ${char.emoji} ${char.name}（${char.title}）`,'join');
        broadcast(game);
        break;
      }

      case 'start_game': {
        if (playerId!==game.hostId) return;
        const ps=Object.values(game.players);
        if (ps.length<2)           { send(ws,{type:'error',msg:'至少需要2名玩家'}); return; }
        if (ps.some(p=>!p.charId)) { send(ws,{type:'error',msg:'所有玩家必须选择角色'}); return; }
        startGame(game);
        broadcast(game);
        break;
      }

      // v3：不再有 roll_move，只剩下 roll_check / roll_haunt / roll_combat_*
      case 'roll_dice': {
        if (game.phase==='gameover') return;
        handleRollDice(game, player);
        checkWin(game);
        broadcast(game);
        break;
      }

      case 'draw_card': {
        if (game.phase==='gameover') return;
        handleDrawCard(game, player);
        checkWin(game);
        broadcast(game);
        break;
      }

      case 'move': {
        if (game.phase==='gameover') return;
        if (game.turnOrder[game.currentIdx]!==playerId) return;
        if (game.pendingAction) { send(ws,{type:'error',msg:'请先完成当前事件'}); return; }
        if (game.movesLeft<=0) { send(ws,{type:'error',msg:'本回合移动步数已用完'}); return; }

        const {floor,x,y} = data;
        const legal = validMoves(game, player);
        if (!legal.some(m=>m.floor===floor&&m.x===x&&m.y===y)) {
          send(ws,{type:'error',msg:'非法移动'}); return;
        }

        player.floor=floor; player.pos={x,y};

        let room=game.board[floor][posKey(x,y)];
        let isNew=false;
        if (!room) {
          // 揭示新房间
          const deck=game.decks[floor];
          const tile=deck.length>0 ? deck.pop() : {id:`hall_${x}_${y}`,name:'走廊',card:null,desc:'一条幽暗空旷的走廊。'};
          game.board[floor][posKey(x,y)]=tile;
          room=tile;
          isNew=true;
          addLog(game,`🔍 ${player.name} 发现了新房间：【${room.name}】`,'explore');
        } else {
          const floorName={ground:'地面层',upper:'二楼',basement:'地下室'}[floor]||floor;
          addLog(game,`👣 ${player.name} 移动到【${room.name}】（${floorName}）`,'move');
        }

        if (isNew && room.card) {
          // 进入有卡牌符号的新房间：停止移动，必须摸牌（之后回合自动结束）
          game.movesLeft = 0;
          const typeLabel = {item:'物品',event:'事件',omen:'凶兆'}[room.card];
          game.pendingAction = mkPending('draw_card', player.id, {
            cardType: room.card,
            roomName: room.name,
          });
          addLog(game,`📋 【${room.name}】有${typeLabel}符号，${player.name} 需要摸牌（摸牌后本回合结束）`,'normal');
        } else {
          // 普通移动
          game.movesLeft--;
        }

        broadcast(game);
        break;
      }

      case 'end_turn': {
        // 玩家手动结束回合（只有没有待处理事项时才能结束）
        if (game.turnOrder[game.currentIdx]!==playerId) return;
        if (game.pendingAction) { send(ws,{type:'error',msg:'请先完成当前必要操作'}); return; }
        if (game.phase==='gameover') return;
        addLog(game,`${player.name} 选择结束回合。`,'normal');
        nextTurn(game);
        broadcast(game);
        break;
      }

      case 'attack': {
        if (game.phase!=='haunt') { send(ws,{type:'error',msg:'鬼魂降临前无法攻击'}); return; }
        if (game.turnOrder[game.currentIdx]!==playerId) return;
        if (game.hasAttackedThisTurn) { send(ws,{type:'error',msg:'本回合已经攻击过了'}); return; }
        if (game.pendingAction) { send(ws,{type:'error',msg:'请先完成当前事件'}); return; }

        const target=game.players[data.targetId];
        if (!target||!target.alive) return;
        if (player.isTraitor===target.isTraitor) return;

        // 必须在同一格（同一房间）
        if (target.floor!==player.floor || target.pos.x!==player.pos.x || target.pos.y!==player.pos.y) {
          send(ws,{type:'error',msg:'必须与目标在同一房间才能攻击'}); return;
        }

        game.hasAttackedThisTurn = true;  // 标记本回合已攻击
        game.combatCtx={ attackerId:player.id, defenderId:target.id, atkTotal:0 };
        game.pendingAction=mkPending('roll_combat_atk', player.id, {
          diceCount:  player.stats.might,
          attackerId: player.id,
          defenderId: target.id,
        });
        addLog(game,`⚔️  ${player.name}（力量${player.stats.might}）向 ${target.name}（力量${target.stats.might}）发起攻击！`,'combat');
        broadcast(game);
        break;
      }

      case 'restart': {
        if (playerId!==game.hostId) return;
        const ng=createGame(game.code);
        ng.hostId=game.hostId;
        for (const [id,p] of Object.entries(game.players))
          ng.players[id]={...p,charId:null,char:null,stats:null,items:[],alive:true,isTraitor:false,floor:'ground',pos:{x:3,y:3}};
        games.set(game.code,ng);
        broadcast(ng);
        break;
      }
    }
  });

  ws.on('close', ()=>{
    const ctx=wsPlayer.get(ws);
    if (!ctx) return;
    wsPlayer.delete(ws);
    const {gameCode,playerId}=ctx;
    const game=games.get(gameCode);
    if (!game) return;
    const p=game.players[playerId];
    if (p) {
      addLog(game,`👤 ${p.name} 断开了连接`,'leave');
      delete game.players[playerId];
      if (!Object.keys(game.players).length) games.delete(gameCode);
      else broadcast(game);
    }
  });
});

server.listen(3000, ()=>console.log('🏚  山屋惊魂 v3 → http://localhost:3000'));
