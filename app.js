const $ = (s) => document.querySelector(s);
const SUPABASE_URL = 'https://jpcdbtaztovxmqruvktv.supabase.co';
const db = window.supabase.createClient(SUPABASE_URL, 'sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');
const params = new URLSearchParams(window.location.search);
const viewMode = params.get('view') === '1';
const suppliedGameId = params.get('game');
const viewerToken = params.get('token');
const GAME_ID = /^[a-z0-9-]{3,64}$/.test(suppliedGameId || '') ? suppliedGameId : `cabo-${crypto.randomUUID().slice(0, 12)}`;
if (!suppliedGameId) window.history.replaceState({}, '', `${window.location.pathname}?game=${GAME_ID}`);

let players = [], rounds = [], editingRound = null, gameStarted = false;
let accountUser = null, activeGame = null, legacyGame = false, accountReady = false, viewerPoll = null;

function setSyncStatus(message, state = '') { const status = $('#syncStatus'); status.textContent = message; status.className = `sync-status ${state}`; }
function isOwner() { return Boolean(!viewMode && accountUser && activeGame?.owner_user_id === accountUser.id); }
function currentState() { return { players, rounds, started: gameStarted }; }
function hydrate(state) { players = Array.isArray(state?.players) ? state.players : []; rounds = Array.isArray(state?.rounds) ? state.rounds : []; gameStarted = Boolean(state?.started) || rounds.length > 0; editingRound = null; }
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function gameTitle() { return `Cabo game · ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date())}`; }

async function saveGame() {
  if (!isOwner()) return;
  const { error } = await db.from('cabo_account_games').update({ state: currentState(), updated_at: new Date().toISOString() }).eq('id', GAME_ID);
  if (error) setSyncStatus('Could not save your game', 'error');
}

function renderAccount() {
  const signedIn = Boolean(accountUser);
  $('#accountCard').hidden = viewMode;
  $('#signedOut').hidden = signedIn;
  $('#signedIn').hidden = !signedIn;
  $('#accountEmail').textContent = accountUser?.email || '';
  $('#accountStateSignedIn').textContent = 'Your games are saved to this account.';
  $('#accountStateSignedOut').textContent = 'Create an account once, then return to every saved game whenever you like.';
}
async function renderLibrary() {
  const list = $('#gameLibrary');
  if (!accountUser) { list.innerHTML = ''; return; }
  const { data, error } = await db.from('cabo_account_games').select('id,title,updated_at,state').order('updated_at', { ascending: false }).limit(20);
  if (error) { list.innerHTML = '<p class="library-empty">Could not load your saved games.</p>'; return; }
  if (!data?.length) { list.innerHTML = '<p class="library-empty">No saved games yet. Start one whenever you are ready.</p>'; return; }
  list.innerHTML = data.map((game) => {
    const count = Array.isArray(game.state?.players) ? game.state.players.length : 0;
    const updated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(game.updated_at));
    return `<button class="library-game" type="button" data-game-id="${game.id}"><span><strong>${escapeHTML(game.title)}</strong><small>${count} players · updated ${updated}</small></span><b>Open</b></button>`;
  }).join('');
}

