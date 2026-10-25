// Run with Node and Playwright installed: node tests/new-game.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const oldId = 'cabo-5e2da7ae-4d3';
const original = { id: oldId, owner_user_id: 'owner', title: 'Existing game', state: { players: ['Alice', 'Bob'], rounds: [[5, 9]], started: true }, community_id: null, updated_at: new Date().toISOString() };
async function setup(browser, { signedIn = true, legacy = false, before = false, viewport } = {}) {
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
    if (url.hostname !== 'cabo.test') return route.fulfill({ body: '', contentType: 'application/javascript' });
    const name = url.pathname.split('/').pop() || 'index.html';
    const body = before && ['app.js','index.html','styles.css'].includes(name)
      ? execFileSync('git', ['show', `b0917d0:${name}`], { cwd: root })
      : fs.readFileSync(path.join(root, name));
    route.fulfill({ body, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://cabo.test/?game=${oldId}`);
  await page.waitForFunction(() => document.querySelector('#syncStatus').textContent !== 'Connecting to the live game…');
  return { page, context, errors };
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    if (process.env.REPRO_BEFORE) {
      const { page, context } = await setup(browser, { before: true, signedIn: false, legacy: true });
      assert.equal(await page.locator('#newRoom').isVisible(), false);
      assert.equal(await page.locator('#startSavedGame').isVisible(), false);
      assert.equal(await page.locator('#newGame').isVisible(), false);
      console.log('REPRODUCED: existing legacy URL signed out has no visible new-game action.');
      await context.close();
      const signed = await setup(browser, { before: true });
      let promptSeen = false;
      signed.page.on('dialog', async dialog => { promptSeen = true; await dialog.dismiss(); });
      await signed.page.locator('#newGame').click();
      assert(promptSeen);
      assert.deepEqual(await signed.page.evaluate(() => testWrites), []);
      console.log('REPRODUCED: owner flow depends on a native browser prompt; dismissal creates nothing.');
      await signed.context.close();
      return;
    }
    const { page, context, errors } = await setup(browser, { viewport: { width: 390, height: 844 } });
    assert.deepEqual(await page.evaluate(() => testWrites), []);
    assert(await page.locator('#newRoom').isVisible());
    await page.locator('#newRoom').click();
    const expected = await page.evaluate(() => { const d = new Date(); return `cabo_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
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
    await page.waitForFunction(() => document.querySelector('#currentGameName').textContent === 'Friday Cabo');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rows')));
    assert.deepEqual(stored[oldId], original);
    const newId = new URL(page.url()).searchParams.get('game');
    assert.deepEqual(stored[newId].state, { players: [], rounds: [], started: false, completed: false });
    assert.equal(Object.keys(stored).length, 2);
    assert(await page.locator('#setupCard').isVisible());
    assert.equal(await page.locator('#gameArea').isVisible(), false);
    await page.goto(`https://cabo.test/?game=${oldId}`);
    await page.waitForFunction(() => document.querySelector('#currentGameName').textContent === 'Existing game');
    assert.match(await page.locator('#historyTable').textContent(), /5.*9/s);
    assert.deepEqual(errors, []);
    console.log('PASS: mobile owner creation, date, cancel, validation, API/network errors, double-submit guard, new URL, empty setup, preserved existing game/history.');
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
    await home.page.goto('https://cabo.test/');
    await home.page.waitForFunction(() => document.querySelector('#syncStatus').textContent.includes('Select Start'));
    assert.deepEqual(await home.page.evaluate(() => testWrites), []);
    assert.equal(new URL(home.page.url()).search, '');
    await home.context.close();
    const viewer = await setup(browser);
    await viewer.page.goto(`https://cabo.test/?game=${oldId}&view=1`);
    await viewer.page.waitForFunction(() => document.querySelector('#newRoom').hidden);
    assert.deepEqual(await viewer.page.evaluate(() => testWrites), []);
    await viewer.context.close();
    console.log('PASS: signed-out guidance, legacy and home opening cause no inserts, viewer creation hidden.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
