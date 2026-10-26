const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(window.location.search);
const suppliedGameId = params.get('game');
const viewMode = params.get('view') === '1';
const viewerToken = params.get('token');
const requestedCommunityId = params.get('community');
const GAME_ID = /^[a-z0-9-]{3,64}$/.test(suppliedGameId || '') ? suppliedGameId : `poker-${crypto.randomUUID().slice(0, 12)}`;
// New games are created only after the user explicitly names them.
const STORAGE_KEY = `poker-cash-game-${GAME_ID}`;
const DEVICE_KEY = 'poker-cash-game-editor-device';
const DEVICE_ID = localStorage.getItem(DEVICE_KEY) || crypto.randomUUID();
localStorage.setItem(DEVICE_KEY, DEVICE_ID);
const db = window.supabase.createClient('https://jpcdbtaztovxmqruvktv.supabase.co', 'sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');
const SUPABASE_URL = 'https://jpcdbtaztovxmqruvktv.supabase.co';
const APP_URL = 'https://cooldikshant007-sudo.github.io/cabo_scorekeeper/poker/';

const defaultState = () => ({
  settings: { currency: 'INR', chipsPerBuyIn: 5000, buyInValue: 500 },
  players: [],
  finalChips: {},
  ownerId: DEVICE_ID,
  settingsLocked: false
});
let game = defaultState();
let hasLocalGameData = false;
let liveStateLoaded = false;
let activeTab = 'setup';
let accountUser = null;
let activeGame = null;
let legacyGame = false;
let accountReady = false;
let viewerPoll = null;
let accountCollapsed = true;

function makeId() { return crypto.randomUUID().slice(0, 12); }
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function setSyncStatus(message, state = '') { const status = $('#syncStatus'); status.textContent = message; status.className = `sync-status ${state}`; }
function isOwner() { return Boolean(liveStateLoaded && !viewMode && accountUser && activeGame?.owner_user_id === accountUser.id); }

function normaliseState(state) {
  const safe = state && typeof state === 'object' ? state : defaultState();
  const settings = { ...defaultState().settings, ...(safe.settings || {}) };
  settings.chipsPerBuyIn = Math.max(1, number(settings.chipsPerBuyIn, 5000));
  settings.buyInValue = Math.max(0, number(settings.buyInValue, 500));
  const sourcePlayers = Array.isArray(safe.players) ? safe.players : [];
  const players = sourcePlayers.map((player) => typeof player === 'string'
    ? { id: makeId(), name: player, initialChips: 0, buyIns: [] }
    : { id: player.id || makeId(), name: String(player.name || 'Player'), initialChips: Math.max(0, number(player.initialChips)), buyIns: Array.isArray(player.buyIns) ? player.buyIns.map((buyIn) => ({ id: buyIn.id || makeId(), chips: Math.max(0, number(buyIn.chips)) })) : [] });
  return {
    settings,
    players,
    finalChips: safe.finalChips && typeof safe.finalChips === 'object' ? safe.finalChips : {},
    ownerId: typeof safe.ownerId === 'string' ? safe.ownerId : '',
    settingsLocked: Boolean(safe.settingsLocked) || players.length >= 2
  };
}

