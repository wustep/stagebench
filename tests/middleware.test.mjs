import test from 'node:test'
import assert from 'node:assert/strict'
import middleware, { handleRequest } from '../middleware.js'

const request = (path = '/', options = {}) => new Request(`https://stagebench.example${path}`, options)

test('middleware fails closed when the deployment secret is missing', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request())
  assert.equal(response.status, 503)
})

test('middleware renders the private login without exposing the password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const response = await middleware(request('/?run=example&phase=1'))
  assert.equal(response.status, 401)
  const html = await response.text()
  assert.match(html, /Enter access password/)
  assert.match(html, /value="\/\?run=example&amp;phase=1"/)
  assert.doesNotMatch(html, /test-password/)
})

test('middleware rejects a wrong password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'wrong', returnTo: '/' })
  const response = await handleRequest(request('/__stagebench/auth', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: false }),
  })
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('middleware renders a readable rate-limit error', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'wrong', returnTo: '/' })
  const response = await handleRequest(request('/__stagebench/auth', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: true }),
  })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '3600')
  assert.match(await response.text(), /Too many attempts\. Try again in up to one hour\./)
})

test('middleware creates an HttpOnly session and accepts it on later requests', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const body = new URLSearchParams({ password: 'test-password', returnTo: '/?run=example&phase=2' })
  const login = await handleRequest(request('/__stagebench/auth', { method: 'POST', body }), {
    checkRateLimit: async () => ({ rateLimited: false }),
  })
  assert.equal(login.status, 303)
  assert.equal(login.headers.get('location'), '/?run=example&phase=2')

  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /stagebench_session=/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.doesNotMatch(cookie, /test-password/)

  const response = await middleware(request('/', { headers: { cookie } }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-middleware-next'), '1')
})

test('middleware rejects a tampered session cookie', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const response = await middleware(request('/', {
    headers: { cookie: 'stagebench_session=9999999999999.invalid' },
  }))
  assert.equal(response.status, 401)
})

test('a crypto failure is logged but stays indistinguishable from a bad signature', async () => {
  process.env.STAGEBENCH_PASSWORD = 'test-password'
  const cookie = 'stagebench_session=9999999999999.invalid'

  // Baseline: an ordinary invalid signature (verify resolves false, no throw).
  const invalid = await middleware(request('/', { headers: { cookie } }))
  const invalidBody = await invalid.text()

  // Force a genuine crypto error and confirm it is logged separately but the
  // response (status + body) is identical to the invalid-signature path.
  const originalVerify = crypto.subtle.verify
  const errors = []
  const originalConsoleError = console.error
  console.error = (...args) => errors.push(args)
  crypto.subtle.verify = () => { throw new Error('boom: simulated crypto/config failure') }
  try {
    const failed = await middleware(request('/', { headers: { cookie } }))
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

delete process.env.STAGEBENCH_PASSWORD
