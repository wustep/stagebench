/**
 * Server lifecycle for the capture pass.
 *
 * `vite preview` is started as a detached process group and torn down at the end, so the
 * capture owns its own server without depending on anything the shell left behind.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

export async function startPreview(root, timeoutMs = 30000) {
  const port = await freePort()
  const child = spawn(
    process.execPath,
    [
      new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname,
      'preview',
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  const base = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
    try {
      const response = await fetch(base)
      if (response.ok) {
        return {
          base,
          port,
          stop() {
            child.kill('SIGTERM')
          },
        }
      }
    } catch {
      /* not listening yet */
    }
  }
  child.kill('SIGKILL')
  throw new Error(`vite preview did not start:\n${output}`)
}