async function saveGame() {
  if (!isOwner()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  const { error } = await db.from('poker_account_games').update({ state: game, updated_at: new Date().toISOString() }).eq('id', GAME_ID);
  if (error) { setSyncStatus('Could not save your table', 'error'); return; }
  await syncCommunityGame();
}

async function syncCommunityGame() {
  if (!isOwner() || !activeGame?.community_id) return;
  const completed = game.players.length > 0 && game.players.every(hasFinal);
  const { error } = await db.from('community_games').upsert({ source_game_id: GAME_ID, community_id: activeGame.community_id, game_type: 'poker', owner_user_id: accountUser.id, title: activeGame.title || pokerTitle(), state: game, completed, currency: game.settings.currency, updated_at: new Date().toISOString() }, { onConflict: 'source_game_id' });
  if (error) setSyncStatus('Saved, but could not update the community', 'error');
}

function pokerTitle() { const d = new Date(); return `poker_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function renderAccount() {
  const signedIn = Boolean(accountUser);
  $('#accountCard').hidden = viewMode || (signedIn && accountCollapsed);
  $('#accountToggle').hidden = viewMode || !signedIn;
  $('#accountToggle').textContent = accountCollapsed ? 'My tables' : 'Hide tables';
  $('#signedOut').hidden = signedIn;
  $('#signedIn').hidden = !signedIn;
  $('#signOut').hidden = !signedIn;
  $('#newRoom').hidden = viewMode;
  $('#accountEmail').textContent = accountUser?.email || '';
}
async function renderLibrary() {
  const list = $('#gameLibrary');
  if (!accountUser) { list.innerHTML = ''; return; }
  const { data, error } = await db.from('poker_account_games').select('id,title,updated_at,state,community_id').order('updated_at', { ascending: false }).limit(20);
  if (error) { list.innerHTML = '<p class="library-empty">Could not load your saved tables.</p>'; return; }
  if (!data?.length) { list.innerHTML = '<p class="library-empty">No saved tables yet. Start one whenever you are ready.</p>'; return; }
  list.innerHTML = data.map((saved) => {
    const count = Array.isArray(saved.state?.players) ? saved.state.players.length : 0;
    const updated = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(saved.updated_at));
    return `<article class="library-game"><button class="library-open" type="button" data-game-id="${saved.id}" data-community-id="${saved.community_id || ''}"><span><strong>${escapeHTML(saved.title)}</strong><small>${count} players · updated ${updated}</small></span><b>Open</b></button><button class="library-delete" type="button" data-delete-game-id="${saved.id}">Delete</button></article>`;
  }).join('');
}
async function deleteSavedGame(id) {
  if (!accountUser || !confirm('Delete this saved Poker table permanently? This cannot be undone.')) return;
  const { error } = await db.from('poker_account_games').delete().eq('id', id);
  if (error) { setSyncStatus('Could not delete this table', 'error'); return; }
  if (id === GAME_ID) { window.location.assign(window.location.pathname); return; }
  await renderLibrary();
}

function totalCashIn(player) { return player.initialChips + player.buyIns.reduce((total, buyIn) => total + buyIn.chips, 0); }
function buyInCount(player) { return 1 + player.buyIns.length; }
function hasFinal(player) { const value = game.finalChips[player.id]; return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function finalChips(player) { return number(game.finalChips[player.id]); }
function chipDelta(player) { return finalChips(player) - totalCashIn(player); }
function settlement(player) { return chipDelta(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn; }
function formatMoney(value) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: game.settings.currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${game.settings.currency} ${value.toFixed(2)}`; }
}

function updateStakeUI() {
  $('#currency').value = game.settings.currency;
  $('#chipsPerBuyIn').value = game.settings.chipsPerBuyIn;
  $('#buyInValue').value = game.settings.buyInValue;
  $('#initialBuyIns').value = 1;
  $('#extraBuyIns').value = 1;
  $('#buyInHint').textContent = `Each extra buy-in adds ${game.settings.chipsPerBuyIn.toLocaleString()} chips.`;
  $('#conversionHint').textContent = `${game.settings.chipsPerBuyIn.toLocaleString()} chips = ${formatMoney(game.settings.buyInValue)}.`;
  const locked = !isOwner() || game.settingsLocked;
  $('#settingsForm').querySelectorAll('input, select, button').forEach((element) => { element.disabled = locked; });
  if (game.settingsLocked) $('#conversionHint').textContent += ' Stakes are locked for this game.';
}

function renderPlayers() {
  const chips = $('#playerChips'); chips.innerHTML = '';
  game.players.forEach((player) => {
    const chip = $('#playerChipTemplate').content.cloneNode(true);
    chip.querySelector('.chip-name').textContent = `${player.name} · ${buyInCount(player)} buy-in${buyInCount(player) === 1 ? '' : 's'}`;
    chip.querySelector('button').onclick = () => {
      if (!isOwner()) return;
      if (!confirm(`Remove ${player.name} from this table?`)) return;
      game.players = game.players.filter((candidate) => candidate.id !== player.id);
      delete game.finalChips[player.id]; saveGame(); render();
    };
    chips.append(chip);
  });
  $('#setupHint').textContent = game.players.length < 2 ? 'Add at least 2 players to start tracking the table.' : `${game.players.length} players seated. You can add a late player at any time.`;
}

