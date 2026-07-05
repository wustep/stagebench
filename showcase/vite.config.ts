import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { basename, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secretBridgePlugin } from '../bench/lib/vite-secret-bridge.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Dev-server bridge to the repo-root reference/ photos (gitignored,
 *  fetched via `pnpm bench fetch`, never redistributed). On production the
 *  same /reference/* path is served by middleware.js after /secret unlock
 *  (proxied from Nord's CDN). */
const referencePhotos = (): Plugin => ({
  name: 'stagebench-reference-photos',
  configureServer(server) {
    server.middlewares.use('/reference', (req, res, next) => {
      const name = basename((req.url ?? '').split('?')[0]!)
      if (!/^nord-stage-4[\w.-]*\.jpg$/.test(name)) return next()
      const file = resolve(server.config.root, '..', 'reference', name)
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'image/jpeg')
      createReadStream(file).pipe(res)
    })
  },
})

export default defineConfig({
  base: './',
  plugins: [react(), secretBridgePlugin({ envDir: repoRoot }), referencePhotos()],
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
