// Serves previews from a checkout's public/ for shows with "previewBase": "local", so a film is
// reproducible offline and can include previews that aren't deployed yet.
//
// Uses Python's http.server handler (not `npx serve`, which 301-redirects /…/index.html to /…/ and
// breaks the builds' relative ./assets URLs; see .claude/skills/bench-video), on a threaded server
// with a deep listen backlog. Plain `python3 -m http.server` listens with a backlog of 5, and a
// preview that fetches its samples in one burst (GPT-6 Sol: 56 at once) gets connections reset,
// which flips that engine to its synthesized fallback. One server per public/ root per process, on
// a free localhost port, killed when the process exits.
import net from 'net';
import { spawn } from 'child_process';

const servers = new Map(); // public root -> Promise<base url>
const children = new Set();
const PYTHON = process.env.PYTHON || 'python3';
const SERVER = `
import functools, http.server, sys
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Server(('127.0.0.1', int(sys.argv[1])), functools.partial(Quiet, directory=sys.argv[2])).serve_forever()
`;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  const killAll = () => { for (const c of children) { try { c.kill(); } catch { /* already gone */ } } };
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); process.exit(130); });
}

export function serve(root) {
  if (!servers.has(root)) {
    servers.set(root, (async () => {
      hookExit();
      const port = await freePort();
      const child = spawn(PYTHON, ['-I', '-c', SERVER, String(port), root], { stdio: 'ignore' });
      child.unref(); // don't keep the process alive; the exit hook kills it
      children.add(child);
      child.on('exit', () => children.delete(child));
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode != null) throw new Error(`${PYTHON} http.server exited (${child.exitCode}) serving ${root}`);
        try { await fetch(base + '/', { method: 'HEAD' }); return base; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      throw new Error(`http.server for ${root} did not come up on ${base}`);
    })());
  }
  return servers.get(root);
}

// The URL a script should open for a show model (loadShow() model object).
export async function previewUrl(m) {
  if (m.placeholder) throw new Error(`${m.id} is a placeholder (${m.placeholder}); nothing to open`);
  if (m.url) return m.url;
  return (await serve(m.previewRoot)) + m.previewPath;
}