function renderStandings() {
  if (!isOwner()) {
    $('#standings').innerHTML = `<div class="viewer-player-grid">${game.players.map((player) => {
      const count = buyInCount(player);
      return `<article class="viewer-player-card"><span>${escapeHTML(player.name)}</span><strong>${formatMoney(totalCashIn(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn)}</strong><small>${count} buy-in${count === 1 ? '' : 's'}</small></article>`;
    }).join('')}</div>`;
    return;
  }
  $('#standings').innerHTML = `<div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Player</th><th>Buy-ins</th><th>Amount bought in (₹)</th></tr></thead><tbody>${game.players.map((player) => {
    const count = buyInCount(player);
    return `<tr><td>${escapeHTML(player.name)}</td><td>${count} buy-in${count === 1 ? '' : 's'}</td><td>${formatMoney(totalCashIn(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderBuyInOptions() {
  $('#buyInPlayer').innerHTML = game.players.map((player) => `<option value="${player.id}">${escapeHTML(player.name)}</option>`).join('');
}

function renderHistory() {
  if (!game.players.length) { $('#historyTable').innerHTML = '<p class="empty">No cash-ins recorded yet.</p>'; return; }
  const cards = game.players.map((player) => {
    const total = buyInCount(player);
    const choices = Array.from({ length: Math.max(10, total) }, (_, index) => index + 1)
      .map((value) => `<option value="${value}" ${value === total ? 'selected' : ''}>${value} buy-in${value === 1 ? '' : 's'}</option>`).join('');
    return `<article class="buyin-total-card"><span>${escapeHTML(player.name)}</span><label>Total buy-ins<select class="buyin-total-select" data-player-id="${player.id}" aria-label="Total buy-ins for ${escapeHTML(player.name)}">${choices}</select></label></article>`;
  }).join('');
  $('#historyTable').innerHTML = `<div class="buyin-total-grid">${cards}</div>`;
}

function renderCloseout() {
  $('#closeoutInputs').innerHTML = game.players.map((player) => `<div class="score-field"><label for="final-${player.id}">${escapeHTML(player.name)}</label><input id="final-${player.id}" type="number" min="0" step="1" inputmode="numeric" value="${hasFinal(player) ? finalChips(player) : ''}" placeholder="Final chips" required /></div>`).join('');
}

function renderSettlement() {
  const complete = game.players.length > 0 && game.players.every(hasFinal);
  if (!complete) return;
  const totalDifference = game.players.reduce((total, player) => total + chipDelta(player), 0);
  const rows = [...game.players].sort((a, b) => settlement(b) - settlement(a));
  $('#settlementList').innerHTML = rows.map((player) => {
    const value = settlement(player); const rank = rows.findIndex(p => Math.round(settlement(p)*100) === Math.round(value*100)) + 1; const label = value > 0 ? 'Collects' : value < 0 ? 'Pays' : 'Even';
    return `<article class="settlement-row ${value > 0 ? 'collect' : value < 0 ? 'pay' : ''}"><span>#${rank} · ${escapeHTML(player.name)}</span><strong>${label} ${formatMoney(Math.abs(value))}</strong><small>${formatMoney(finalChips(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn)} cash-out − ${formatMoney(totalCashIn(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn)} bought in</small></article>`;
  }).join('');
  const payments = paymentPlan();
  $('#paymentPlan').innerHTML = totalDifference === 0
    ? payments.length ? payments.map((payment) => `<article class="payment-row"><span><strong>${escapeHTML(payment.from.name)}</strong> pays <strong>${escapeHTML(payment.to.name)}</strong></span><b>${formatMoney(payment.amount)}</b></article>`).join('') : '<p class="empty">Everyone is even — no payments are needed.</p>'
    : '<p class="empty">Enter balanced final chip counts to calculate payments.</p>';
  $('#settlementCheck').textContent = totalDifference === 0 ? '✓ Final chip counts balance with all recorded buy-ins.' : `Check the count: final stacks are ${Math.abs(totalDifference).toLocaleString()} chips ${totalDifference > 0 ? 'over' : 'under'} recorded buy-ins.`;
}

function showTab(tab) {
  const button = document.querySelector(`[data-tab="${tab}"]`);
  if (!button || button.hidden || button.disabled || (!isOwner() && tab !== 'results')) {
    activeTab = '';
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove('is-active');
    });
    document.querySelectorAll('.tab-button').forEach((tabButton) => {
      tabButton.classList.remove('is-active');
      tabButton.setAttribute('aria-selected', 'false');
    });
    return;
  }
  activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const selected = panel.dataset.panel === activeTab;
    panel.hidden = !selected;
    panel.classList.toggle('is-active', selected);
  });
  document.querySelectorAll('.tab-button').forEach((tabButton) => {
    const selected = tabButton.dataset.tab === activeTab;
    tabButton.classList.toggle('is-active', selected);
    tabButton.setAttribute('aria-selected', String(selected));
  });
}

function renderTabs(ready) {
  const complete = game.players.length > 0 && game.players.every(hasFinal);
  $('#resultsTab').hidden = !complete;
  $('#overviewEmpty').hidden = ready;
  document.querySelectorAll('[data-requires-game]').forEach((button) => { button.disabled = !ready; });
  $('#tabBar').hidden = !isOwner() && !complete;
  if (!isOwner()) activeTab = complete ? 'results' : '';
  if (isOwner() && !activeTab) activeTab = 'setup';
  if (isOwner() && !complete && activeTab === 'results') activeTab = 'setup';
  if (isOwner() && !ready && ['buyins', 'closeout'].includes(activeTab)) activeTab = 'seat';
  showTab(activeTab);
}

function paymentPlan() {
  const debtors = game.players.filter((player) => settlement(player) < -0.005).map((player) => ({ player, amount: -settlement(player) }));
  const creditors = game.players.filter((player) => settlement(player) > 0.005).map((player) => ({ player, amount: settlement(player) }));
  const payments = []; let debtor = 0; let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    payments.push({ from: debtors[debtor].player, to: creditors[creditor].player, amount });
    debtors[debtor].amount -= amount; creditors[creditor].amount -= amount;
    if (debtors[debtor].amount < 0.005) debtor += 1;
    if (creditors[creditor].amount < 0.005) creditor += 1;
  }
  return payments;
}

