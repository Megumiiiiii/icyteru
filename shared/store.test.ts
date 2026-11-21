import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Module from 'node:module'
import test from 'node:test'

test('connection store saves, loads, and clears a gateway', () => {
  const dir = mkdtempSync(join(tmpdir(), 'icyteru-store-'))
  const fakeElectron = {
    app: { getPath: () => dir },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString()
    }
  }
  const original = (Module as unknown as { _load: (...args: any[]) => any })._load
  ;(Module as unknown as { _load: (...args: any[]) => any })._load = function (request: string, ...rest: any[]) {
    if (request === 'electron') return fakeElectron
    return original.call(this, request, ...rest)
  }
  try {
    const store = require('../electron/store') as {
      saveConnection: (value: unknown) => void
      loadConnection: () => any
      clearConnection: () => void
    }
    store.saveConnection({
      url: 'http://gateway',
      token: 'token-1',
      username: 'user',
      password: 'pass',
      method: 'password',
      theme: 'dark',
      gateways: [{ id: 'primary', url: 'http://gateway', token: 'token-2', username: '', password: '' }]
    })
    const loaded = store.loadConnection()
    assert.equal(loaded.url, 'http://gateway')
    assert.equal(loaded.token, 'token-1')
    assert.equal(loaded.password, 'pass')
    assert.equal(loaded.method, 'password')
    assert.equal(loaded.theme, 'dark')
    assert.equal(loaded.gateways[0].token, 'token-2')
    store.clearConnection()
    assert.equal(store.loadConnection().url, '')
    assert.equal(store.loadConnection().gateways.length, 0)
  } finally {
    ;(Module as unknown as { _load: (...args: any[]) => any })._load = original
    rmSync(dir, { recursive: true, force: true })
  }
})
