import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { secretBridgePlugin } from './bench/lib/vite-secret-bridge.mjs'

/** Dev-server bridge to repo-root reference/ photos (committed JPGs;
 *  `pnpm bench fetch` for the manual PDF). Lets artifact study pages under
 *  public/artifacts/ overlay /reference/<photo>.jpg while developing;
 *  production serves the same route from middleware.js (local files first,
 *  then Nord CDN). */
const referencePhotos = (): Plugin => ({
  name: 'stagebench-reference-photos',
  configureServer(server) {
    server.middlewares.use('/reference', (req, res, next) => {
      const name = basename((req.url ?? '').split('?')[0]!)
      if (!/^nord-stage-4[\w.-]*\.jpg$/.test(name)) return next()
      const file = resolve(server.config.root, 'reference', name)
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'image/jpeg')
      createReadStream(file).pipe(res)
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), secretBridgePlugin(), referencePhotos()],
})