function render() {
  renderAccount();
  updateStakeUI(); renderPlayers();
  document.body.classList.toggle('viewer-mode', !isOwner());
  $('#accessBanner').textContent = isOwner() ? (game.settingsLocked ? 'Saved to your account · stakes are locked.' : 'Saved to your account · set stakes before the game starts.') : legacyGame ? 'Legacy table · sign in to import and save it.' : 'Live viewer access · updates appear automatically.';
  $('#claimEditor').hidden = !legacyGame || !accountUser || viewMode;
  $('#totalPlayers').textContent = game.players.length.toLocaleString();
  $('#totalChips').textContent = formatMoney(game.players.reduce((total, player) => total + totalCashIn(player), 0) * game.settings.buyInValue / game.settings.chipsPerBuyIn);
  $('#totalBuyIns').textContent = game.players.reduce((total, player) => total + buyInCount(player), 0).toLocaleString();
  const ready = game.players.length >= 2;
  $('#toggleGameInfo').hidden = !ready;
  document.body.classList.toggle('game-active', ready);
  $('#gameArea').hidden = !ready;
  if (ready) { renderStandings(); renderBuyInOptions(); renderHistory(); renderCloseout(); }
  renderSettlement();
  renderTabs(ready);
}

function addPlayer(rawName, initialBuyIns) {
  const baseName = rawName.trim().replace(/-\d+$/, '');
  const matches = game.players.filter((player) => player.name.replace(/-\d+$/, '').toLowerCase() === baseName.toLowerCase());
  const buyIns = Array.from({ length: initialBuyIns - 1 }, () => ({ id: makeId(), chips: game.settings.chipsPerBuyIn }));
  if (matches.length) {
    matches.forEach((player) => { if (!/-\d+$/.test(player.name)) player.name = `${player.name}-1`; });
    const used = new Set(matches.map((player) => number(player.name.match(/-(\d+)$/)?.[1], 1)));
    let suffix = 1; while (used.has(suffix)) suffix += 1;
    game.players.push({ id: makeId(), name: `${baseName}-${suffix}`, initialChips: game.settings.chipsPerBuyIn, buyIns });
  } else game.players.push({ id: makeId(), name: baseName, initialChips: game.settings.chipsPerBuyIn, buyIns });
}

