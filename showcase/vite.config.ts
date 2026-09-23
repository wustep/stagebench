import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { basename, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Dev-server bridge to repo-root reference/ photos (committed JPGs).
 *  On production the same /reference/* path is served publicly by
 *  middleware.js (local public/reference/ first, then Nord CDN —
 *  no /secret unlock required). */
const referencePhotos = (): Plugin => ({
  name: 'stagebench-reference-photos',
  configureServer(server) {
    server.middlewares.use('/reference', (req, res, next) => {
      const name = basename((req.url ?? '').split('?')[0]!)
      if (!/^nord-stage-4[\w.-]*\.jpg$/.test(name)) return next()
      const file = resolve(repoRoot, 'reference', name)
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'image/jpeg')
      createReadStream(file).pipe(res)
    })
  },
})

/**
 * Optional /secret unlock for local showcase `pnpm dev`.
 * Import path is concatenated so Vite's config bundler cannot statically
 * follow it into middleware.js (@vercel/*) — Showcase CI has no root deps.
 */
const optionalSecretBridge = (): Plugin => ({
  name: 'stagebench-secret-bridge-optional',
  async configureServer(server) {
    try {
      const bridgeModule = '../bench/lib/' + 'vite-secret-bridge.mjs'
      const { mountSecretBridge, resolveDevPassword } = await import(bridgeModule)
      const { password, usingFallback } = resolveDevPassword(repoRoot, server.config.mode)
      mountSecretBridge(server, {
        password,
        onFallbackPassword: usingFallback
          ? () => {
              server.config.logger.warn(
                '[stagebench] STAGEBENCH_PASSWORD unset — local /secret password is "stagebench"',
              )
            }
          : undefined,
      })
    } catch (error) {
      server.config.logger.warn(
        `[stagebench] /secret bridge skipped (root @vercel deps not installed): ${
          error instanceof Error ? error.message : error
        }`,
      )
    }
  },
})

export default defineConfig({
  base: './',
  plugins: [react(), optionalSecretBridge(), referencePhotos()],
  build: {
    rollupOptions: {
      output: {
        // Split React/ReactDOM (+ scheduler) into their own chunk so they cache
        // across deploys — they never change, while the app chunk's hash busts
        // on every edit. Keeps the ~140 KB vendor payload out of the app cache.
        manualChunks: (id: string) =>
          /\/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined,
      },
    },
  },
})
