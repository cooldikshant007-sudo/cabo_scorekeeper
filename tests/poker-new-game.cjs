// Run with Node and Playwright installed: node tests/new-game.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../poker');
const oldId = 'poker-5e2da7ae-4d3';
const original = { id: oldId, owner_user_id: 'owner', title: 'Existing table', state: { settings: { currency: 'INR', chipsPerBuyIn: 5000, buyInValue: 500 }, players: [{ id: 'alice', name: 'Alice', initialChips: 5000, buyIns: [{ id: 'buyin1', chips: 5000 }] }, { id: 'bob', name: 'Bob', initialChips: 5000, buyIns: [] }], finalChips: { alice: 8000, bob: 7000 }, settingsLocked: true }, community_id: null, updated_at: new Date().toISOString() };
async function setup(browser, { signedIn = true, legacy = false, viewport } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport });
  await context.addInitScript(({ signedIn, legacy, original }) => {
    window.testWrites = [];
    window.testFail = false;
    window.testThrow = false;
    const rows = JSON.parse(localStorage.getItem('rows') || 'null') || (legacy ? {} : { [original.id]: original });
    const db = {
      auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: 'owner', email: 'test@example.com' } } : null } }), onAuthStateChange: () => {} },
      removeAllChannels: () => {}, channel: () => ({ on() { return this; }, subscribe() {} }),
      from(table) {
        const query = { action: 'select', filters: {}, select() { return this; }, order() { return this; }, limit() { return this; }, eq(k,v) { this.filters[k] = v; return this; }, insert(row) { this.action = 'insert'; this.row = row; return this; }, update(row) { this.action = 'update'; this.row = row; return this; }, async run(single) {
          if (this.action !== 'select') {
            window.testWrites.push({ table, action: this.action, row: this.row });
            await new Promise(resolve => setTimeout(resolve, 100));
            if (window.testThrow) throw new Error('Network unavailable');
            if (window.testFail) return { error: { message: 'Test permission error' } };
            rows[this.row.id] = { ...this.row, updated_at: new Date().toISOString() };
            localStorage.setItem('rows', JSON.stringify(rows));
            return { data: rows[this.row.id], error: null };
          }
          if (table === 'cabo_games') return { data: legacy ? { state: original.state } : null };
          if (table === 'communities') return { data: [] };
          const data = this.filters.id ? rows[this.filters.id] || null : Object.values(rows);
          return { data, error: null };
        }, maybeSingle() { return this.run(true); }, single() { return this.run(true); }, then(resolve, reject) { return this.run().then(resolve, reject); } };
        return query;
      }
    };
    window.supabase = { createClient: () => db };
  }, { signedIn, legacy, original });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'poker.test') return route.fulfill({ body: '', contentType: 'application/javascript' });
    const name = url.pathname.split('/').pop() || 'index.html';
    const body = fs.readFileSync(path.join(root, name));
    route.fulfill({ body, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://poker.test/?game=${oldId}`);
  await page.waitForFunction(() => !document.querySelector('#syncStatus').textContent.startsWith('Connecting'));
  return { page, context, errors };
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const { page, context, errors } = await setup(browser, { viewport: { width: 390, height: 844 } });
    assert.deepEqual(await page.evaluate(() => testWrites), []);
    assert(await page.locator('#newRoom').isVisible());
    await page.locator('#newRoom').click();
    const expected = await page.evaluate(() => { const d = new Date(); return `poker_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    assert.equal(await page.locator('#newGameName').inputValue(), expected);
    await page.locator('#cancelNewGame').click();
    assert.deepEqual(await page.evaluate(() => testWrites), []);
    assert(page.url().includes(oldId));
    await page.locator('#newGame').click();
    await page.locator('#newGameName').fill('   ');
    await page.locator('#createNewGame').click();
    assert.match(await page.locator('#newGameError').textContent(), /enter a game name/);
    assert.deepEqual(await page.evaluate(() => testWrites), []);
    await page.locator('#newGameName').fill('Friday Cabo');
    await page.evaluate(() => { testFail = true; });
    await page.locator('#createNewGame').click();
    await page.waitForFunction(() => document.querySelector('#newGameError').textContent.includes('Test permission error'));
    assert(page.url().includes(oldId));
    assert.equal(await page.locator('#newGameName').inputValue(), 'Friday Cabo');
    await page.evaluate(() => { testFail = false; testThrow = true; });
    await page.locator('#createNewGame').click();
    await page.waitForFunction(() => document.querySelector('#newGameError').textContent.includes('Network unavailable'));
    await page.evaluate(() => { testThrow = false; testWrites.length = 0; });
    // Two synchronous submissions must produce one insert.
    await page.evaluate(() => { const form = document.querySelector('#newGameForm'); form.requestSubmit(); form.dispatchEvent(new Event('submit', { cancelable: true })); });
    await page.waitForURL(url => url.searchParams.get('game') !== oldId);
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Saved to your account');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rows')));
    assert.deepEqual(stored[oldId], original);
    const newId = new URL(page.url()).searchParams.get('game');
    assert.deepEqual(stored[newId].state.players, []);
    assert.deepEqual(stored[newId].state.finalChips, {});
    assert.equal(stored[newId].state.settingsLocked, false);
    assert.deepEqual(stored[newId].state.settings, { currency: 'INR', chipsPerBuyIn: 5000, buyInValue: 500 });
    assert.equal(Object.keys(stored).length, 2);
    assert(await page.locator('[data-panel=setup]').isVisible());
    assert.equal(await page.locator('#gameArea').isVisible(), false);
    await page.goto(`https://poker.test/?game=${oldId}`);
    await page.waitForFunction(() => document.querySelector('#syncStatus').textContent === 'Saved to your account');
    assert.match(await page.locator('#standings').textContent(), /Alice.*10,000.*Bob.*5,000/s);
    assert.equal(await page.locator('[data-player-id=alice]').inputValue(), '2');
    assert.equal(await page.locator('#final-alice').inputValue(), '8000');
    assert.deepEqual(errors, []);
    console.log('PASS: mobile owner creation, date, cancel, validation, API/network errors, double-submit guard, new URL, empty setup, preserved existing table/buy-ins/results.');
    await context.close();
    const guest = await setup(browser, { signedIn: false, legacy: true });
    assert(await guest.page.locator('#newRoom').isVisible());
    await guest.page.locator('#newRoom').click();
    assert(await guest.page.locator('#accountCard').isVisible());
    assert.match(await guest.page.locator('#authMessage').textContent(), /Sign in/);
    assert.deepEqual(await guest.page.evaluate(() => testWrites), []);
    await guest.context.close();
    const legacy = await setup(browser, { legacy: true });
    assert.deepEqual(await legacy.page.evaluate(() => testWrites), []);
    assert(await legacy.page.locator('#claimEditor').isVisible());
    await legacy.context.close();
    const home = await setup(browser);
    await home.page.goto('https://poker.test/');
    await home.page.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('Select Start'));
    assert.deepEqual(await home.page.evaluate(() => testWrites), []);
    assert.equal(new URL(home.page.url()).search, '');
    await home.context.close();
    const viewer = await setup(browser);
    await viewer.page.goto(`https://poker.test/?game=${oldId}&view=1`);
    await viewer.page.waitForFunction(() => document.querySelector('#newRoom').hidden);
    assert.deepEqual(await viewer.page.evaluate(() => testWrites), []);
    await viewer.context.close();
    console.log('PASS: signed-out guidance, legacy and home opening cause no inserts, viewer creation hidden.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
