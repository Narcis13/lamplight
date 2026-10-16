const fs = require('fs');
eval(fs.readFileSync(__dirname + '/src/engine.js','utf8') + '\n;globalThis.E={Cards,HandEval,Equity,PotManager,Game,Strength,HandLog,PROFILES};');
const {Cards,HandEval,Equity,PotManager,Game,Strength,HandLog} = E;
const C = s => { const r='23456789TJQKA'.indexOf(s[0]); const su='shdc'.indexOf(s[1]); return r*4+su; };
const H = str => str.split(' ').map(C);
const d = str => HandEval.describe(HandEval.score(H(str)));
let fails=0; const eq=(a,b,m)=>{ if(a!==b){fails++;console.log('FAIL',m,'got',a,'want',b);} };
eq(d('As Ks Qs Js Ts 2d 3c'),'Royal flush','royal');
eq(d('5h 4h 3h 2h Ah Kd Kc'),'Straight flush, five high','wheel sf');
eq(d('9c 9d 9h 9s 2c 3d Kh'),'Four nines','quads');
eq(d('Kc Kd Kh 4s 4c 4d 2h'),'Kings full of fours','fh from two trips');
eq(d('Ac 3c 7c 9c Jc Kd Qh'),'Flush, ace high','flush');
eq(d('Ad 2c 3h 4s 5d Kc Qh'),'Straight, five high','wheel');
eq(d('Td Jc Qh Ks Ad 2c 2h'),'Straight, ace high','broadway over pair');
eq(d('7c 7d 7h Ks 2d 4c 9h'),'Three sevens','trips');
eq(d('Ac Ad Kh Ks 2d 2c 9h'),'Two pair, aces and kings','two pair (3 pairs)');
const s1=HandEval.score(H('Ac Ad Kh Ks 2d 2c 9h')), s2=HandEval.score(H('Ac Ad Kh Ks 2d 3c 8h'));
if(!(s1>s2)) {fails++;console.log('FAIL kicker from 3rd pair');}
eq(d('Ac Ad 3h 5s 8d Tc Jh'),'Pair of aces','pair');
eq(d('2c 4d 6h 8s Td Qc Kh'),'King high','high');
const sa=HandEval.score(H('As Ks Qd Jc 9h 3d 2c')), sb=HandEval.score(H('As Ks Qd Jc 8h 3d 2c'));
if(!(sa>sb)) {fails++; console.log('FAIL high card kicker');}
// straight flush vs flush in 7 cards with 6 suited
eq(d('2h 3h 4h 5h 6h 9h Kh'),'Straight flush, six high','sf with extra suited');
eq(Strength.chen(C('As'),C('Ah')),20,'chen AA'); eq(Strength.chen(C('2s'),C('2h')),5,'chen 22');
eq(Strength.chen(C('As'),C('Ks')),12,'chen AKs'); eq(Strength.chen(C('7s'),C('2h')),-1,'chen 72o');
// equity sanity: AA vs KK ~ 0.82
const e = Equity.known([H('As Ah'),H('Ks Kh')],[]);
console.log('AA vs KK', e.map(x=>x.toFixed(3)).join(' '));
console.log('AA vs 1 random', Equity.vsRandom(H('As Ah'),[],1,20000).toFixed(3), ' 72o vs 1', Equity.vsRandom(H('7s 2h'),[],1,20000).toFixed(3));
// pots
const P=(seat,total,folded=false)=>({seat,total,active:!folded});
console.log(JSON.stringify(PotManager.build([P(0,50),P(1,200),P(2,200),P(3,20,true),P(4,0,true),P(5,300)])));
console.log('evaluator unit tests failures:', fails);

// headless game
const noop = new Proxy({}, {get:(t,k)=> k==='then'?undefined:(()=>Promise.resolve())});
async function sim(hands){
  const log = new HandLog();
  const g = new Game({view:noop,panel:noop,log,sfx:noop,settings:{speed:'turbo',showOdds:false},headless:true});
  g.setup({name:'Hero',buyInBB:100,heroProfile:'shark'});
  let drift=0; const origErr=console.error; console.error=(...a)=>{drift++; origErr(...a);};
  const t=Date.now();
  let showdowns=0, allins=0, sidepots=0;
  const orig = g.showdown.bind(g);
  g.showdown = async function(){ showdowns++; if(g.runout) allins++; if(PotManager.build(g.players).length>1) sidepots++; return orig(); };
  await g.run(hands);
  console.error=origErr;
  console.log(`hands ${g.handNo} in ${Date.now()-t}ms, drift events ${drift}, showdowns ${showdowns}, allin runouts ${allins}, multi-pot showdowns ${sidepots}`);
  for (const p of g.players) console.log(p.name.padEnd(15), (p.profileKey||'').padEnd(8), 'net', String(p.stack-p.buyIns).padStart(6), 'VPIP', (100*p.stats.vpip/p.stats.hands).toFixed(0).padStart(3), 'PFR', (100*p.stats.pfr/p.stats.hands).toFixed(0).padStart(3), 'buyins', p.buyIns/g.buyIn);
}
sim(4000);