function renderSetup() {
  const chips = $('#playerChips'); chips.innerHTML = '';
  players.forEach((name, index) => {
    const chip = $('#playerChipTemplate').content.cloneNode(true);
    chip.querySelector('.chip-name').textContent = name;
    chip.querySelector('button').onclick = () => { if (!isOwner()) return; players.splice(index, 1); saveGame(); renderSetup(); };
    chips.append(chip);
  });
  $('#startGame').disabled = !isOwner() || players.length < 2;
  $('#setupHint').textContent = players.length < 2 ? 'Add at least 2 players to begin.' : `${players.length} players ready.`;
}
function totals() { return players.map((_, i) => rounds.reduce((sum, row) => sum + Number(row[i] || 0), 0)); }
function showCorrectScreen() {
  const owner = isOwner();
  document.body.classList.toggle('viewer-mode', !owner);
  $('#accessBanner').textContent = owner ? 'Saved to your account · only you can update scores.' : legacyGame ? 'Legacy game · sign in to claim and save it to your account.' : 'Live viewer access · scores update automatically.';
  const showGame = gameStarted || (!owner && players.length >= 2);
  $('#setupCard').hidden = !owner || showGame;
  $('#gameArea').hidden = !showGame;
  if (showGame) renderGame(); else renderSetup();
  renderAccount();
}
function renderGame() {
  const editable = isOwner(), scoreTotals = totals();
  const order = players.map((name, i) => ({ name, i, total: scoreTotals[i] })).sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  $('#standings').innerHTML = order.map((p, rank) => `<article class="standing ${rank === 0 ? 'leader' : ''}"><span class="rank">#${rank + 1}${rank === 0 ? ' · LEADING' : ''}</span><span class="standing-name">${escapeHTML(p.name)}</span><span class="total">${p.total}</span><span class="total-label">points total</span></article>`).join('');
  $('#roundTitle').textContent = `Round ${rounds.length + 1}`;
  $('#roundInputs').innerHTML = players.map((name, i) => `<div class="score-field"><label for="score-${i}">${escapeHTML(name)}</label><input id="score-${i}" type="number" inputmode="numeric" step="1" value="0" required /></div>`).join('');
  $('#undoRound').disabled = !editable || rounds.length === 0;
  const table = $('#historyTable');
  if (!rounds.length) { table.innerHTML = '<p class="empty">No rounds yet. Scores will show up here.</p>'; return; }
  table.innerHTML = `<table><thead><tr><th>ROUND</th>${players.map(p => `<th>${escapeHTML(p)}</th>`).join('')}${editable ? '<th></th>' : ''}</tr></thead><tbody>${rounds.map((row, r) => {
    const isEditing = editingRound === r;
    return `<tr class="${isEditing ? 'editing-row' : ''}"><td>${r + 1}</td>${row.map((score, p) => editable && isEditing ? `<td><input class="history-score" id="edit-${r}-${p}" type="number" inputmode="numeric" step="1" value="${score}" aria-label="${escapeHTML(players[p])} score in round ${r + 1}" /></td>` : `<td>${score}</td>`).join('')}${editable ? `<td class="row-actions">${isEditing ? `<button class="mini-save" data-save-round="${r}">Save</button><button class="mini-cancel" data-cancel-edit>Cancel</button>` : `<button class="edit-round" data-edit-round="${r}">Edit</button>`}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}
function addPlayer(name) {
  const baseName = name.trim().replace(/-\d+$/, '');
  const matches = players.map((player, index) => ({ player, index })).filter(({ player }) => player.replace(/-\d+$/, '').toLowerCase() === baseName.toLowerCase());
  if (!matches.length) { players.push(baseName); return; }
  matches.forEach(({ player, index }) => { if (!/-\d+$/.test(player)) players[index] = `${player}-1`; });
  const used = new Set(matches.map(({ index }) => Number(players[index].match(/-(\d+)$/)?.[1]) || 1));
  let suffix = 1; while (used.has(suffix)) suffix += 1; players.push(`${baseName}-${suffix}`);
}

async function createAccountGame(initialState = currentState()) {
  if (!accountUser) return;
  const { data, error } = await db.from('cabo_account_games').insert({ id: GAME_ID, owner_user_id: accountUser.id, title: gameTitle(), state: initialState }).select('id,owner_user_id,title,state,viewer_token,updated_at').single();
  if (error) { setSyncStatus(error.code === '23505' ? 'This game belongs to another account' : 'Could not create your saved game', 'error'); return; }
  activeGame = data; legacyGame = false; hydrate(data.state); subscribeOwner(); setSyncStatus('Saved to your account', 'live'); showCorrectScreen(); renderLibrary();
}
function stopLiveConnections() { db.removeAllChannels(); if (viewerPoll) { clearInterval(viewerPoll); viewerPoll = null; } }
function subscribeOwner() {
  if (!isOwner()) return;
  db.channel(`cabo-account-${GAME_ID}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cabo_account_games', filter: `id=eq.${GAME_ID}` }, ({ new: row }) => { activeGame = row; hydrate(row.state); showCorrectScreen(); renderLibrary(); }).subscribe();
}
async function fetchViewerGame() {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/cabo-viewer-game?game=${encodeURIComponent(GAME_ID)}&token=${encodeURIComponent(viewerToken || '')}`);
  if (!response.ok) { setSyncStatus('Viewer link is invalid or expired', 'error'); return; }
  const data = await response.json(); hydrate(data.state); activeGame = data; legacyGame = false; setSyncStatus('Live viewer connected', 'live'); showCorrectScreen();
}
async function connectGame() {
  stopLiveConnections();
  if (viewMode && viewerToken) { await fetchViewerGame(); viewerPoll = setInterval(fetchViewerGame, 4000); return; }
  if (accountUser) {
    const { data, error } = await db.from('cabo_account_games').select('id,owner_user_id,title,state,viewer_token,updated_at').eq('id', GAME_ID).maybeSingle();
    if (error) { setSyncStatus('Could not load your saved game', 'error'); return; }
    if (data) { activeGame = data; legacyGame = false; hydrate(data.state); subscribeOwner(); setSyncStatus('Saved to your account', 'live'); showCorrectScreen(); return; }
    if (!suppliedGameId) { await createAccountGame({ players: [], rounds: [], started: false }); return; }
    const legacy = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
    if (legacy.data?.state && !viewMode) { hydrate(legacy.data.state); await createAccountGame(currentState()); return; }
    setSyncStatus('This game belongs to another account. Use its viewer link.', 'error'); showCorrectScreen(); return;
  }
  if (suppliedGameId) {
    const legacy = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
    if (legacy.data?.state) { hydrate(legacy.data.state); legacyGame = true; setSyncStatus('Legacy game loaded', 'live'); showCorrectScreen(); return; }
  }
  activeGame = null; hydrate({}); setSyncStatus('Sign in to create and save a game'); showCorrectScreen();
}
async function refreshAuth() {
  const { data } = await db.auth.getSession(); accountUser = data.session?.user || null; accountReady = true;
  renderAccount(); await renderLibrary(); await connectGame();
}

$('#signInForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const email = $('#emailInput').value.trim(), password = $('#passwordInput').value;
  if (!email || !password) return;
  const { error } = await db.auth.signInWithPassword({ email, password });
  $('#authMessage').textContent = error ? error.message : 'Signed in successfully.';
});
$('#createAccount').onclick = async () => {
  const email = $('#emailInput').value.trim(), password = $('#passwordInput').value;
  if (!email || !password) { $('#authMessage').textContent = 'Enter an email address and a password of at least 8 characters.'; return; }
  const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
  $('#authMessage').textContent = error ? error.message : data.session ? 'Account created and signed in.' : 'Account created. Confirm your email once, then sign in with your password.';
};
$('#signOut').onclick = async () => { await db.auth.signOut(); accountUser = null; activeGame = null; await refreshAuth(); };
$('#startSavedGame').onclick = () => { if (accountUser) window.location.assign(window.location.pathname); };
$('#gameLibrary').addEventListener('click', (event) => { const button = event.target.closest('[data-game-id]'); if (button) window.location.assign(`${window.location.pathname}?game=${button.dataset.gameId}`); });
$('#copyLink').onclick = async () => {
  if (!isOwner() || !activeGame?.viewer_token) return;
  const viewerURL = new URL(window.location.href); viewerURL.searchParams.set('view', '1'); viewerURL.searchParams.set('token', activeGame.viewer_token);
  try { await navigator.clipboard.writeText(viewerURL.href); $('#copyLink').textContent = 'Copied!'; setTimeout(() => { $('#copyLink').textContent = 'Copy viewer link'; }, 1600); } catch { $('#copyLink').textContent = 'Copy unavailable'; }
};
$('#newRoom').onclick = () => { if (isOwner()) window.location.assign(window.location.pathname); };
const playerForm = $('#playerForm'), playerName = $('#playerName');
playerForm.addEventListener('submit', (event) => { event.preventDefault(); const name = playerName.value.trim(); if (!isOwner() || !name) return; addPlayer(name); playerName.value = ''; saveGame(); renderSetup(); playerName.focus(); });
$('#startGame').onclick = () => { if (!isOwner() || players.length < 2) return; gameStarted = true; saveGame(); showCorrectScreen(); };
$('#roundForm').addEventListener('submit', (event) => { event.preventDefault(); if (!isOwner()) return; rounds.push(players.map((_, i) => Number($(`#score-${i}`).value))); saveGame(); renderGame(); });
$('#historyTable').addEventListener('click', (event) => {
  if (!isOwner()) return;
  const edit = event.target.closest('[data-edit-round]'), save = event.target.closest('[data-save-round]');
  if (event.target.closest('[data-cancel-edit]')) { editingRound = null; renderGame(); return; }
  if (edit) { editingRound = Number(edit.dataset.editRound); renderGame(); return; }
  if (save) { const round = Number(save.dataset.saveRound), scores = players.map((_, i) => Number($(`#edit-${round}-${i}`).value)); if (scores.some(Number.isNaN)) return; rounds[round] = scores; editingRound = null; saveGame(); renderGame(); }
});
$('#undoRound').onclick = () => { if (!isOwner()) return; rounds.pop(); editingRound = null; saveGame(); renderGame(); };
$('#newGame').onclick = () => { if (!isOwner()) return; if (confirm('Clear this game’s scores? The saved game link will remain.')) { hydrate({}); saveGame(); showCorrectScreen(); playerName.focus(); } };
db.auth.onAuthStateChange((_event, session) => { if (!accountReady) return; accountUser = session?.user || null; renderAccount(); renderLibrary(); connectGame(); });
refreshAuth();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
