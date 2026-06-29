import { next } from '@vercel/functions'

const AUTH_USER = 'stagebench'

function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': 'Basic realm="Stagebench", charset="UTF-8"',
    },
  })
}

export default function middleware(request) {
  const password = process.env.STAGEBENCH_PASSWORD

  // Fail closed if the deployment was created without its secret configured.
  if (!password) {
    return new Response('Stagebench protection is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const expected = `Basic ${Buffer.from(`${AUTH_USER}:${password}`).toString('base64')}`
  if (request.headers.get('authorization') !== expected) return unauthorized()

  return next({ headers: { 'Cache-Control': 'private, no-store' } })
}

export const config = {
  matcher: '/(.*)',
  runtime: 'nodejs',
}
