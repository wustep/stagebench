import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'

/** Dev-server bridge to the repo-root reference/ photos (gitignored, fetched
 *  via `pnpm bench fetch`, never redistributed). Lets the artifact study
 *  pages under public/artifacts/ overlay /reference/<photo>.jpg while
 *  developing; production serves the same route from middleware.js after the
 *  /secret unlock, so published builds never bundle Nord's product shots. */
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
  plugins: [react(), referencePhotos()],
})
