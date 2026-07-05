import { readFileSync } from 'node:fs'
import { handleRequest } from '../../middleware.js'

const DEV_NO_RATE_LIMIT = async () => ({ rateLimited: false })
const LOCAL_DEV_PASSWORD = 'stagebench'

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** @param {import('node:http').IncomingMessage} req @param {string} host */
async function toRequest(req, host) {
  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers: req.headers,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await readBody(req)
  }
  return new Request(new URL(req.url ?? '/', `http://${host}`), init)
}

/** @param {import('node:http').ServerResponse} res @param {Response} response */
async function writeResponse(res, response, { secureCookies = true } = {}) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') return
    res.setHeader(key, value)
  })

  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : []

  for (const cookie of cookies) {
    const normalized = secureCookies ? cookie : cookie.replace(/;\s*Secure\b/i, '')
    res.appendHeader('Set-Cookie', normalized)
  }

  if (response.body) {
    res.end(Buffer.from(await response.arrayBuffer()))
    return
  }
  res.end()
}

/**
 * Vite dev-server bridge for /secret — same flow as middleware.js on Vercel,
 * but omits Secure on Set-Cookie so http://localhost unlocks work.
 *
 * @param {{ password: string, onFallbackPassword?: () => void }} options
 */
export function mountSecretBridge(server, { password, onFallbackPassword }) {
  server.middlewares.use(async (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname !== '/secret') return next()

    const previous = process.env.STAGEBENCH_PASSWORD
    process.env.STAGEBENCH_PASSWORD = password
    try {
      const host = req.headers.host ?? 'localhost'
      const response = await handleRequest(await toRequest(req, host), {
        checkRateLimit: DEV_NO_RATE_LIMIT,
      })
      await writeResponse(res, response, { secureCookies: false })
    } catch (error) {
      console.error('[stagebench] /secret dev bridge failed', error)
      res.statusCode = 503
      res.end('Extra models unlock is temporarily unavailable.')
    } finally {
      if (previous === undefined) delete process.env.STAGEBENCH_PASSWORD
      else process.env.STAGEBENCH_PASSWORD = previous
    }
  })

  if (onFallbackPassword) onFallbackPassword()
}

/**
 * Resolve STAGEBENCH_PASSWORD for local dev. Falls back to "stagebench" when
 * unset so `pnpm dev` always has a working /secret page.
 *
 * @param {string} envDir
 * @param {string} mode
 */
export function resolveDevPassword(envDir, mode) {
  const fromFile = readEnvValue(envDir, mode, 'STAGEBENCH_PASSWORD')
  const password = fromFile ?? process.env.STAGEBENCH_PASSWORD ?? LOCAL_DEV_PASSWORD
  const usingFallback = password === LOCAL_DEV_PASSWORD && !fromFile && !process.env.STAGEBENCH_PASSWORD
  return { password, usingFallback }
}

/** Minimal .env reader — avoids pulling Vite into this module for tests. */
function readEnvValue(envDir, mode, key) {
  for (const file of [`.env.${mode}.local`, `.env.local`, `.env.${mode}`, '.env']) {
    try {
      const text = readFileSync(`${envDir}/${file}`, 'utf8')
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const name = trimmed.slice(0, eq).trim()
        if (name !== key) continue
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        return value
      }
    } catch {
      // file missing — try next
    }
  }
  return undefined
}

/** @param {{ envDir?: string }} [options] */
export function secretBridgePlugin(options = {}) {
  return {
    name: 'stagebench-secret-bridge',
    configureServer(server) {
      const envDir = options.envDir ?? server.config.envDir
      const { password, usingFallback } = resolveDevPassword(envDir, server.config.mode)
      mountSecretBridge(server, {
        password,
        onFallbackPassword: usingFallback
          ? () => {
              server.config.logger.warn(
                `[stagebench] STAGEBENCH_PASSWORD unset — local /secret password is "${LOCAL_DEV_PASSWORD}"`,
              )
            }
          : undefined,
      })
    },
  }
}
