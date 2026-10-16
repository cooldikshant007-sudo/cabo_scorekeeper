const $ = (s) => document.querySelector(s);
let players = [];
let rounds = [];
let editingRound = null;
let gameStarted = false;
const params = new URLSearchParams(window.location.search);
const viewMode = params.get('view') === '1';
const suppliedGameId = params.get('game');
const GAME_ID = /^[a-z0-9-]{3,64}$/.test(suppliedGameId || '') ? suppliedGameId : `cabo-${crypto.randomUUID().slice(0, 12)}`;
if (!suppliedGameId) window.history.replaceState({}, '', `${window.location.pathname}?game=${GAME_ID}`);
const STORAGE_KEY = `cabo-scorekeeper-game-${GAME_ID}`;
const DEVICE_KEY = 'cabo-scorekeeper-device-id';
const DEVICE_ID = localStorage.getItem(DEVICE_KEY) || crypto.randomUUID();
if (!localStorage.getItem(DEVICE_KEY)) localStorage.setItem(DEVICE_KEY, DEVICE_ID);
let ownerId = DEVICE_ID;
const db = window.supabase.createClient('https://jpcdbtaztovxmqruvktv.supabase.co', 'sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');

function setSyncStatus(message, state = '') { const status = $('#syncStatus'); status.textContent = message; status.className = `sync-status ${state}`; }
function isOwner() { return ownerId === DEVICE_ID && !viewMode; }
function currentState() { return { players, rounds, started: gameStarted, ownerId }; }
function saveGame() {
  if (!isOwner()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState()));
  db.from('cabo_games').update({ state: currentState(), updated_at: new Date().toISOString() }).eq('id', GAME_ID)
    .then(({ error }) => { if (error) setSyncStatus('Could not save live update', 'error'); });
}
function loadGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.players) && Array.isArray(saved?.rounds)) { players = saved.players; rounds = saved.rounds; gameStarted = saved.started ?? rounds.length > 0; ownerId = saved.ownerId || ownerId; }
  } catch { localStorage.removeItem(STORAGE_KEY); }
}

const playerForm = $('#playerForm');
const playerName = $('#playerName');

$('#copyLink').onclick = async () => {
  const viewerURL = new URL(window.location.href); viewerURL.searchParams.set('view', '1');
  try { await navigator.clipboard.writeText(viewerURL.href); $('#copyLink').textContent = 'Copied!'; setTimeout(() => { $('#copyLink').textContent = 'Copy viewer link'; }, 1600); }
  catch { $('#copyLink').textContent = 'Copy unavailable'; }
};
$('#newRoom').onclick = () => { if (isOwner()) window.location.assign(`${window.location.pathname}?game=cabo-${crypto.randomUUID().slice(0, 12)}`); };

function renderSetup() {
  const chips = $('#playerChips'); chips.innerHTML = '';
  players.forEach((name, index) => {
    const chip = $('#playerChipTemplate').content.cloneNode(true);
    chip.querySelector('.chip-name').textContent = name;
    chip.querySelector('button').onclick = () => { if (!isOwner()) return; players.splice(index, 1); saveGame(); renderSetup(); };
    chips.append(chip);
  });
  $('#startGame').disabled = players.length < 2;
  $('#setupHint').textContent = players.length < 2 ? 'Add at least 2 players to begin.' : `${players.length} players ready.`;
}

