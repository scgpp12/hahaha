// ══════════════════════════════════════════════════════════════════════════════
// 山屋惊魂 — 纯游戏逻辑（无 WebSocket，无 DynamoDB，可在 Lambda 中直接调用）
// ══════════════════════════════════════════════════════════════════════════════

// ── 游戏数据 ──────────────────────────────────────────────────────────────────
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
    { id:'entrance', name:'门厅',   card:null, pos:{x:3,y:3} },
    { id:'foyer',    name:'前厅',   card:null, pos:{x:3,y:4}, stairTo:{floor:'basement',x:3,y:3} },
    { id:'stair_g',  name:'大楼梯', card:null, pos:{x:4,y:3}, stairTo:{floor:'upper',x:3,y:3} },
  ],
  upper:    [{ id:'upper_hall', name:'二楼走廊', card:null, pos:{x:3,y:3}, stairTo:{floor:'ground',x:4,y:3} }],
  basement: [{ id:'base_hall',  name:'地下走廊', card:null, pos:{x:3,y:3}, stairTo:{floor:'ground',x:3,y:4} }],
};

const TILE_DECK = {
  ground: [
    { id:'dining',   name:'餐厅',     card:'event' }, { id:'kitchen',  name:'厨房',     card:'item'  },
    { id:'parlor',   name:'客厅',     card:'event' }, { id:'library',  name:'书房',     card:'omen'  },
    { id:'ballroom', name:'舞厅',     card:'event' }, { id:'garden',   name:'花园',     card:'item'  },
    { id:'cloak',    name:'衣帽间',   card:'item'  }, { id:'conserv',  name:'温室',     card:'omen'  },
    { id:'pent',     name:'五芒星室', card:null,    special:'ritual_target' },
  ],
  upper: [
    { id:'master',    name:'主卧室',  card:'omen'  }, { id:'bedroom',   name:'卧室',    card:'event' },
    { id:'nursery',   name:'育儿室',  card:'omen'  }, { id:'attic',     name:'阁楼',    card:'omen'  },
    { id:'gallery',   name:'画廊',    card:'event' }, { id:'trophy',    name:'荣耀室',  card:'item'  },
    { id:'collapsed', name:'废墟',    card:'event' }, { id:'storage',   name:'储藏室',  card:'item'  },
  ],
  basement: [
    { id:'furnace',   name:'锅炉房',  card:'event' }, { id:'vault',     name:'密室',    card:'item'  },
    { id:'catacombs', name:'地下墓穴',card:'omen'  }, { id:'crypt',     name:'地窖',    card:'omen'  },
    { id:'coal',      name:'煤炭间',  card:'item'  }, { id:'ritual',    name:'祭祀室',  card:'omen'  },
    { id:'tunnel',    name:'秘道',    card:'event' },
  ],
};

const ITEM_CARDS = [
  { id:'candle',  name:'古老蜡烛', type:'item', flavor:'一根插在骷髅烛台上的蜡烛，火焰呈诡异的蓝色。',   checkStat:null, effects:[{type:'stat',stat:'knowledge',val:1}], effectDesc:'知识 +1', isArtifact:false },
  { id:'knife',   name:'锈迹匕首', type:'item', flavor:'一把旧匕首，锈迹斑斑，但刃口依然锋利。',          checkStat:null, effects:[{type:'stat',stat:'might',val:1}],    effectDesc:'力量 +1', isArtifact:false },
  { id:'amulet',  name:'护身符',   type:'item', flavor:'古老的符文护身符，戴上后感觉轻松了许多。',         checkStat:null, effects:[{type:'stat',stat:'sanity',val:2}],   effectDesc:'神志 +2', isArtifact:false },
  { id:'tome',    name:'禁忌古籍', type:'item', flavor:'充满了可怕的知识，既让人着迷又令人恐惧。',         checkStat:null, effects:[{type:'stat',stat:'knowledge',val:2},{type:'stat',stat:'sanity',val:-1}], effectDesc:'知识 +2，神志 -1', isArtifact:false },
  { id:'ring',    name:'神秘戒指', type:'item', flavor:'戴上后浑身充满活力，步伐也轻盈了起来。',           checkStat:null, effects:[{type:'stat',stat:'speed',val:1}],    effectDesc:'速度 +1', isArtifact:false },
  { id:'armor',   name:'古代铠甲', type:'item', flavor:'虽然陈旧，但穿上后感到有力量支撑着你。',           checkStat:null, effects:[{type:'stat',stat:'might',val:2}],    effectDesc:'力量 +2', isArtifact:false },
  { id:'idol',    name:'邪神像',   type:'item', flavor:'精工铸造的神像，散发着一种令人不安的气息。',       checkStat:null, effects:[], effectDesc:'仪式神器！', isArtifact:true },
  { id:'crystal', name:'黑水晶',   type:'item', flavor:'漆黑的水晶内部有微光流动，像是有什么东西活着。', checkStat:null, effects:[], effectDesc:'仪式神器！', isArtifact:true },
  { id:'scroll',  name:'古卷轴',   type:'item', flavor:'羊皮纸上写满了古老的咒文，触碰时手指微微发麻。', checkStat:null, effects:[], effectDesc:'仪式神器！', isArtifact:true },
];

