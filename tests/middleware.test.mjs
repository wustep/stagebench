import test from 'node:test'
import assert from 'node:assert/strict'
import middleware, { handleRequest } from '../middleware.js'

const request = (path = '/', options = {}) => new Request(`https://stagebench.example${path}`, options)

test('middleware passes through the public gallery without a password', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request('/?run=example&phase=1'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-middleware-next'), '1')
})

test('middleware fails closed on /secret when the deployment secret is missing', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request('/secret'))
  assert.equal(response.status, 503)
})

test('middleware renders the /secret unlock page without exposing the password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const response = await middleware(request('/secret'))
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Unlock extra models/)
  assert.doesNotMatch(html, /test-password/)
})

test('middleware rejects a wrong /secret password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'wrong' })
  const response = await handleRequest(request('/secret', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: false }),
  })
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('middleware renders a readable rate-limit error on /secret', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'wrong' })
  const response = await handleRequest(request('/secret', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: true }),
  })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '3600')
  assert.match(await response.text(), /Too many attempts\. Try again in up to one hour\./)
})

test('middleware creates an extras cookie and accepts it on later /secret requests', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'test-password' })
  const login = await handleRequest(request('/secret', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: false }),
  })
  assert.equal(login.status, 303)
  assert.equal(login.headers.get('location'), '/')

  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /stagebench_extras=/)
  assert.match(cookie, /Secure/)
  assert.doesNotMatch(cookie, /test-password/)

  const response = await middleware(request('/secret', { headers: { cookie } }))
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Extra models are unlocked/)
})

test('middleware rejects a tampered extras cookie on /secret', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const response = await middleware(request('/secret', {
    headers: { cookie: 'stagebench_extras=9999999999999.invalid' },
  }))
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Unlock extra models/)
})

test('a crypto failure is logged but stays indistinguishable from a bad signature', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const cookie = 'stagebench_extras=9999999999999.invalid'

  const invalid = await middleware(request('/secret', { headers: { cookie } }))
  const invalidBody = await invalid.text()

  const originalVerify = crypto.subtle.verify
  const errors = []
  const originalConsoleError = console.error
  console.error = (...args) => errors.push(args)
  crypto.subtle.verify = () => { throw new Error('boom: simulated crypto/config failure') }
  try {
    const failed = await middleware(request('/secret', { headers: { cookie } }))
    assert.equal(failed.status, invalid.status)
    assert.equal(await failed.text(), invalidBody)
    assert.ok(
      errors.some(([message]) => String(message).includes('crypto error')),
      'a crypto error should be logged distinctly',
    )
  } finally {
    crypto.subtle.verify = originalVerify
    console.error = originalConsoleError
  }
})

test('middleware proxies /reference photos publicly, without a secret or cookie', async () => {
  delete process.env.STAGEBENCH_PASSWORD

  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const response = await handleRequest(request('/reference/nord-stage-4-73.jpg'), {
    fetch: async (url) => {
      assert.match(String(url), /NS4_HA73_TopDown/)
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes)
})

test('middleware rejects unknown /reference filenames', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request('/reference/not-a-photo.jpg'))
  assert.equal(response.status, 404)
})

delete process.env.STAGEBENCH_PASSWORD
