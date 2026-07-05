import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { resolveDevPassword, mountSecretBridge } from '../bench/lib/vite-secret-bridge.mjs'

test('resolveDevPassword falls back to stagebench when unset', () => {
  const previous = process.env.STAGEBENCH_PASSWORD
  delete process.env.STAGEBENCH_PASSWORD
  try {
    const resolved = resolveDevPassword('/tmp/nonexistent-env-dir', 'development')
    assert.equal(resolved.password, 'stagebench')
    assert.equal(resolved.usingFallback, true)
  } finally {
    if (previous === undefined) delete process.env.STAGEBENCH_PASSWORD
    else process.env.STAGEBENCH_PASSWORD = previous
  }
})

test('dev /secret bridge unlocks without Secure cookies on http://localhost', async () => {
  const previous = process.env.STAGEBENCH_PASSWORD
  process.env.STAGEBENCH_PASSWORD = 'test-password'

  /** @type {import('node:http').RequestListener} */
  let listener
  const server = createServer((req, res) => listener(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  mountSecretBridge({ middlewares: { use: (fn) => { listener = fn } } }, { password: 'test-password' })

  const login = await fetch(`http://127.0.0.1:${port}/secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'test-password' }),
    redirect: 'manual',
  })
  assert.equal(login.status, 303)
  const setCookie = login.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /stagebench_extras=/)
  assert.doesNotMatch(setCookie, /Secure/i)

  const cookie = setCookie.split(';')[0]
  const unlocked = await fetch(`http://127.0.0.1:${port}/secret`, { headers: { cookie } })
  assert.equal(unlocked.status, 200)
  assert.match(await unlocked.text(), /Extra models are unlocked/)

  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve(undefined))))
  if (previous === undefined) delete process.env.STAGEBENCH_PASSWORD
  else process.env.STAGEBENCH_PASSWORD = previous
})
