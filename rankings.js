(() => {
const esc = escapeHTML;
function caboRows(games){return games.filter(g=>g.game_type==='cabo'&&Array.isArray(g.state?.rounds)&&g.state.rounds.length>0).flatMap(g=>{const p=Array.isArray(g.state?.players)?g.state.players:[],r=Array.isArray(g.state?.rounds)?g.state.rounds:[];return p.map((name,i)=>({name,score:r.reduce((sum,row)=>sum+Number(row?.[i]||0),0)}))})}
function pokerRows(games){return games.filter(g=>g.game_type==='poker'&&g.completed&&(g.state?.settings?.currency||g.currency||'INR')==='INR').flatMap(g=>{const s=g.state?.settings||{},v=Number(s.buyInValue||0)/Math.max(1,Number(s.chipsPerBuyIn||1)),f=g.state?.finalChips||{};return(g.state?.players||[]).map(p=>{const bought=Number(p.initialChips||0)+(p.buyIns||[]).reduce((sum,b)=>sum+Number(b.chips||0),0);return{name:p.name||'Player',net:(Number(f[p.id]||0)-bought)*v,currency:s.currency||g.currency||'INR'}})})}
function renderStats(games){const cabo=Object.create(null);caboRows(games).forEach(r=>{const key=r.name.trim().toLocaleLowerCase();const x=cabo[key]||{name:r.name.trim(),n:0,total:0};x.n++;x.total+=r.score;cabo[key]=x});const cl=Object.values(cabo).sort((a,b)=>a.total/a.n-b.total/b.n||a.name.localeCompare(b.name));$('#caboStats').innerHTML=cl.length?'<table class="table"><tr><th>Rank</th><th>Player</th><th>Games</th><th>Total score</th><th>Average</th></tr>'+cl.map((x,i)=>'<tr><td>#'+(cl.findIndex(p=>p.total*x.n===x.total*p.n)+1)+'</td><td>'+esc(x.name)+'</td><td>'+x.n+'</td><td>'+x.total+'</td><td>'+(x.total/x.n).toFixed(1)+'</td></tr>').join('')+'</table>':'<p class="note">No recorded Cabo rounds yet.</p>';const poker=Object.create(null);pokerRows(games).forEach(r=>{const k=r.name.trim().toLocaleLowerCase(),x=poker[k]||{name:r.name.trim(),net:0,n:0};x.net+=r.net;x.n++;poker[k]=x});const pl=Object.values(poker).map(x=>({...x,net:Math.round((x.net+Number.EPSILON)*100)/100})).sort((a,b)=>b.net-a.net||a.name.localeCompare(b.name));const rupees=v=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);$('#pokerStats').innerHTML=pl.length?'<table class="table"><tr><th>Rank</th><th>Player</th><th>Games</th><th>Total net winnings (₹)</th></tr>'+pl.map(x=>'<tr><td>#'+(pl.findIndex(p=>p.net===x.net)+1)+'</td><td>'+esc(x.name)+'</td><td>'+x.n+'</td><td>'+(x.net>0?'+':'')+rupees(x.net)+'</td></tr>').join('')+'</table>':'<p class="note">No completed Poker games yet.</p>'}

let loading=false;
async function refreshRankings(){
 if(loading)return;loading=true;
 const root=document.querySelector('#communityRankings');
 try{
 const {data:session}=await db.auth.getSession();
 if(!session.session){root.hidden=false;root.querySelector('[data-rank-message]').textContent='Sign in with your game account to view community ranks and Poker winnings in rupees.';$('#caboStats').innerHTML='';$('#pokerStats').innerHTML='';return;}
 root.hidden=false;
 const {data:communities,error}=await db.from('communities').select('id,name');
 if(error)throw error;
 const picker=root.querySelector('select'),selected=picker.value;
 picker.innerHTML=(communities||[]).map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
 const preferred=selected||activeGame?.community_id||requestedCommunityId;
 if(communities?.some(c=>c.id===preferred))picker.value=preferred;
 if(!communities?.length){root.querySelector('[data-rank-message]').textContent='Create or join a community to see rankings.';renderStats([]);return;}
 const {data:games,error:gamesError}=await db.from('community_games').select('game_type,state,completed,currency').eq('community_id',picker.value);
 if(gamesError)throw gamesError;
 renderStats(games||[]);root.querySelector('[data-rank-message]').textContent='Cabo: lowest average leads · Poker: highest total net winnings in ₹ leads.';
 }catch(e){root.querySelector('[data-rank-message]').textContent='Could not load rankings. Tap Refresh to retry.';}
 finally{loading=false;}
}
document.querySelector('#refreshRankings').onclick=refreshRankings;
document.querySelector('#rankCommunity').onchange=refreshRankings;
db.auth.onAuthStateChange(()=>setTimeout(refreshRankings,0));
refreshRankings();
})();