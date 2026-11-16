let currentState = null;
let currentSettings = { mode:'topScorers', playerCount:6, stats:['points','rebounds','assists'], title:'PLAYER STATISTICS', accent:'#27a9ff' };
const $ = id => document.getElementById(id);
const names = {points:'PONT',rebounds:'LEPATTANÓ',assists:'GÓLPASSZ',steals:'LABDASZERZÉS',turnovers:'ELADOTT LABDA',blocks:'BLOKK',val:'VAL',minutes:'JÁTÉKIDŐ',three:'TRIPLA %',plusMinus:'+/-'};
function valueFor(p,key){
 const map={points:p.points,rebounds:p.rebounds?.total,assists:p.assists,steals:p.steals,turnovers:p.turnovers,blocks:p.blocks?.made,val:p.val,minutes:p.minutes,three:p.three?.percent,plusMinus:p.plusMinus};
 return map[key] ?? '—';
}
function esc(s){return String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
 const data=currentState?.data;
 document.documentElement.style.setProperty('--accent',currentSettings.accent||'#27a9ff');
 $('graphicTitle').textContent=currentSettings.title||'PLAYER STATISTICS';
 $('score').style.display=currentSettings.showScore===false?'none':'';
 $('homeTeam').textContent=data?.homeTeam||'HOME';
 $('awayTeam').textContent=data?.awayTeam||'AWAY';
 $('homeScore').textContent=data?.homeScore||'—';
 $('awayScore').textContent=data?.awayScore||'—';
 $('period').textContent=data?.period||'MATCH STATISTICS';
 const stats=(currentSettings.stats||[]).slice(0,4);
 const players=[...(data?.playerStats||[])];
 if(currentSettings.mode==='topScorers') players.sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0));
 if(currentSettings.mode==='teamComparison'){
   const teams=[...new Set(players.map(p=>p.team))];
   const keys=stats.length?stats:['points','rebounds','assists'];
   $('stats').innerHTML=teams.map(team=>{
     const group=players.filter(p=>p.team===team);
     const sums=keys.map(k=>group.reduce((sum,p)=>sum+(Number(valueFor(p,k))||0),0));
     return `<div class="team-total"><b>${esc(team)}</b>${keys.map((k,i)=>`<span>${names[k]||k}: ${sums[i]}</span>`).join('')}</div>`;
   }).join('');
 } else if(currentSettings.mode==='scoreOnly'){
   $('stats').innerHTML='<div class="score-only">FINAL SCORE</div>';
 } else if(!players.length){
   $('stats').innerHTML='<div class="placeholder">Nincs feldolgozott Box Score adat. Ellenőrizd az adminfelület adatkapcsolatát.</div>';
 } else {
   const selected=players.slice(0,Math.max(1,Number(currentSettings.playerCount)||6));
   $('stats').innerHTML=`<div class="table-head"><span>JÁTÉKOS</span>${stats.map(k=>`<span>${names[k]||k}</span>`).join('')}</div>`+
   selected.map(p=>`<div class="player-row"><b>${esc(p.name)}</b>${stats.map(k=>`<span>${esc(valueFor(p,k))}</span>`).join('')}</div>`).join('');
 }
 $('updated').textContent=currentState?.updatedAt?new Date(currentState.updatedAt).toLocaleTimeString('hu-HU'):'WAITING FOR DATA';
}
async function init(){
 try{
  const [stateRes,settingsRes]=await Promise.all([fetch('/api/state'),fetch('/api/display-settings')]);
  currentState=await stateRes.json();currentSettings=await settingsRes.json();render();
 }catch{}
 const proto=location.protocol==='https:'?'wss:':'ws:';
 const ws=new WebSocket(`${proto}//${location.host}`);
 ws.onmessage=e=>{try{const s=JSON.parse(e.data);currentState=s;if(s.displaySettings)currentSettings=s.displaySettings;render();}catch{}};
}
init();