function totals() { return players.map((_, i) => rounds.reduce((sum, row) => sum + row[i], 0)); }
function showCorrectScreen() {
  document.body.classList.toggle('viewer-mode', !isOwner());
  $('#accessBanner').textContent = isOwner() ? 'Editor access · only this device can update scores.' : 'Live viewer access · scores update automatically.';
  const showGame = gameStarted || (!isOwner() && players.length >= 2);
  $('#setupCard').hidden = showGame;
  $('#gameArea').hidden = !showGame;
  if (showGame) renderGame(); else renderSetup();
}
function renderGame() {
  const editable = isOwner();
  const scoreTotals = totals();
  const order = players.map((name, i) => ({name, i, total: scoreTotals[i]})).sort((a,b) => a.total - b.total || a.name.localeCompare(b.name));
  $('#standings').innerHTML = order.map((p, rank) => `<article class="standing ${rank === 0 ? 'leader' : ''}"><span class="rank">#${rank + 1}${rank === 0 ? ' · LEADING' : ''}</span><span class="standing-name">${escapeHTML(p.name)}</span><span class="total">${p.total}</span><span class="total-label">points total</span></article>`).join('');
  $('#roundTitle').textContent = `Round ${rounds.length + 1}`;
  $('#roundInputs').innerHTML = players.map((name, i) => `<div class="score-field"><label for="score-${i}">${escapeHTML(name)}</label><input id="score-${i}" type="number" inputmode="numeric" step="1" value="0" required /></div>`).join('');
  $('#undoRound').disabled = rounds.length === 0;
  const table = $('#historyTable');
  if (!rounds.length) { table.innerHTML = '<p class="empty">No rounds yet. Scores will show up here.</p>'; return; }
  table.innerHTML = `<table><thead><tr><th>ROUND</th>${players.map(p => `<th>${escapeHTML(p)}</th>`).join('')}${editable ? '<th></th>' : ''}</tr></thead><tbody>${rounds.map((row, r) => {
    const isEditing = editingRound === r;
    return `<tr class="${isEditing ? 'editing-row' : ''}"><td>${r + 1}</td>${row.map((score, p) => editable && isEditing
      ? `<td><input class="history-score" id="edit-${r}-${p}" type="number" inputmode="numeric" step="1" value="${score}" aria-label="${escapeHTML(players[p])} score in round ${r + 1}" /></td>`
      : `<td>${score}</td>`).join('')}${editable ? `<td class="row-actions">${isEditing
      ? `<button class="mini-save" data-save-round="${r}">Save</button><button class="mini-cancel" data-cancel-edit>Cancel</button>`
      : `<button class="edit-round" data-edit-round="${r}">Edit</button>`}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function addPlayer(name) {
  const baseName = name.trim().replace(/-\d+$/, '');
  const matchingPlayers = players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.replace(/-\d+$/, '').toLowerCase() === baseName.toLowerCase());

  // A duplicate keeps every player identifiable without asking people to invent aliases.
  if (!matchingPlayers.length) { players.push(baseName); return; }

  matchingPlayers.forEach(({ player, index }) => {
    if (!/-\d+$/.test(player)) players[index] = `${player}-1`;
  });
  const usedNumbers = new Set(matchingPlayers.map(({ index }) => Number(players[index].match(/-(\d+)$/)?.[1]) || 1));
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  players.push(`${baseName}-${nextNumber}`);
}

playerForm.addEventListener('submit', (event) => {
  event.preventDefault(); const name = playerName.value.trim();
  if (!isOwner()) return;
  if (name) { addPlayer(name); playerName.value = ''; saveGame(); renderSetup(); }
  playerName.focus();
});
$('#startGame').onclick = () => { if (!isOwner() || players.length < 2) return; gameStarted = true; saveGame(); showCorrectScreen(); };
$('#roundForm').addEventListener('submit', (event) => { event.preventDefault(); if (!isOwner()) return; rounds.push(players.map((_, i) => Number($(`#score-${i}`).value))); saveGame(); renderGame(); });
$('#historyTable').addEventListener('click', (event) => {
  if (!isOwner()) return;
  const edit = event.target.closest('[data-edit-round]');
  const save = event.target.closest('[data-save-round]');
  if (event.target.closest('[data-cancel-edit]')) { editingRound = null; renderGame(); return; }
  if (edit) { editingRound = Number(edit.dataset.editRound); renderGame(); return; }
  if (save) {
    const round = Number(save.dataset.saveRound);
    const scores = players.map((_, i) => Number($(`#edit-${round}-${i}`).value));
    if (scores.some(Number.isNaN)) return;
    rounds[round] = scores; editingRound = null; saveGame(); renderGame();
  }
});
$('#undoRound').onclick = () => { if (!isOwner()) return; rounds.pop(); editingRound = null; saveGame(); renderGame(); };
$('#newGame').onclick = () => { if (!isOwner()) return; if (confirm('Start a new game? Your current scores will be cleared.')) { players = []; rounds = []; gameStarted = false; localStorage.removeItem(STORAGE_KEY); saveGame(); showCorrectScreen(); playerName.focus(); } };

async function connectSharedGame() {
  let { data, error } = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
  if (!data && !error) {
    const created = await db.from('cabo_games').insert({ id: GAME_ID, state: currentState() }).select('state').single();
    data = created.data; error = created.error;
    if (error?.code === '23505') ({ data, error } = await db.from('cabo_games').select('state').eq('id', GAME_ID).single());
  }
  if (error) { setSyncStatus('Live sync unavailable', 'error'); return; }
  players = data.state.players || [];
  rounds = data.state.rounds || [];
  gameStarted = data.state.started ?? rounds.length > 0;
  ownerId = data.state.ownerId || ownerId;
  if (!data.state.ownerId && !viewMode) saveGame();
  setSyncStatus('Live game connected', 'live');
  showCorrectScreen();
  db.channel(`cabo-scorekeeper-live-${GAME_ID}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cabo_games', filter: `id=eq.${GAME_ID}` }, ({ new: row }) => {
      players = row.state.players || []; rounds = row.state.rounds || []; gameStarted = row.state.started ?? rounds.length > 0; ownerId = row.state.ownerId || ownerId; editingRound = null; showCorrectScreen();
    })
    .subscribe();
}

loadGame();
showCorrectScreen();
connectSharedGame();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
