import test from 'node:test'
import assert from 'node:assert/strict'
import middleware from '../middleware.js'

const request = (authorization) => new Request('https://stagebench.example/', {
  headers: authorization ? { authorization } : undefined,
})

test('middleware fails closed when the deployment secret is missing', async () => {
  delete process.env.STAGEBENCH_PASSWORD
  const response = await middleware(request())
  assert.equal(response.status, 503)
})

test('middleware challenges unauthenticated requests', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const response = await middleware(request())
  assert.equal(response.status, 401)
  assert.match(response.headers.get('www-authenticate'), /Basic realm="Stagebench"/)
})

test('middleware forwards the request with the configured password', async () => {
  process.env.STAGEBENCH_PASSWORD = 'NORD'
  const token = Buffer.from('stagebench:NORD').toString('base64')
  const response = await middleware(request(`Basic ${token}`))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-middleware-next'), '1')
})

delete process.env.STAGEBENCH_PASSWORD
