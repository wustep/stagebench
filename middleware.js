import { next } from '@vercel/functions'
import { checkRateLimit } from '@vercel/firewall'

const LOGIN_RATE_LIMIT_ID = 'stagebench-login'
const SESSION_SECONDS = 60 * 60 * 24 * 7

const EXTRAS_PATH = '/secret'
const EXTRAS_COOKIE = 'stagebench_extras'
const encoder = new TextEncoder()

// Official Nord product shots — proxied for unlocked visitors only (same
// URLs as bench/lib/fetch-reference.mjs; not bundled in the repo).
const REFERENCE_PHOTOS = {
  'nord-stage-4.jpg': 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/lyDePXcG/NS4_HA88_TopDown-01_241008.jpg',
  'nord-stage-4-73.jpg': 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/2jnZVaTL/NS4_HA73_TopDown-01_241008.jpg',
  'nord-stage-4-compact.jpg': 'https://assets.nordkeyboards.com/nord-assets-prod/media/original_images/NS4_Compact73_TopDown-01_231020.jpg',
}
const REFERENCE_PHOTO_NAME = /^nord-stage-4[\w.-]*\.jpg$/

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

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function extrasPage({ unlocked = false, error = '' } = {}) {
  const errorMarkup = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''
  const body = unlocked
    ? `<p>Extra models are unlocked in this browser. They'll now show up on the gallery.</p>
        <a class="back" href="/">&larr; Back to the gallery</a>`
    : `<p>Enter the access password to reveal extra models on the gallery.</p>
        <form action="${EXTRAS_PATH}" method="post">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
          <button type="submit">Unlock extra models</button>
        </form>
        ${errorMarkup}`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Secret · Stagebench</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0d0b0b; color: #fff; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(135deg, #0d0b0b, #171313 58%, #0d0b0b); }
      main { width: min(100%, 420px); border: 1px solid rgba(255,255,255,.34); background: #171313; box-shadow: 0 8px 0 rgba(0,0,0,.55); }
      header { padding: 18px 20px; border-bottom: 1px solid #443939; color: #a8e982; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      section { padding: 28px 20px 24px; }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.025em; }
      p { margin: 0 0 22px; color: #c9bebe; font-size: 14px; line-height: 1.55; }
      label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
      input { width: 100%; height: 48px; border: 1px solid #706363; border-radius: 0; padding: 0 13px; background: #0d0b0b; color: #fff; font: inherit; outline: none; }
      input:focus { border-color: #fff; box-shadow: 0 0 0 2px #f1b800; }
      button { width: 100%; height: 46px; margin-top: 12px; border: 0; border-radius: 0; background: #a8e982; color: #171313; font: 800 13px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
      button:hover { background: #bdf59a; }
      .error { margin: 12px 0 0; color: #ffb7aa; font-weight: 700; }
      .back { color: #a8e982; font-weight: 700; text-decoration: none; }
      .back:hover { text-decoration: underline; }
      footer { padding: 13px 20px; border-top: 1px solid #443939; color: #8f8282; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <header>Stagebench · secret</header>
      <section>
        <h1>Extra models</h1>
        ${body}
      </section>
      <footer>Unlocking is remembered securely for seven days, in this browser only.</footer>
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

async function extrasUnlocked(request, password) {
  const extrasSession = getCookie(request, EXTRAS_COOKIE)
  return isValidSession(extrasSession, `${password}::extras`)
}

async function handleReferencePhoto(request, password, options = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: securityHeaders })
  }

  const name = request.url.split('/').pop()?.split('?')[0] ?? ''
  if (!REFERENCE_PHOTO_NAME.test(name)) {
    return new Response('Not found', { status: 404, headers: securityHeaders })
  }

  const sourceUrl = REFERENCE_PHOTOS[name]
  if (!sourceUrl) {
    return new Response('Not found', { status: 404, headers: securityHeaders })
  }

  if (!(await extrasUnlocked(request, password))) {
    return new Response('Not found', { status: 404, headers: securityHeaders })
  }

  const fetchImpl = options.fetch ?? fetch
  const upstream = await fetchImpl(sourceUrl)
  if (!upstream.ok) {
    return new Response('Reference photo unavailable', { status: 502, headers: securityHeaders })
  }

  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }
  return new Response(upstream.body, { status: 200, headers })
}

export async function handleRequest(request, options = {}) {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/reference/')) {
    const password = process.env.STAGEBENCH_PASSWORD
    if (!password) {
      return new Response('Reference photos are not configured.', {
        status: 503,
        headers: securityHeaders,
      })
    }
    return handleReferencePhoto(request, password, options)
  }

  if (url.pathname !== EXTRAS_PATH) {
    return next({
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  }

  const password = process.env.STAGEBENCH_PASSWORD
  if (!password) {
    return new Response('Extra models unlock is not configured.', {
      status: 503,
      headers: securityHeaders,
    })
  }

  const extrasPassword = `${password}::extras`

  if (request.method === 'POST') {
    const form = await request.formData()
    const rateLimit = options.checkRateLimit ?? checkRateLimit

    try {
      const { rateLimited, error } = await rateLimit(LOGIN_RATE_LIMIT_ID, { request })
      if (rateLimited) {
        return htmlResponse(
          extrasPage({ error: 'Too many attempts. Try again in up to one hour.' }),
          429,
          { 'Retry-After': '3600' },
        )
      }
      if (error === 'not-found') throw new Error(`Missing firewall rate limit: ${LOGIN_RATE_LIMIT_ID}`)
    } catch (error) {
      console.error('Stagebench extras rate limit failed', error)
      return htmlResponse(
        extrasPage({ error: 'Authentication is temporarily unavailable. Please try again later.' }),
        503,
      )
    }

    if (String(form.get('password') ?? '') !== password) {
      return htmlResponse(extrasPage({ error: 'Incorrect password.' }))
    }

    const extrasSession = await createSession(extrasPassword)
    return new Response(null, {
      status: 303,
      headers: {
        ...securityHeaders,
        Location: '/',
        'Set-Cookie': `${EXTRAS_COOKIE}=${extrasSession}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; SameSite=Lax`,
      },
    })
  }

  const extrasSession = getCookie(request, EXTRAS_COOKIE)
  const unlocked = await isValidSession(extrasSession, extrasPassword)
  return htmlResponse(extrasPage({ unlocked }), 200)
}

export default function middleware(request) {
  return handleRequest(request)
}

export const config = {
  matcher: ['/secret', '/reference/:path*'],
  runtime: 'nodejs',
}