$('#copyLink').onclick = async () => {
  if (!isOwner() || !activeGame?.viewer_token) return;
  const viewer = new URL(window.location.href); viewer.searchParams.set('view', '1'); viewer.searchParams.set('token', activeGame.viewer_token);
  const viewerLink = viewer.href;
  try { await navigator.clipboard.writeText(viewerLink); $('#copyLink').textContent = 'Viewer link copied!'; setTimeout(() => { $('#copyLink').textContent = 'Copy link'; }, 1600); }
  catch { $('#copyLink').textContent = 'Copy unavailable'; }
};
function shareUpdateText() {
  const lines = [
    '♠ Poker cash game update',
    `Players: ${game.players.length}  |  Money in play: ${formatMoney(game.players.reduce((total, player) => total + totalCashIn(player), 0) * game.settings.buyInValue / game.settings.chipsPerBuyIn)}  |  Buy-ins: ${game.players.reduce((total, player) => total + buyInCount(player), 0)}`,
    '',
    'Player buy-ins:'
  ];
  game.players.forEach((player) => lines.push(`• ${player.name}: total buy-in: ${formatMoney(totalCashIn(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn)} (${buyInCount(player)} buy-ins)`));
  return lines.join('\n');
}
$('#copyUpdateText').onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUpdateText());
    $('#copyUpdateText').textContent = 'Update copied!';
    setTimeout(() => { $('#copyUpdateText').textContent = 'Copy update text'; }, 1600);
  } catch { $('#copyUpdateText').textContent = 'Copy unavailable'; }
};
$('#newRoom').onclick = startNamedPokerGame;
$('#backCommunity').onclick = () => {
  window.location.assign(location.protocol === 'file:' ? '../community-hub/index.html' : '../community/');
};
$('#accountToggle').onclick = () => { accountCollapsed = !accountCollapsed; document.body.classList.toggle('account-open', !accountCollapsed); renderAccount(); };
$('#toggleGameInfo').onclick = () => { document.body.classList.toggle('info-open'); $('#toggleGameInfo').textContent = document.body.classList.contains('info-open') ? 'Hide game info' : 'Game info'; };
$('#claimEditor').onclick = () => { if (legacyGame && accountUser && !viewMode) createAccountGame(game); };
document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));

$('#settingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isOwner() || game.settingsLocked) return;
  game.settings = { currency: $('#currency').value, chipsPerBuyIn: Math.max(1, number($('#chipsPerBuyIn').value, 5000)), buyInValue: Math.max(0, number($('#buyInValue').value, 500)) };
  saveGame(); render();
});
$('#playerForm').addEventListener('submit', (event) => {
  event.preventDefault(); const name = $('#playerName').value.trim(); const initialBuyIns = Math.floor(Math.max(1, number($('#initialBuyIns').value, 1)));
  if (!isOwner()) return;
  if (!name) return; addPlayer(name, initialBuyIns); if (game.players.length >= 2) game.settingsLocked = true; $('#playerName').value = ''; saveGame(); render(); $('#playerName').focus();
});
$('#buyInForm').addEventListener('submit', (event) => {
  event.preventDefault(); const player = game.players.find((candidate) => candidate.id === $('#buyInPlayer').value); const extraBuyIns = Math.floor(Math.max(0, number($('#extraBuyIns').value)));
  if (!isOwner()) return;
  if (!player || extraBuyIns <= 0) return;
  for (let count = 0; count < extraBuyIns; count += 1) player.buyIns.push({ id: makeId(), chips: game.settings.chipsPerBuyIn });
  saveGame(); render();
});
$('#historyTable').addEventListener('change', (event) => {
  const target = event.target.closest('.buyin-total-select'); if (!target) return;
  if (!isOwner()) return;
  const player = game.players.find((candidate) => candidate.id === target.dataset.playerId); if (!player) return;
  const total = Math.max(1, Math.floor(number(target.value, 1)));
  player.initialChips = game.settings.chipsPerBuyIn;
  player.buyIns = Array.from({ length: total - 1 }, () => ({ id: makeId(), chips: game.settings.chipsPerBuyIn }));
  saveGame(); render();
});
$('#closeoutForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isOwner()) return;
  for (const player of game.players) { const value = Number($(`#final-${player.id}`).value); if (!Number.isFinite(value) || value < 0) return; game.finalChips[player.id] = value; }
  saveGame(); render();
});
$('#newGame').onclick = startNamedPokerGame;