const EVENT_CARDS = [
  { id:'ev1', name:'迷失神志', type:'event', flavor:'黑暗中传来低语，意识开始模糊……', checkStat:'sanity', outcomes:[
    { minRoll:5, label:'≥5',  desc:'意志力抵挡了侵袭。神志 +1。',    effects:[{type:'stat',stat:'sanity',val:1}] },
    { minRoll:3, label:'3–4', desc:'幻觉散去，轻微不适。',            effects:[] },
    { minRoll:1, label:'1–2', desc:'神志动摇！神志 -2。',             effects:[{type:'stat',stat:'sanity',val:-2}] },
    { minRoll:0, label:'0',   desc:'完全迷失！神志 -3，传送到地下。', effects:[{type:'stat',stat:'sanity',val:-3},{type:'teleport',floor:'basement',roomId:'base_hall'}] },
  ]},
  { id:'ev2', name:'血腥影像', type:'event', flavor:'眼前浮现出无数扭曲的面孔……', checkStat:'sanity', outcomes:[
    { minRoll:4, label:'≥4',  desc:'直面恐惧，更加坚定。神志 +1，力量 +1。', effects:[{type:'stat',stat:'sanity',val:1},{type:'stat',stat:'might',val:1}] },
    { minRoll:2, label:'2–3', desc:'影像消散。神志 -1。',                    effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:0, label:'0–1', desc:'几乎昏厥！神志 -3。',                    effects:[{type:'stat',stat:'sanity',val:-3}] },
  ]},
  { id:'ev3', name:'滴……滴……滴……', type:'event', flavor:'某处传来规律的滴水声……', checkStat:'speed', outcomes:[
    { minRoll:4, label:'≥4',  desc:'迅速退开！下回合+2步。',              effects:[{type:'next_turn_bonus',steps:2}] },
    { minRoll:2, label:'2–3', desc:'勉强躲过。神志 -1。',                  effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:0, label:'0–1', desc:'液体溅到身上！速度 -1，神志 -1。',    effects:[{type:'stat',stat:'speed',val:-1},{type:'stat',stat:'sanity',val:-1}] },
  ]},
  { id:'ev4', name:'古老铭文', type:'event', flavor:'墙上刻满古老铭文……', checkStat:'knowledge', outcomes:[
    { minRoll:5, label:'≥5',  desc:'古老秘密揭开！知识 +2。',             effects:[{type:'stat',stat:'knowledge',val:2}] },
    { minRoll:3, label:'3–4', desc:'略有收获。知识 +1。',                 effects:[{type:'stat',stat:'knowledge',val:1}] },
    { minRoll:0, label:'0–2', desc:'铭文暗藏诅咒。知识 -1，神志 -1。',   effects:[{type:'stat',stat:'knowledge',val:-1},{type:'stat',stat:'sanity',val:-1}] },
  ]},
  { id:'ev5', name:'蛛网缠绕', type:'event', flavor:'无数蛛丝从暗处垂落……', checkStat:'speed', outcomes:[
    { minRoll:4, label:'≥4',  desc:'挣脱蛛网，毫发无伤！',                effects:[] },
    { minRoll:2, label:'2–3', desc:'挣脱时速度 -1。',                      effects:[{type:'stat',stat:'speed',val:-1}] },
    { minRoll:0, label:'0–1', desc:'被困住！传送地下，速度 -1。',          effects:[{type:'stat',stat:'speed',val:-1},{type:'teleport',floor:'basement',roomId:'base_hall'}] },
  ]},
  { id:'ev6', name:'幽灵触碰', type:'event', flavor:'一双冰冷的手触碰你的肩膀……', checkStat:'sanity', outcomes:[
    { minRoll:5, label:'≥5',  desc:'感受到亡灵善意！神志 +1，知识 +1。', effects:[{type:'stat',stat:'sanity',val:1},{type:'stat',stat:'knowledge',val:1}] },
    { minRoll:2, label:'2–4', desc:'令你颤栗。神志 -1。',                 effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:0, label:'0–1', desc:'幽灵穿透意识！神志 -3。',             effects:[{type:'stat',stat:'sanity',val:-3}] },
  ]},
  { id:'ev7', name:'力量考验', type:'event', flavor:'一根沉重的横梁挡住去路……', checkStat:'might', outcomes:[
    { minRoll:5, label:'≥5',  desc:'轻松推开！力量 +1。',                  effects:[{type:'stat',stat:'might',val:1}] },
    { minRoll:3, label:'3–4', desc:'勉强推开，无事发生。',                 effects:[] },
    { minRoll:0, label:'0–2', desc:'横梁砸中！力量 -1。',                  effects:[{type:'stat',stat:'might',val:-1}] },
  ]},
  { id:'ev8', name:'神秘祝福', type:'event', flavor:'温暖的神秘力量笼罩了你……', checkStat:null, outcomes:null, effects:[{type:'stat',stat:'sanity',val:1}], effectDesc:'神志 +1' },
];

