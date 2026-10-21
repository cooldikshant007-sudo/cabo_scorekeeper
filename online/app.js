const SUPABASE_URL = 'https://jpcdbtaztovxmqruvktv.supabase.co';
const db = window.supabase.createClient(SUPABASE_URL, 'sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');
const $ = (s) => document.querySelector(s);
const state = { user: null, guest: false, game: null, roomId: new URLSearchParams(location.search).get('room'), timer: null, message: '' };
const suit = { H: '♥', D: '♦', C: '♣', S: '♠' };
const esc = (v) => { const d = document.createElement('div'); d.textContent = v ?? ''; return d.innerHTML; };
const setStatus = (text) => $('#status').textContent = text;
const setUrl = (id) => { const u = new URL(location); id ? u.searchParams.set('room', id) : u.searchParams.delete('room'); history.replaceState({}, '', u); };
function guestId() { let id = localStorage.getItem('cabo-online-guest-id'); if (!/^[0-9a-f-]{36}$/i.test(id || '')) { id = crypto.randomUUID(); localStorage.setItem('cabo-online-guest-id', id); } return id; }
function cardText(card) { if (!card) return '?'; const [s, rank] = card.split(':'); return `${rank}${suit[s] || ''}`; }
function cardClass(card) { return /^(H|D):/.test(card || '') ? ' red' : ''; }
async function api(payload) {
  const headers = { 'Content-Type': 'application/json', 'X-Guest-ID': guestId() };
  const response = await fetch(`${SUPABASE_URL}/functions/v1/online-cabo`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not reach the table.'); return data;
}
function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }
function startPolling() { stopPolling(); state.timer = setInterval(() => state.roomId && refreshGame(true), 1800); }
async function refreshGame(silent = false) { if (!state.roomId) return; try { state.game = await api({ op: 'get', gameId: state.roomId }); renderGame(); if (!silent) setStatus('Live room connected.'); } catch (e) { if (!silent) setStatus(e.message); } }
async function loadRooms() {
  try { const data = await api({ op: 'list' }); $('#roomList').innerHTML = data.games.length ? data.games.map(g => `<div class="room-row"><span><strong>${esc(g.room_code)}</strong><br><small>${esc(g.status)} · ${new Date(g.updated_at).toLocaleDateString()}</small></span><button data-open="${g.id}">Open</button></div>`).join('') : '<p class="muted">No online rooms yet.</p>'; $('#roomList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openRoom(b.dataset.open)); } catch (e) { $('#roomList').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
function showHome() { stopPolling(); state.roomId = null; state.game = null; setUrl(null); $('#game').hidden = true; $('#home').hidden = false; loadRooms(); setStatus('Create a private room or join your friends.'); }
async function openRoom(id) { state.roomId = id; setUrl(id); $('#home').hidden = true; $('#game').hidden = false; await refreshGame(); startPolling(); }
function renderGame() {
  const view = state.game; if (!view) return; const { game, players, me } = view; $('#roomCode').textContent = game.code; $('#lobbyCode').textContent = game.code;
  $('#lobby').hidden = game.status !== 'lobby'; $('#table').hidden = game.status !== 'active'; $('#finished').hidden = game.status !== 'finished';
  if (game.status === 'lobby') { $('#lobbyPlayers').innerHTML = players.map(p => `<div class="player-row"><strong>${esc(p.name)}</strong><span>Seat ${p.seat}</span></div>`).join(''); const host = game.owner; $('#startGame').hidden = !host; $('#startGame').disabled = players.length < 2; $('#lobbyHint').textContent = host ? (players.length < 2 ? 'Waiting for at least one friend.' : 'Everyone is here? Deal the cards.') : 'Waiting for the host to deal the cards.'; }
  if (game.status === 'active') renderTable(view);
  if (game.status === 'finished') { const winner = players.find(p => p.id === game.winnerPlayerId); $('#finished').innerHTML = `<p class="eyebrow">GAME COMPLETE</p><h2>${esc(winner?.name || 'Table')} wins</h2><p>Lowest total takes the game.</p><div class="scores">${players.sort((a,b) => a.score-b.score).map(p => `<div class="score-row"><span>${esc(p.name)}</span><strong>${p.score} points</strong></div>`).join('')}</div><button id="backToRooms" class="wide">Back to rooms</button>`; $('#backToRooms').onclick = showHome; }
}
function renderTable(view) {
  const { game, players, me } = view; const current = players.find(p => p.id === game.currentPlayerId); const mine = players.find(p => p.id === me.id);
  $('#turnLabel').textContent = me.canAct ? 'Your turn' : `${current?.name || 'Waiting'}’s turn`;
  $('#deckCount').textContent = game.deckCount; $('#discardCard').textContent = cardText(game.discard); $('#discardCard').className = cardClass(game.discard);
  $('#drawDeck').disabled = !me.canAct || !!me.drawnCard || !!game.pendingPower; $('#drawnCard').hidden = !me.drawnCard; $('#drawnCard').textContent = me.drawnCard ? `You drew ${cardText(me.drawnCard)}` : '';
  $('#callCabo').hidden = !me.canCallCabo; $('#lastRound').hidden = !game.caboCalledBy; if (game.caboCalledBy) $('#lastRound').textContent = `Cabo called — ${game.finalTurnsRemaining} final turn${game.finalTurnsRemaining === 1 ? '' : 's'} remain.`;
  $('#myTurnBadge').textContent = me.canAct ? 'YOUR TURN' : 'WAITING';
  const known = me.knownCards || {}; $('#myHand').innerHTML = Array.from({ length: mine.cardCount }, (_, i) => { const card = known[i]; return `<div class="card ${card ? 'known' + cardClass(card) : ''}">${card ? cardText(card) : '?'}</div>`; }).join('');
  $('#drawActions').hidden = !me.drawnCard || !!game.pendingPower; if (me.drawnCard && !game.pendingPower) { $('#replaceChoices').innerHTML = Array.from({ length: mine.cardCount }, (_, i) => `<button data-replace="${i}">Replace ${i + 1}</button>`).join(''); $('#replaceChoices').querySelectorAll('[data-replace]').forEach(b => b.onclick = () => act({ action: 'replace', slot: Number(b.dataset.replace) })); }
  renderPower(view);
  $('#otherPlayers').innerHTML = players.filter(p => p.id !== me.id).map(p => { const seen = me.observations?.[p.id] || {}; return `<article class="opponent"><div class="opponent-top"><strong>${esc(p.name)}${p.isTurn ? ' · turn' : ''}</strong><span>${p.cardCount} cards</span></div><div class="mini-cards">${Array.from({ length: p.cardCount }, (_,i) => `<span class="mini-card ${seen[i] ? 'known' + cardClass(seen[i]) : ''}">${seen[i] ? cardText(seen[i]) : '?'}</span>`).join('')}</div></article>`; }).join('');
  const options = players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''); $('#matchPanel').innerHTML = `<form id="matchForm" class="match-form"><select id="matchPlayer">${options}</select><select id="matchSlot"><option value="0">Card 1</option><option value="1">Card 2</option><option value="2">Card 3</option><option value="3">Card 4</option></select><button>Throw</button></form><p class="muted">Choose a face-down card only when it matches the discard rank.</p>`; $('#matchForm').onsubmit = (e) => { e.preventDefault(); act({ action: 'match_throw', targetPlayerId: $('#matchPlayer').value, slot: Number($('#matchSlot').value) }); };
}
function renderPower(view) {
  const panel = $('#powerPanel'), { game, players, me } = view, rank = game.pendingPower?.rank; panel.hidden = !rank; if (!rank) return;
  if (rank === 'J') { panel.innerHTML = '<h3>Jack — skip next player</h3><p>Your turn ends and the next player is skipped.</p><button id="usePower">Use Jack</button>'; $('#usePower').onclick = () => act({ action: 'power' }); return; }
  if (rank === '7' || rank === '8') { panel.innerHTML = `<h3>${rank} — look at your card</h3><p>Choose one card to view.</p><div class="card-buttons">${[0,1,2,3].map(i => `<button data-slot="${i}">Card ${i+1}</button>`).join('')}</div>`; panel.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => act({ action:'power', mySlot:Number(b.dataset.slot) })); return; }
  const title = rank === '9' || rank === '10' ? `${rank} — look at another card` : rank === 'Q' ? 'Queen — blind swap' : 'King — look and swap';
  panel.innerHTML = `<h3>${title}</h3><p>${rank === 'Q' ? 'Swap without seeing either card.' : rank === 'K' ? 'See both selected cards, then swap them.' : 'Look at one opponent card.'}</p><div class="stack compact"><select id="powerTarget">${players.filter(p => p.id !== me.id).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><select id="powerTargetSlot">${[0,1,2,3].map(i => `<option value="${i}">Their card ${i+1}</option>`).join('')}</select>${rank === 'Q' || rank === 'K' ? `<select id="powerMySlot">${[0,1,2,3].map(i => `<option value="${i}">Your card ${i+1}</option>`).join('')}</select>` : ''}<button id="usePower">Use power</button></div>`;
  $('#usePower').onclick = () => act({ action:'power', targetPlayerId: $('#powerTarget').value, targetSlot:Number($('#powerTargetSlot').value), ...(rank === 'Q' || rank === 'K' ? { mySlot:Number($('#powerMySlot').value) } : {}) });
}
async function act(payload) { try { const data = await api({ op:'action', gameId:state.roomId, ...payload }); state.game = data; state.message = data.message || ''; renderGame(); setStatus(state.message || 'Table updated.'); } catch (e) { setStatus(e.message); } }
$('#newGuest').onclick = () => { if (!confirm('Start fresh as a new guest? You will no longer be able to reopen rooms from this browser.')) return; localStorage.removeItem('cabo-online-guest-id'); location.assign(location.pathname); };
$('#createForm').onsubmit = async (e) => { e.preventDefault(); try { const data = await api({ op:'create', name:$('#createName').value }); state.game = data; await openRoom(data.game.id); } catch (err) { setStatus(err.message); } };
$('#joinForm').onsubmit = async (e) => { e.preventDefault(); try { const data = await api({ op:'join', code:$('#joinCode').value, name:$('#joinName').value }); state.game = data; await openRoom(data.game.id); } catch (err) { setStatus(err.message); } };
$('#refreshRooms').onclick = loadRooms; $('#leaveRoom').onclick = showHome; $('#copyCode').onclick = async () => { await navigator.clipboard.writeText(state.game?.game.code || ''); setStatus('Room code copied.'); };
$('#startGame').onclick = async () => { try { state.game = await api({ op:'start', gameId:state.roomId }); renderGame(); setStatus('Cards dealt.'); } catch (e) { setStatus(e.message); } };
$('#drawDeck').onclick = () => act({ action:'draw' }); $('#discardDraw').onclick = () => act({ action:'discard' }); $('#callCabo').onclick = () => act({ action:'call_cabo' }); $('#matchToggle').onclick = () => $('#matchPanel').hidden = !$('#matchPanel').hidden;
async function init() { state.guest = true; guestId(); $('#accountEmail').textContent = 'Guest player'; if (state.roomId) { $('#game').hidden = false; $('#home').hidden = true; await refreshGame(); startPolling(); } else { $('#home').hidden = false; showHome(); } }
init();
