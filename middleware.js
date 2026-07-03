import { next } from '@vercel/functions'
import { checkRateLimit } from '@vercel/firewall'

const AUTH_PATH = '/__stagebench/auth'
const COOKIE_NAME = 'stagebench_session'
const LOGIN_RATE_LIMIT_ID = 'stagebench-login'
const SESSION_SECONDS = 60 * 60 * 24 * 7
const encoder = new TextEncoder()

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('cookie') ?? ''
  for (const entry of cookieHeader.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

async function importSigningKey(password) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function createSession(password) {
  const expiresAt = String(Date.now() + SESSION_SECONDS * 1000)
  const key = await importSigningKey(password)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expiresAt))
  return `${expiresAt}.${Buffer.from(signature).toString('base64url')}`
}

async function isValidSession(value, password) {
  if (!value) return false
  const [expiresAt, encodedSignature, ...extra] = value.split('.')
  if (extra.length > 0 || !expiresAt || !encodedSignature || Number(expiresAt) <= Date.now()) return false

  try {
    const key = await importSigningKey(password)
    // verify() resolves false for an invalid signature — an expected result,
    // not an error. Any throw here is a genuine crypto/config failure.
    return await crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(encodedSignature, 'base64url'),
      encoder.encode(expiresAt),
    )
  } catch (error) {
    // Log unexpected crypto failures (with stack) so they are distinguishable
    // from an ordinary bad cookie in the logs. Still fail closed, and keep the
    // response identical to the invalid-signature path (no status/body/timing
    // difference): return false exactly as an invalid signature would.
    console.error('Stagebench session verification crypto error', error)
    return false
  }
}

function safeReturnTo(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function loginPage(returnTo, error = '') {
  const errorMarkup = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Private · Stagebench</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #d40000; color: #fff; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(135deg, #a40000, #df0000 58%, #a40000); }
      main { width: min(100%, 420px); border: 1px solid rgba(255,255,255,.34); background: #171313; box-shadow: 0 8px 0 rgba(65,0,0,.55); }
      header { padding: 18px 20px; border-bottom: 1px solid #443939; color: #a8e982; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      section { padding: 28px 20px 24px; }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.025em; }
      p { margin: 0 0 22px; color: #c9bebe; font-size: 14px; line-height: 1.55; }
      label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
      input { width: 100%; height: 48px; border: 1px solid #706363; border-radius: 0; padding: 0 13px; background: #0d0b0b; color: #fff; font: inherit; outline: none; }
      input:focus { border-color: #fff; box-shadow: 0 0 0 2px #f1b800; }
      button { width: 100%; height: 46px; margin-top: 12px; border: 0; border-radius: 0; background: #d40000; color: #fff; font: 800 13px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      button:hover { background: #f00000; }
      .error { margin: 12px 0 0; color: #ffb7aa; font-weight: 700; }
      footer { padding: 13px 20px; border-top: 1px solid #443939; color: #8f8282; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <header>Stagebench · private preview</header>
      <section>
        <h1>Enter access password</h1>
        <p>This benchmark is still under development and is not publicly available.</p>
        <form action="${AUTH_PATH}" method="post">
          <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
          <button type="submit">Unlock Stagebench</button>
        </form>
        ${errorMarkup}
      </section>
      <footer>Access is remembered securely for seven days.</footer>
    </main>
  </body>
</html>`
}

function htmlResponse(html, status = 401, headers = {}) {
  return new Response(html, {
    status,
    headers: { ...securityHeaders, ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function handleRequest(request, options = {}) {
  const password = process.env.STAGEBENCH_PASSWORD
  if (!password) {
    return new Response('Stagebench protection is not configured.', {
      status: 503,
      headers: securityHeaders,
    })
  }

  const url = new URL(request.url)
  const requestedPath = `${url.pathname}${url.search}`

  if (url.pathname === AUTH_PATH) {
    if (request.method !== 'POST') return htmlResponse(loginPage('/'), 405)

    const form = await request.formData()
    const returnTo = safeReturnTo(String(form.get('returnTo') ?? '/'))
    const rateLimit = options.checkRateLimit ?? checkRateLimit

    try {
      const { rateLimited, error } = await rateLimit(LOGIN_RATE_LIMIT_ID, { request })
      if (rateLimited) {
        return htmlResponse(
          loginPage(returnTo, 'Too many attempts. Try again in up to one hour.'),
          429,
          { 'Retry-After': '3600' },
        )
      }
      if (error === 'not-found') throw new Error(`Missing firewall rate limit: ${LOGIN_RATE_LIMIT_ID}`)
    } catch (error) {
      console.error('Stagebench login rate limit failed', error)
      return htmlResponse(
        loginPage(returnTo, 'Authentication is temporarily unavailable. Please try again later.'),
        503,
      )
    }

    if (String(form.get('password') ?? '') !== password) {
      return htmlResponse(loginPage(returnTo, 'Incorrect password. Please wait before trying repeatedly.'))
    }

    const session = await createSession(password)
    return new Response(null, {
      status: 303,
      headers: {
        ...securityHeaders,
        Location: returnTo,
        'Set-Cookie': `${COOKIE_NAME}=${session}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      },
    })
  }

  const session = getCookie(request, COOKIE_NAME)
  if (!(await isValidSession(session, password))) {
    return htmlResponse(loginPage(safeReturnTo(requestedPath)))
  }

  return next({
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}

export default function middleware(request) {
  return handleRequest(request)
}

export const config = {
  matcher: '/(.*)',
  runtime: 'nodejs',
}
