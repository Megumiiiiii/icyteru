// Run from repo root: NODE_PATH=<playwright node_modules> node --test tests/queue-pill.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const { chromium } = require('playwright')

// Execute each host's actual snapshot builder with controlled client state. Neither
// loading Electron main nor installing a native Capacitor plugin is required.
for (const host of ['electron/main.ts', 'src/web/host.ts']) {
  test(`${host} forwards queued entries and subsequent cleanup`, async () => {
    const source = ts.createSourceFile(host, await fs.readFile(host, 'utf8'), ts.ScriptTarget.Latest, true)
    const builder = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'snapshot')
    const { outputText } = ts.transpileModule(builder.getText(source), {})
    const client = { state: { side: { models: {}, memory: {} }, queued: ['menu', 'slash'].map(id => ({
      id, sessionId: 'test-session', text: id, createdAt: 0, status: 'queued'
    })) } }
    const snapshot = Function('client', 'emptySnapshot', `let authMode, screen, phase, error, status;
      function connectionInfo() { return {} } ${outputText}; return snapshot`) (client, () => ({ queued: [] }))
    assert.deepEqual(snapshot().queued, client.state.queued)
    client.state.queued = []
    assert.deepEqual(snapshot().queued, [])
  })
}

test('queue pill in Chromium (production renderer and client)', async t => {
  const { createServer } = await import('vite')
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'icyteru-queue-vite-'))
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }))
  const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [{ name: 'test-entry', enforce: 'pre', transformIndexHtml: { order: 'pre', handler: html =>
      html.replace('/src/main.tsx', '/tests/queue-pill.fixture.js') } }] })
  try {
    await server.listen()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
      const draft = page.locator('.composer textarea')
      const pill = n => page.getByRole('button', { name: `${n} queued`, exact: true })
      await draft.waitFor()
      assert.equal(await page.locator('.queue-pill').count(), 0)
      await draft.fill('From the busy menu')
      await draft.press('Enter')
      await page.getByRole('menu').getByRole('button', { name: /Queue for next turn/ }).click()
      await pill(1).waitFor()
      await draft.fill('/queue From the slash command')
      await draft.press('Enter')
      await pill(2).waitFor()
      assert.equal(await pill(2).getAttribute('aria-expanded'), 'false')
      await pill(2).click()
      const rows = page.locator('.queue-item')
      assert.deepEqual(await rows.locator('.queue-text span').allTextContents(), ['From the busy menu', 'From the slash command'])
      await t.test('gateway without pending-only cancellation cannot delete or interrupt', async () => {
        const del = rows.first().getByLabel('Delete queued message')
        assert.equal(await del.isDisabled(), true)
        // Bypass the disabled UI to exercise the bridge/client safeguard too.
        const outcome = await page.evaluate(async () => {
          const api = window.icyteru
          const id = (await api.getSnapshot()).queued[0].id
          try { await api.deleteQueued(id); return 'deleted' } catch (e) { return e.message }
        })
        assert.match(outcome, /cannot safely delete|not supported|unavailable/i)
        assert.deepEqual(await page.evaluate(() => window.queueHarness.errors), [])
        assert.deepEqual(await rows.locator('.queue-text span').allTextContents(), ['From the busy menu', 'From the slash command'])
      })
      await t.test('atomic edit goes to FIFO tail; terminal receipts drain the pill', async () => {
        await rows.first().getByRole('button', { name: 'Edit', exact: true }).click()
        await page.getByLabel('Edit queued message').fill('Revised follow-up')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.waitForFunction(() => window.queueHarness.errors.length ||
          document.querySelector('.queue-item:last-child .queue-text span')?.textContent === 'Revised follow-up')
        assert.deepEqual(await page.evaluate(() => window.queueHarness.errors), [])
        assert.deepEqual(await rows.locator('.queue-text span').allTextContents(), ['From the slash command', 'Revised follow-up'])
        await page.evaluate(() => window.queueHarness.finishNext())
        await pill(1).waitFor()
        assert.deepEqual(await rows.locator('.queue-text span').allTextContents(), ['Revised follow-up'])
        await page.evaluate(() => window.queueHarness.finishNext())
        await page.locator('.queue-pill').waitFor({ state: 'detached' })
        assert.equal(await rows.count(), 0)
        const writes = await page.evaluate(() => window.queueHarness.calls.filter(c => c.method !== 'prompt.receipt'))
        assert.deepEqual(writes.map(c => [c.method, c.params.text]), [
          ['prompt.submit', 'From the busy menu'], ['prompt.submit', 'From the slash command'],
          ['prompt.replace_queued', 'Revised follow-up']
        ])
        assert.deepEqual(pageErrors, [])
      })
    } finally { await browser.close() }
  } finally { await server.close() }
})