const OMEN_CARDS = [
  { id:'om1', name:'鲜血符文',   type:'omen', flavor:'墙上有人用鲜血写下了召唤符文……', checkStat:null, outcomes:null, effects:[{type:'stat',stat:'sanity',val:-2}], effectDesc:'神志 -2' },
  { id:'om2', name:'失踪的孩子', type:'omen', flavor:'你发现了一件沾满污渍的儿童衣物……', checkStat:'sanity', outcomes:[
    { minRoll:4, label:'≥4',  desc:'强迫自己冷静。神志 -1。', effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:0, label:'0–3', desc:'那件衣物上还有一只小手！神志 -3。', effects:[{type:'stat',stat:'sanity',val:-3}] },
  ]},
  { id:'om3', name:'黑猫',       type:'omen', flavor:'一只通体漆黑的猫凝视你……', checkStat:'knowledge', outcomes:[
    { minRoll:3, label:'≥3',  desc:'你认出预兆，无大碍。', effects:[] },
    { minRoll:0, label:'0–2', desc:'不祥之兆！神志 -1。', effects:[{type:'stat',stat:'sanity',val:-1}] },
  ]},
  { id:'om4', name:'神秘仪式',   type:'omen', flavor:'有人在这里进行过秘密仪式……', checkStat:'knowledge', outcomes:[
    { minRoll:4, label:'≥4',  desc:'识破仪式！知识 +2，神志 -1。', effects:[{type:'stat',stat:'knowledge',val:2},{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:2, label:'2–3', desc:'令你不安。神志 -1。', effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:0, label:'0–1', desc:'残留力量侵袭！神志 -2，知识 -1。', effects:[{type:'stat',stat:'sanity',val:-2},{type:'stat',stat:'knowledge',val:-1}] },
  ]},
  { id:'om5', name:'幽灵显现',   type:'omen', flavor:'幽灵在你面前完整显现……', checkStat:'sanity', outcomes:[
    { minRoll:5, label:'≥5',  desc:'驱散了幽灵！神志 -1。', effects:[{type:'stat',stat:'sanity',val:-1}] },
    { minRoll:2, label:'2–4', desc:'幽灵消散，但你僵住。神志 -2。', effects:[{type:'stat',stat:'sanity',val:-2}] },
    { minRoll:0, label:'0–1', desc:'被幽灵击溃！神志 -3，知识 -1。', effects:[{type:'stat',stat:'sanity',val:-3},{type:'stat',stat:'knowledge',val:-1}] },
  ]},
  { id:'om6', name:'古老诅咒',   type:'omen', flavor:'你感受到诅咒的力量……', checkStat:null, outcomes:null, effects:[{type:'stat',stat:'speed',val:-1},{type:'stat',stat:'might',val:-1},{type:'stat',stat:'sanity',val:-1},{type:'stat',stat:'knowledge',val:-1}], effectDesc:'全属性 -1' },
];

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function rollDice(n) {
  if(n<=0) return{dice:[],total:0};
  const dice=Array.from({length:n},()=>Math.floor(Math.random()*3));
  return{dice,total:dice.reduce((s,v)=>s+v,0)};
}
function posKey(x,y){return`${x},${y}`;}
function adjCells(x,y){return[{x:x-1,y},{x:x+1,y},{x,y:y-1},{x,y:y+1}];}
function statLabel(s){return{speed:'速度',might:'力量',sanity:'神志',knowledge:'知识'}[s]||s;}
function genId(){return 'p'+Math.random().toString(36).substr(2,9);}

// ── 游戏状态创建 ──────────────────────────────────────────────────────────────
function createGame(code) {
  const game={
    code, phase:'lobby',
    players:{}, hostId:null,
    board:{ground:{},upper:{},basement:{}},
    decks:{ground:[],upper:[],basement:[],items:[],events:[],omens:[]},
    turnOrder:[], currentIdx:0,
    movesLeft:0, hasAttackedThisTurn:false, nextTurnBonusMoves:0,
    pendingAction:null, lastRoll:null,
    drawnCards:[], currentCard:null,
    omenCount:0, haunt:null, winner:null, combatCtx:null, log:[],
  };
  for(const floor of['ground','upper','basement'])
    for(const r of STARTING_ROOMS[floor])
      game.board[floor][posKey(r.pos.x,r.pos.y)]={...r};
  return game;
}

function addLog(game,text,type='normal'){
  game.log.push({text,type,ts:Date.now()});
  if(game.log.length>60) game.log.shift();
}

function mkPending(type,playerId,extra={}){return{type,playerId,...extra};}

// ── 效果结算 ──────────────────────────────────────────────────────────────────
function resolveEffect(game,player,effect){
  if(!effect) return;
  const type=effect.type||(effect.stat?'stat':null);
  switch(type){
    case 'stat':{
      const minVal=game.haunt?0:1;
      player.stats[effect.stat]=Math.min(8,Math.max(minVal,player.stats[effect.stat]+effect.val));
      break;
    }
    case 'teleport':{
      const tFloor=effect.floor||player.floor;
      const entry=Object.entries(game.board[tFloor]||{}).find(([,r])=>r.id===effect.roomId);
      if(entry){const[k,room]=entry;const[tx,ty]=k.split(',').map(Number);player.floor=tFloor;player.pos={x:tx,y:ty};addLog(game,`🌀 ${player.name} 被传送到【${room.name}】！`,'event');}
      break;
    }
    case 'next_turn_bonus':
      game.nextTurnBonusMoves+=(effect.steps||1);
      addLog(game,`✨ ${player.name} 下回合额外获得 ${effect.steps||1} 步！`,'event');
      break;
  }
}
function resolveEffects(game,player,effects){
  if(!effects||!effects.length) return;
  for(const e of effects) resolveEffect(game,player,e);
  checkPlayerDeath(game,player);
}
function checkPlayerDeath(game,player){
  if(!player.alive||!game.haunt) return;
  for(const[stat,val]of Object.entries(player.stats)){
    if(val<=0){player.alive=false;addLog(game,`💀 ${player.name} 的${statLabel(stat)}归零，倒下了！`,'death');return;}
  }
}

// ── 移动 & 攻击合法性 ────────────────────────────────────────────────────────
function explorableCells(game,floor){
  const board=game.board[floor],revealed=new Set(Object.keys(board)),result=new Set();
  for(const key of revealed){const[x,y]=key.split(',').map(Number);for(const{x:nx,y:ny}of adjCells(x,y)){if(nx<0||ny<0||nx>6||ny>6)continue;const k=posKey(nx,ny);if(!revealed.has(k))result.add(k);}}
  return result;
}
function validMoves(game,player){
  if(game.pendingAction||game.movesLeft<=0||game.turnOrder[game.currentIdx]!==player.id) return[];
  const{floor,pos:{x,y}}=player,board=game.board[floor],explorable=explorableCells(game,floor),moves=[];
  for(const{x:nx,y:ny}of adjCells(x,y)){if(nx<0||ny<0||nx>6||ny>6)continue;const k=posKey(nx,ny);if(board[k])moves.push({floor,x:nx,y:ny,type:'move'});else if(explorable.has(k))moves.push({floor,x:nx,y:ny,type:'explore'});}
  const here=board[posKey(x,y)];if(here?.stairTo){const{floor:df,x:dx,y:dy}=here.stairTo;moves.push({floor:df,x:dx,y:dy,type:'stair'});}
  return moves;
}
function attackTargets(game,player){
  if(game.phase!=='haunt'||game.turnOrder[game.currentIdx]!==player.id||game.hasAttackedThisTurn||game.pendingAction) return[];
  return Object.values(game.players).filter(t=>t.alive&&t.id!==player.id&&player.isTraitor!==t.isTraitor&&t.floor===player.floor&&t.pos.x===player.pos.x&&t.pos.y===player.pos.y).map(t=>t.id);
}

// ── 牌堆 ──────────────────────────────────────────────────────────────────────
function drawFromDeck(game,type){
  const key={item:'items',event:'events',omen:'omens'}[type],deck=game.decks[key];
  if(!deck.length) return null;
  const card=deck.pop();
  game.drawnCards.push({...card,drawnBy:game.turnOrder[game.currentIdx],drawnAt:Date.now()});
  game.currentCard=card;
  return card;
}

// ── 幽灵降临 ──────────────────────────────────────────────────────────────────
function triggerHaunt(game,traitorId){
  game.phase='haunt';
  const t=game.players[traitorId];
  if(t){t.isTraitor=true;t.stats.might=Math.min(8,t.stats.might+2);t.stats.speed=Math.min(8,t.stats.speed+1);}
  game.haunt={traitorId,scenario:'活死人之夜',heroGoal:'收集【邪神像】【黑水晶】【古卷轴】，在五芒星室完成仪式！',traitorGoal:'将所有英雄力量降为 0！'};
  addLog(game,'☠️  幽灵降临！','haunt');
  addLog(game,`${t?.name||'某人'} 成为了叛徒！（力量+2，速度+1）`,'haunt');
}

function checkWin(game){
  if(!game.haunt||game.phase==='gameover') return;
  const heroes=Object.values(game.players).filter(p=>!p.isTraitor&&p.alive);
  const traitor=Object.values(game.players).find(p=>p.isTraitor);
  if(traitor&&!traitor.alive){endGame(game,'heroes','英雄胜利！叛徒被消灭！');return;}
  const ritualist=heroes.find(p=>{const room=game.board[p.floor]?.[posKey(p.pos.x,p.pos.y)];return room?.special==='ritual_target'&&p.items.filter(i=>i.isArtifact).length>=3;});
  if(ritualist){endGame(game,'heroes','英雄胜利！仪式完成！');return;}
  if(heroes.length===0) endGame(game,'traitor','叛徒胜利！所有英雄倒下……');
}
function endGame(game,winner,msg){
  game.phase='gameover';game.winner=winner;game.pendingAction=null;
  addLog(game,`🏁 ${msg}`,winner==='heroes'?'win':'death');
}

// ── 切换回合 ──────────────────────────────────────────────────────────────────
function nextTurn(game){
  if(game.phase==='gameover') return;
  const alive=game.turnOrder.filter(id=>game.players[id]?.alive);
  if(!alive.length) return;
  let tries=0;
  do{game.currentIdx=(game.currentIdx+1)%game.turnOrder.length;tries++;}while(!game.players[game.turnOrder[game.currentIdx]]?.alive&&tries<game.turnOrder.length);
  const p=game.players[game.turnOrder[game.currentIdx]];
  if(!p) return;
  game.movesLeft=p.stats.speed+game.nextTurnBonusMoves;
  game.nextTurnBonusMoves=0;
  game.hasAttackedThisTurn=false;
  game.pendingAction=null;game.combatCtx=null;game.lastRoll=null;
  addLog(game,`━━ ${p.char?.emoji||'👤'} ${p.name} 的回合（速度 ${p.stats.speed}，可移动 ${game.movesLeft} 步）━━`,'turn');
}

function startGame(game){
  game.phase='exploring';
  game.decks={ground:shuffle(TILE_DECK.ground),upper:shuffle(TILE_DECK.upper),basement:shuffle(TILE_DECK.basement),items:shuffle(ITEM_CARDS),events:shuffle(EVENT_CARDS),omens:shuffle(OMEN_CARDS)};
  game.turnOrder=shuffle(Object.keys(game.players));
  game.currentIdx=-1;
  for(const p of Object.values(game.players)){p.floor='ground';p.pos={x:3,y:3};}
  addLog(game,'🏚  游戏开始！探索这座神秘的古宅……','system');
  nextTurn(game);
}

// ── 掷骰处理 ──────────────────────────────────────────────────────────────────
function handleRollDice(game,player){
  const pa=game.pendingAction;
  if(!pa||pa.playerId!==player.id) return;
  const result=rollDice(pa.diceCount||0);
  game.lastRoll={playerId:player.id,dice:result.dice,total:result.total,purpose:pa.type};

  if(pa.type==='roll_check'){
    if(pa.outcomes){
      const matched=pa.outcomes.find(o=>result.total>=o.minRoll);
      game.lastRoll.matchedOutcomeIdx=matched?pa.outcomes.indexOf(matched):pa.outcomes.length-1;
      addLog(game,`🎲 ${player.name} 掷${statLabel(pa.checkStat)}骰（${pa.diceCount}枚）：[${result.dice.join(',')}]=${result.total} →【${matched?.label||'0'}】`,'roll');
      if(matched?.desc) addLog(game,`💬 ${matched.desc}`,'event');
      if(matched?.effects?.length) resolveEffects(game,player,matched.effects);
    }
    if(pa.isOmenCard){
      game.omenCount++;
      addLog(game,`🩸 凶兆数 ${game.omenCount}，进行凶兆检定！`,'omen');
      game.pendingAction=mkPending('roll_haunt',player.id,{diceCount:6});
    }else{game.pendingAction=null;nextTurn(game);}
  }
  else if(pa.type==='roll_haunt'){
    const triggered=result.total<game.omenCount;
    addLog(game,`🎲 凶兆检定（6枚）：[${result.dice.join(',')}]=${result.total} vs ${game.omenCount} → ${triggered?'☠️ 幽灵降临！':'😮‍💨 安全……'}`,'roll');
    if(triggered) triggerHaunt(game,player.id);
    game.pendingAction=null;nextTurn(game);
  }
  else if(pa.type==='roll_combat_atk'){
    addLog(game,`⚔️  ${player.name} 攻击骰（${pa.diceCount}枚）：[${result.dice.join(',')}]=${result.total}`,'combat');
    const defender=game.players[pa.defenderId];
    game.combatCtx={...game.combatCtx,atkTotal:result.total};
    game.pendingAction=mkPending('roll_combat_def',pa.defenderId,{diceCount:defender?.stats?.might||2,attackerId:pa.attackerId,defenderId:pa.defenderId,atkTotal:result.total});
    addLog(game,`🛡  ${defender?.name||'?'} 掷防御骰（力量 ${defender?.stats?.might}枚）……`,'combat');
  }
  else if(pa.type==='roll_combat_def'){
    const dmg=Math.max(0,pa.atkTotal-result.total);
    const attacker=game.players[pa.attackerId];
    addLog(game,`🛡  ${player.name} 防御骰（${pa.diceCount}枚）：[${result.dice.join(',')}]=${result.total}`,'combat');
    if(dmg>0){resolveEffects(game,player,[{type:'stat',stat:'might',val:-dmg}]);addLog(game,`💥 ${player.name} 受到 ${dmg} 点伤害！（力量→${player.stats.might}）`,'combat');}
    else addLog(game,'🛡  防御成功！','combat');
    game.combatCtx=null;game.pendingAction=null;
    addLog(game,`⚔️  战斗结束，${attacker?.name||'?'} 可继续行动。`,'combat');
    checkWin(game);
  }
}

// ── 摸牌处理 ──────────────────────────────────────────────────────────────────
function handleDrawCard(game,player){
  const pa=game.pendingAction;
  if(!pa||pa.type!=='draw_card'||pa.playerId!==player.id) return;
  const card=drawFromDeck(game,pa.cardType);
  if(!card){addLog(game,'牌堆已空，跳过摸牌。','normal');game.pendingAction=null;nextTurn(game);return;}
  addLog(game,`${player.name} 翻开了【${card.name}】`,pa.cardType);
  if(pa.cardType==='item'){
    player.items.push(card);resolveEffects(game,player,card.effects||[]);
    addLog(game,`📦 ${player.name} 获得【${card.name}】：${card.effectDesc}${card.isArtifact?' ✨神器！':''}  ，回合结束。`,'item');
    game.pendingAction=null;nextTurn(game);
  }else if(pa.cardType==='event'){
    if(card.checkStat&&card.outcomes){
      game.pendingAction=mkPending('roll_check',player.id,{diceCount:player.stats[card.checkStat],checkStat:card.checkStat,outcomes:card.outcomes,isOmenCard:false,card});
      addLog(game,`⚡ 需要【${statLabel(card.checkStat)}检定】（掷 ${player.stats[card.checkStat]} 枚骰）`,'event');
    }else{resolveEffects(game,player,card.effects||[]);addLog(game,`⚡ ${card.effectDesc||'事件结算'}，回合结束。`,'event');game.pendingAction=null;nextTurn(game);}
  }else if(pa.cardType==='omen'){
    if(card.checkStat&&card.outcomes){
      game.pendingAction=mkPending('roll_check',player.id,{diceCount:player.stats[card.checkStat],checkStat:card.checkStat,outcomes:card.outcomes,isOmenCard:true,card});
      addLog(game,`🩸 凶兆牌：需要【${statLabel(card.checkStat)}检定】，之后进行凶兆检定`,'omen');
    }else{
      if(card.effects?.length){resolveEffects(game,player,card.effects);addLog(game,`🩸 ${card.effectDesc||'凶兆效果'}` ,'omen');}
      game.omenCount++;addLog(game,`🩸 凶兆数 ${game.omenCount}，进行凶兆检定！`,'omen');
      game.pendingAction=mkPending('roll_haunt',player.id,{diceCount:6});
    }
  }
}

// ── publicState（每个玩家看到的状态不同）────────────────────────────────────
function publicState(game,forId){
  const me=Object.values(game.players).find(p=>p.id===forId);
  return{
    code:game.code, phase:game.phase, winner:game.winner, hostId:game.hostId,
    players:Object.values(game.players).map(p=>({
      id:p.id,name:p.name,charId:p.charId,char:p.char,
      floor:p.floor,pos:p.pos,stats:p.stats,items:p.items,alive:p.alive,
      isTraitor:p.id===forId?p.isTraitor:(game.phase==='gameover'?p.isTraitor:null),
    })),
    board:game.board,
    currentId:game.turnOrder[game.currentIdx]||null,
    movesLeft:game.movesLeft,
    hasAttackedThisTurn:game.hasAttackedThisTurn,
    pendingAction:game.pendingAction,
    lastRoll:game.lastRoll,
    drawnCards:game.drawnCards,
    currentCard:game.currentCard,
    omenCount:game.omenCount,
    haunt:game.haunt?{started:true,scenario:game.haunt.scenario,heroGoal:game.haunt.heroGoal,traitorGoal:game.haunt.traitorGoal,traitorId:forId===game.haunt.traitorId?game.haunt.traitorId:null,amTraitor:forId===game.haunt.traitorId}:null,
    log:game.log.slice(-25),
    validMoves:me&&game.turnOrder[game.currentIdx]===forId?validMoves(game,me):[],
    attackTargets:me?attackTargets(game,me):[],
  };
}

function genCode(){const C='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:4},()=>C[Math.floor(Math.random()*C.length)]).join('');}

module.exports={
  CHARACTERS,createGame,addLog,mkPending,startGame,nextTurn,
  handleRollDice,handleDrawCard,triggerHaunt,checkWin,endGame,
  validMoves,attackTargets,publicState,genCode,genId,posKey,
};
