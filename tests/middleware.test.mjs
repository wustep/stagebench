import test from 'node:test'
import assert from 'node:assert/strict'
import middleware from '../middleware.js'

const request = (path = '/', options = {}) => new Request(`https://stagebench.example${path}`, options)

test('middleware fails closed when the deployment secret is missing', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request())
  assert.equal(response.status, 503)
})

test('middleware renders the private login without exposing the password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const response = await middleware(request('/?run=example&phase=1'))
  assert.equal(response.status, 401)
  const html = await response.text()
  assert.match(html, /Enter access password/)
  assert.match(html, /value="\/\?run=example&amp;phase=1"/)
  assert.doesNotMatch(html, /NORD/)
})

test('middleware rejects a wrong password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const body = new URLSearchParams({ password: 'wrong', returnTo: '/' })
  const response = await middleware(request('/__stagebench/auth', { method: 'POST', body }))
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('middleware creates an HttpOnly session and accepts it on later requests', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const body = new URLSearchParams({ password: 'NORD', returnTo: '/?run=example&phase=2' })
  const login = await middleware(request('/__stagebench/auth', { method: 'POST', body }))
  assert.equal(login.status, 303)
  assert.equal(login.headers.get('location'), '/?run=example&phase=2')

  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /stagebench_session=/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.doesNotMatch(cookie, /NORD/)

  const response = await middleware(request('/', { headers: { cookie } }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-middleware-next'), '1')
})

test('middleware rejects a tampered session cookie', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const response = await middleware(request('/', {
    headers: { cookie: 'stagebench_session=9999999999999.invalid' },
  }))
  assert.equal(response.status, 401)
})

delete process.env.STAGEBENCH_PASSWORD