function loadGame() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved) { game = normaliseState(saved); hasLocalGameData = true; } }
  catch { localStorage.removeItem(STORAGE_KEY); }
}
function stopLiveConnections() { db.removeAllChannels(); if (viewerPoll) { clearInterval(viewerPoll); viewerPoll = null; } }
async function createAccountGame(initialState = game) {
  if (!accountUser) return;
  const state = normaliseState(initialState); state.ownerId = DEVICE_ID;
  const { data, error } = await db.from('poker_account_games').insert({ id: GAME_ID, owner_user_id: accountUser.id, title: pokerTitle(), state, community_id: requestedCommunityId || null }).select('id,owner_user_id,title,state,viewer_token,community_id,updated_at').single();
  if (error) { setSyncStatus(error.code === '23505' ? 'This table belongs to another account' : 'Could not save your new table', 'error'); return; }
  activeGame = data; legacyGame = false; game = normaliseState(data.state); liveStateLoaded = true; subscribeOwner(); await syncCommunityGame(); setSyncStatus('Saved to your account', 'live'); render(); renderLibrary();
}
function subscribeOwner() {
  if (!isOwner()) return;
  db.channel(`poker-account-${GAME_ID}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'poker_account_games', filter: `id=eq.${GAME_ID}` }, ({ new: row }) => { activeGame = row; game = normaliseState(row.state); render(); renderLibrary(); }).subscribe();
}
async function fetchViewerGame() {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/poker-viewer-game?game=${encodeURIComponent(GAME_ID)}&token=${encodeURIComponent(viewerToken || '')}`);
  if (!response.ok) { setSyncStatus('Viewer link is invalid or expired', 'error'); return; }
  const data = await response.json(); activeGame = data; game = normaliseState(data.state); legacyGame = false; liveStateLoaded = true; setSyncStatus('Live viewer connected', 'live'); render();
}
async function connectGame() {
  stopLiveConnections();
  if (viewMode && viewerToken) { await fetchViewerGame(); viewerPoll = setInterval(fetchViewerGame, 4000); return; }
  if (accountUser) {
    const { data, error } = await db.from('poker_account_games').select('id,owner_user_id,title,state,viewer_token,community_id,updated_at').eq('id', GAME_ID).maybeSingle();
    if (error) { setSyncStatus('Could not load your saved table', 'error'); return; }
    if (data) { activeGame = data; legacyGame = false; game = normaliseState(data.state); liveStateLoaded = true; subscribeOwner(); setSyncStatus('Saved to your account', 'live'); await syncCommunityGame(); render(); return; }
    if (!suppliedGameId) { activeGame = null; game = defaultState(); liveStateLoaded = false; setSyncStatus('Select Start a new game to begin'); render(); return; }
    const legacy = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
    if (legacy.data?.state && !viewMode) { activeGame = null; legacyGame = true; game = normaliseState(legacy.data.state); liveStateLoaded = true; setSyncStatus('Legacy table loaded. Select Set up this table to save it to your account.'); render(); return; }
    setSyncStatus('This table belongs to another account. Use its viewer link.', 'error'); liveStateLoaded = false; render(); return;
  }
  if (suppliedGameId) {
    const legacy = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
    if (legacy.data?.state) { game = normaliseState(legacy.data.state); legacyGame = true; liveStateLoaded = true; setSyncStatus('Legacy table loaded', 'live'); render(); return; }
  }
  activeGame = null; game = defaultState(); liveStateLoaded = false; setSyncStatus('Sign in to create and save a table'); render();
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
  const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: APP_URL } });
  $('#authMessage').textContent = error ? error.message : data.session ? 'Account created and signed in.' : 'Account created. Confirm your email once, then sign in with your password.';
};
$('#signOut').onclick = async () => { await db.auth.signOut(); accountUser = null; activeGame = null; await refreshAuth(); };
let creatingGame = false;
function startNamedPokerGame() {
  if (viewMode) return;
  if (!accountUser) {
    accountCollapsed = false;
    document.body.classList.add('account-open');
    $('#accountCard').hidden = false;
    $('#authMessage').textContent = 'Sign in to start a new game. Your existing game will stay saved.';
    $('#emailInput').focus();
    return;
  }
  $('#newGameName').value = pokerTitle();
  $('#newGameError').textContent = '';
  $('#newGameDialog').showModal();
  $('#newGameName').focus();
  $('#newGameName').select();
}
$('#cancelNewGame').onclick = () => $('#newGameDialog').close();
$('#newGameDialog').addEventListener('cancel', (event) => { if (creatingGame) event.preventDefault(); });
$('#newGameForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (creatingGame) return;
  const title = $('#newGameName').value.trim();
  if (!title) { $('#newGameError').textContent = 'Please enter a game name.'; return; }
  if (!accountUser || viewMode) { $('#newGameError').textContent = 'Sign in again before creating a game.'; return; }
  creatingGame = true;
  $('#createNewGame').disabled = true;
  $('#cancelNewGame').disabled = true;
  $('#createNewGame').textContent = 'Creating…';
  $('#newGameError').textContent = '';
  try {
    const id = `poker-${crypto.randomUUID()}`;
    let communityId = activeGame?.community_id || requestedCommunityId || null;
    if (!communityId) {
      const { data: choices, error: communityError } = await db.from('communities').select('id');
      if (communityError) throw communityError;
      if (choices?.length === 1) communityId = choices[0].id;
    }
    const { error } = await db.from('poker_account_games').insert({
      id, owner_user_id: accountUser.id, title,
      state: defaultState(),
      community_id: communityId
    });
    if (error) throw error;
    const destination = new URL(window.location.pathname, window.location.origin);
    destination.searchParams.set('game', id);
    if (communityId) destination.searchParams.set('community', communityId);
    window.location.assign(destination.href);
  } catch (error) {
    $('#newGameError').textContent = `Could not create your game. ${error.message || 'Check your connection and try again.'}`;
  } finally {
    creatingGame = false;
    $('#createNewGame').disabled = false;
    $('#cancelNewGame').disabled = false;
    $('#createNewGame').textContent = 'Create game';
  }
});
$('#startSavedGame').onclick = startNamedPokerGame;
$('#gameLibrary').addEventListener('click', (event) => { const remove = event.target.closest('[data-delete-game-id]'); if (remove) { deleteSavedGame(remove.dataset.deleteGameId); return; } const button = event.target.closest('[data-game-id]'); if (button) window.location.assign(`${window.location.pathname}?game=${button.dataset.gameId}${button.dataset.communityId ? `&community=${encodeURIComponent(button.dataset.communityId)}` : ''}`); });
db.auth.onAuthStateChange((_event, session) => { if (!accountReady) return; accountUser = session?.user || null; renderAccount(); renderLibrary(); connectGame(); });

loadGame(); render(); refreshAuth();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));

// Activate installed-app updates without waiting for every old tab to close.
if ('serviceWorker' in navigator) {
  let refreshingApp = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingApp) return;
    refreshingApp = true;
    window.location.reload();
  });
  navigator.serviceWorker.ready.then(registration => registration.update()).catch(() => {});
}
