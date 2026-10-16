const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(window.location.search);
const suppliedGameId = params.get('game');
const GAME_ID = /^[a-z0-9-]{3,64}$/.test(suppliedGameId || '') ? suppliedGameId : `poker-${crypto.randomUUID().slice(0, 12)}`;
if (!suppliedGameId) window.history.replaceState({}, '', `${window.location.pathname}?game=${GAME_ID}`);
const STORAGE_KEY = `poker-cash-game-${GAME_ID}`;
const DEVICE_KEY = 'poker-cash-game-editor-device';
const DEVICE_ID = localStorage.getItem(DEVICE_KEY) || crypto.randomUUID();
localStorage.setItem(DEVICE_KEY, DEVICE_ID);
const db = window.supabase.createClient('https://jpcdbtaztovxmqruvktv.supabase.co', 'sb_publishable_y7nZtPY1snx7_GSAExxhLw_j9xaOoxy');

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

function makeId() { return crypto.randomUUID().slice(0, 12); }
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function escapeHTML(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function setSyncStatus(message, state = '') { const status = $('#syncStatus'); status.textContent = message; status.className = `sync-status ${state}`; }
function isOwner() { return liveStateLoaded && game.ownerId === DEVICE_ID; }

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

function saveGame() {
  if (!isOwner()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  db.from('cabo_games').update({ state: game, updated_at: new Date().toISOString() }).eq('id', GAME_ID)
    .then(({ error }) => { if (error) setSyncStatus('Could not save live update', 'error'); });
}

function totalCashIn(player) { return player.initialChips + player.buyIns.reduce((total, buyIn) => total + buyIn.chips, 0); }
function buyInCount(player) { return 1 + player.buyIns.length; }
function hasFinal(player) { return Number.isFinite(Number(game.finalChips[player.id])); }
function finalChips(player) { return number(game.finalChips[player.id]); }
function chipDelta(player) { return finalChips(player) - totalCashIn(player); }
function settlement(player) { return chipDelta(player) * game.settings.buyInValue / game.settings.chipsPerBuyIn; }
function formatMoney(value) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: game.settings.currency, maximumFractionDigits: 2 }).format(value); }
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
      return `<article class="viewer-player-card"><span>${escapeHTML(player.name)}</span><strong>${count}</strong><small>buy-in${count === 1 ? '' : 's'}</small></article>`;
    }).join('')}</div>`;
    return;
  }
  $('#standings').innerHTML = `<div class="overview-table-wrap"><table class="overview-table"><thead><tr><th>Player</th><th>Buy-ins</th><th>Chips bought in</th></tr></thead><tbody>${game.players.map((player) => {
    const count = buyInCount(player);
    return `<tr><td>${escapeHTML(player.name)}</td><td>${count} buy-in${count === 1 ? '' : 's'}</td><td>${totalCashIn(player).toLocaleString()}</td></tr>`;
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
    const value = settlement(player); const label = value > 0 ? 'Collects' : value < 0 ? 'Pays' : 'Even';
    return `<article class="settlement-row ${value > 0 ? 'collect' : value < 0 ? 'pay' : ''}"><span>${escapeHTML(player.name)}</span><strong>${label} ${formatMoney(Math.abs(value))}</strong><small>${finalChips(player).toLocaleString()} final − ${totalCashIn(player).toLocaleString()} bought in</small></article>`;
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
  if (isOwner() && !complete && activeTab === 'results') activeTab = 'setup';
  if (isOwner() && !ready && ['buyins', 'closeout'].includes(activeTab)) activeTab = 'setup';
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
  updateStakeUI(); renderPlayers();
  document.body.classList.toggle('viewer-mode', !isOwner());
  $('#accessBanner').textContent = isOwner() ? (game.settingsLocked ? 'Editor access · stakes are locked.' : 'Editor access · set stakes before the game starts.') : 'Live viewer access · score updates appear automatically.';
  const canClaimEmptyTable = liveStateLoaded && !isOwner() && game.players.length === 0 && Object.keys(game.finalChips || {}).length === 0 && !game.settingsLocked;
  $('#claimEditor').hidden = !canClaimEmptyTable;
  $('#totalPlayers').textContent = game.players.length.toLocaleString();
  $('#totalChips').textContent = game.players.reduce((total, player) => total + totalCashIn(player), 0).toLocaleString();
  $('#totalBuyIns').textContent = game.players.reduce((total, player) => total + buyInCount(player), 0).toLocaleString();
  const ready = game.players.length >= 2;
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
  const viewerLink = `${window.location.origin}${window.location.pathname}?game=${GAME_ID}`;
  try { await navigator.clipboard.writeText(viewerLink); $('#copyLink').textContent = 'Viewer link copied!'; setTimeout(() => { $('#copyLink').textContent = 'Copy link'; }, 1600); }
  catch { $('#copyLink').textContent = 'Copy unavailable'; }
};
function shareUpdateText() {
  const lines = [
    '♠ Poker cash game update',
    `Players: ${game.players.length}  |  Chips in play: ${game.players.reduce((total, player) => total + totalCashIn(player), 0).toLocaleString()}  |  Buy-ins: ${game.players.reduce((total, player) => total + buyInCount(player), 0)}`,
    '',
    'Player buy-ins:'
  ];
  game.players.forEach((player) => lines.push(`• ${player.name}: total buy in: ${buyInCount(player)}`));
  return lines.join('\n');
}
$('#copyUpdateText').onclick = async () => {
  try {
    await navigator.clipboard.writeText(shareUpdateText());
    $('#copyUpdateText').textContent = 'Update copied!';
    setTimeout(() => { $('#copyUpdateText').textContent = 'Copy update text'; }, 1600);
  } catch { $('#copyUpdateText').textContent = 'Copy unavailable'; }
};
$('#newRoom').onclick = () => { window.location.assign(`${window.location.pathname}?game=poker-${crypto.randomUUID().slice(0, 12)}`); };
$('#claimEditor').onclick = () => {
  const isEmptyTable = game.players.length === 0 && Object.keys(game.finalChips || {}).length === 0 && !game.settingsLocked;
  if (isOwner() || !isEmptyTable) return;
  game.ownerId = DEVICE_ID;
  saveGame(); render();
};
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
$('#newGame').onclick = () => { if (!isOwner()) return; if (confirm('Clear this table and all its recorded data?')) { game = defaultState(); localStorage.removeItem(STORAGE_KEY); saveGame(); render(); } };

function loadGame() {
  try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved) { game = normaliseState(saved); hasLocalGameData = true; } }
  catch { localStorage.removeItem(STORAGE_KEY); }
}
async function connectSharedGame() {
  let { data, error } = await db.from('cabo_games').select('state').eq('id', GAME_ID).maybeSingle();
  if (!data && !error) {
    const created = await db.from('cabo_games').insert({ id: GAME_ID, state: defaultState() }).select('state').single(); data = created.data; error = created.error;
    if (error?.code === '23505') ({ data, error } = await db.from('cabo_games').select('state').eq('id', GAME_ID).single());
  }
  if (error) { setSyncStatus('Live sync unavailable', 'error'); return; }
  game = normaliseState(data.state);
  const claimingExistingGame = !game.ownerId && (hasLocalGameData || !suppliedGameId);
  if (claimingExistingGame) game.ownerId = DEVICE_ID;
  liveStateLoaded = true;
  if (claimingExistingGame) saveGame();
  setSyncStatus('Live table connected', 'live'); render();
  db.channel(`poker-live-${GAME_ID}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cabo_games', filter: `id=eq.${GAME_ID}` }, ({ new: row }) => { game = normaliseState(row.state); render(); })
    .subscribe((status) => { if (status === 'SUBSCRIBED') setSyncStatus('Live table connected', 'live'); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('Live sync reconnecting…', 'error'); });
}

loadGame(); render(); connectSharedGame();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
