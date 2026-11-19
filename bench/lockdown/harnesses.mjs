// Per-harness adapters. The lockdown itself is harness-agnostic — a box, three
// volumes, one gateway — so an adapter is deliberately small: where the
// harness keeps its login, which model API host it talks to, the config that
// makes it run unattended, and its command line. Optionally (omp uses these):
// `image`, a Containerfile target its agent box runs in instead of the
// candidate image; `pinModels(context)`, the models the gateway pins when the
// operator names none; `check(options)`, run before a session is opened; and
// `describeLaunch(context)`, kept on the launch record. Nothing here is a security
// boundary; an adapter that got everything wrong would produce a harness that
// cannot reach its model, not a candidate that can reach the host.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BOX_HOME = '/home/candidate'
export const BOX_WORKSPACE = '/workspace'

// The candidate holds this; the gateway swaps in the real credential on the
// way to the one host it belongs to. The vendor prefix is kept so harnesses
// that sniff the key type still pick the right auth scheme.
export function placeholderFor(secret) {
  const prefix = /^(sk-ant-[a-z]+\d+-|sk-proj-|sk-|xai-|key-|vck_)/.exec(secret)?.[1] ?? ''
  return `${prefix}stagebench-placeholder-${crypto.randomBytes(16).toString('hex')}`
}

// A stand-in for a JWT the harness has to be able to read but must not be able
// to use. The header is kept (it names an algorithm and a key id, nothing
// personal); the claims are reduced to what a client inspects — expiry and
// issue times, issuer, audience, scopes, the plan type, and the account id —
// with every other identifier (user, organisation, session, e-mail, name)
// replaced; and the signature is random. The provider would reject it, which
// is the point: the gateway swaps the real token in on the way out, so the box
// never holds one.
//
// The account id stays because Codex checks it against the provider's own
// account list (`/backend-api/wham/accounts/check`) before it sends a turn; a
// made-up id fails there with "selected workspace missing from routing
// discovery". It is an identifier, not a credential: it authenticates nothing
// without the token, which is not in the box.
const KEPT_STRING_CLAIMS = new Set(['iss', 'aud', 'scp', 'client_id', 'acr', 'amr', 'auth_provider', 'chatgpt_account_id', 'chatgpt_plan_type', 'chatgpt_compute_residency', 'chatgpt_subscription_active_start', 'chatgpt_subscription_active_until', 'chatgpt_subscription_last_checked', 'required'])

function scrubClaims(value, key, replacements) {
  if (Array.isArray(value)) return KEPT_STRING_CLAIMS.has(key) ? value : []
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, scrubClaims(entry, name, replacements)]))
  if (typeof value !== 'string') return value
  if (replacements[key] !== undefined) return replacements[key]
  if (KEPT_STRING_CLAIMS.has(key)) return value
  if (key === 'email') return 'candidate@stagebench.invalid'
  return 'stagebench-withheld'
}

export function placeholderJwt(token, replacements = {}) {
  const [header, payload, signature = ''] = String(token).split('.')
  let claims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const scrubbed = Buffer.from(JSON.stringify(scrubClaims(claims, '', replacements))).toString('base64url')
  const fake = crypto.randomBytes(Math.max(32, Math.ceil(signature.length * 3 / 4))).toString('base64url').slice(0, Math.max(43, signature.length))
  return `${header}.${scrubbed}.${fake}`
}

function firstEnv(env, names) {
  for (const name of names) if (env[name]?.trim()) return { name, value: env[name].trim() }
  return null
}

function tomlString(value) {
  return JSON.stringify(String(value))
}

// Block YAML for plain data (objects, arrays, strings, numbers, booleans).
// Every string is written double-quoted, JSON-escaped, which YAML reads as the
// same string, so nothing in a value can change the document's structure.
export function toYaml(value, indent = '') {
  const scalar = (entry) => (typeof entry === 'string' ? JSON.stringify(entry) : String(entry))
  const lines = []
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object') {
        const [first, ...rest] = toYaml(entry, `${indent}  `).split('\n').filter(Boolean)
        lines.push(`${indent}- ${first.trimStart()}`, ...rest)
      } else {
        lines.push(`${indent}- ${scalar(entry)}`)
      }
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const name = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key)
      if (Array.isArray(entry) && entry.length === 0) lines.push(`${indent}${name}: []`)
      else if (entry !== null && typeof entry === 'object') lines.push(`${indent}${name}:`, toYaml(entry, `${indent}  `).replace(/\n$/, ''))
      else lines.push(`${indent}${name}: ${scalar(entry)}`)
    }
  }
  return `${lines.join('\n')}\n`
}

// Exactly what the Codex CLI needs from chatgpt.com to run a turn, and nothing
// that shares a prefix with it. Deliberately absent, and each one was observed
// being requested from inside the box:
//   /backend-api/codex/alpha/search   Codex's web search. It is a client call to
//                                     its own endpoint, not a tool in the model
//                                     request, so stripping `tools` cannot stop
//                                     it — only the path allowlist does.
//   /backend-api/ps/*                 hosted plugins and ChatGPT's remote MCP
//                                     connectors.
// Never widen an entry here to a prefix.
export const CODEX_CHATGPT_PATHS = ['^/backend-api/codex/(responses|responses/compact|models)$', '^/backend-api/wham/(usage|accounts/check|settings/user)$']

// The same rule for Anthropic: the endpoints Claude Code was observed to call,
// each spelled out. No wildcard segment, so there is no subtree to wander into.
export const CLAUDE_PATHS = ['^/v1/messages$', '^/v1/messages/count_tokens$', '^/v1/models$', '^/api/claude_code/(settings|policy_limits)$', '^/api/(hello|oauth/profile|claude_cli_profile)$']

// And for the OpenAI API with a key.
export const OPENAI_API_PATHS = ['^/v1/responses$', '^/v1/responses/compact$', '^/v1/models$']

const codex = {
  label: 'Codex CLI',
  binary: 'codex',
  verified: true,
  env: { CODEX_HOME: `${BOX_HOME}/.codex` },
  transcripts: ['.codex/sessions', '.codex/history.jsonl'],
  authModes: [
    {
      id: 'api-key',
      describe: 'OpenAI API key, held by the gateway; the box only ever sees a placeholder',
      detect: (env) => firstEnv(env, ['STAGEBENCH_OPENAI_API_KEY', 'OPENAI_API_KEY']),
      build(source) {
        const placeholder = placeholderFor(source.value)
        return {
          files: [{ path: '.codex/auth.json', mode: 0o600, content: `${JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: placeholder }, null, 2)}\n` }],
          env: { OPENAI_API_KEY: placeholder },
          egress: [{ host: 'api.openai.com', mode: 'inspect', api: 'openai-responses', paths: OPENAI_API_PATHS }],
          gatewaySecrets: [{ placeholder, value: source.value, hosts: ['api.openai.com'] }],
          leakCheck: [source.value],
          source: `$${source.name}`,
        }
      },
    },
    {
      id: 'chatgpt',
      describe: 'ChatGPT login, held by the gateway: the box gets an auth.json whose tokens are unusable stand-ins with the same shape (the account id, which is not a credential, is real)',
      detect(env, options = {}) {
        const home = options.codexHome ?? env.STAGEBENCH_CODEX_HOME ?? env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
        const file = path.join(home, 'auth.json')
        if (!fs.existsSync(file)) return null
        try {
          const auth = JSON.parse(fs.readFileSync(file, 'utf8'))
          return auth.tokens?.access_token ? { name: file, value: auth } : null
        } catch {
          return null
        }
      },
      build(source) {
        const auth = source.value
        // Codex reads these tokens itself (it decodes the claims and sends the
        // access token as a bearer), so it has to be handed something
        // token-shaped. What it is handed cannot authenticate anything: each
        // JWT keeps its header and its non-identifying claims and gets a random
        // signature. The gateway puts the real access token back, in the
        // Authorization header, on the way to chatgpt.com and nowhere else.
        //
        // The refresh token never goes anywhere. Inside the box it could not
        // be used (the auth host is not on the allowlist), and a refresh from
        // in there would rotate the operator's own login out from under them.
        // A fresh last_refresh stops Codex from trying.
        const access = placeholderJwt(auth.tokens.access_token)
        const identity = auth.tokens.id_token ? placeholderJwt(auth.tokens.id_token) : null
        if (!access) throw new Error(`The access token in ${source.name} is not a JWT; log in to Codex again, or use STAGEBENCH_OPENAI_API_KEY`)
        const boxed = {
          auth_mode: auth.auth_mode ?? 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: new Date().toISOString(),
          tokens: {
            ...(identity ? { id_token: identity } : {}),
            access_token: access,
            refresh_token: 'stagebench-lockdown-refresh-token-withheld',
            ...(auth.tokens.account_id ? { account_id: auth.tokens.account_id } : {}),
          },
        }
        return {
          files: [{ path: '.codex/auth.json', mode: 0o600, content: `${JSON.stringify(boxed, null, 2)}\n` }],
          env: {},
          egress: [{ host: 'chatgpt.com', mode: 'inspect', api: 'openai-responses', paths: CODEX_CHATGPT_PATHS }],
          gatewaySecrets: [{ placeholder: access, value: auth.tokens.access_token, hosts: ['chatgpt.com'] }],
          leakCheck: [auth.tokens.access_token, auth.tokens.refresh_token, auth.tokens.id_token].filter(Boolean),
          source: source.name,
        }
      },
    },
  ],
  files(context) {
    const lines = [
      '# Written by the Stagebench lockdown launcher. The container is the sandbox:',
      '# Codex runs unattended with its own sandbox off, and every hosted tool is',
      '# stripped at the gateway whatever this file says.',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      'web_search = "disabled"',
      'check_for_update_on_startup = false',
      ...(context.model ? [`model = ${tomlString(context.model)}`] : []),
      ...(context.effort ? [`model_reasoning_effort = ${tomlString(context.effort)}`] : []),
      '',
      '[analytics]',
      'enabled = false',
      '',
      `[projects.${tomlString(BOX_WORKSPACE)}]`,
      'trust_level = "trusted"',
      '',
    ]
    return [{ path: '.codex/config.toml', content: lines.join('\n') }]
  },
  command(context) {
    const mcp = Object.entries(context.mcpServers ?? {}).flatMap(([name, server]) => [
      '-c', `mcp_servers.${name}.command=${JSON.stringify(server.command)}`,
      '-c', `mcp_servers.${name}.args=${JSON.stringify(server.args ?? [])}`,
    ])
    const common = ['--dangerously-bypass-approvals-and-sandbox', ...mcp, ...(context.extraArgs ?? [])]
    if (context.interactive) {
      return ['codex', ...common, '-C', BOX_WORKSPACE, ...(context.resume ? ['resume', '--last'] : context.prompt ? [context.prompt] : [])]
    }
    return context.resume
      ? ['codex', 'exec', ...common, '--skip-git-repo-check', '-C', BOX_WORKSPACE, 'resume', '--last', context.prompt]
      : ['codex', 'exec', ...common, '--skip-git-repo-check', '-C', BOX_WORKSPACE, context.prompt]
  },
}

const claude = {
  label: 'Claude Code',
  binary: 'claude',
  verified: true,
  env: {
    CLAUDE_CONFIG_DIR: `${BOX_HOME}/.claude`,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  },
  transcripts: ['.claude/projects'],
  authModes: [
    {
      id: 'api-key',
      describe: 'Anthropic API key, held by the gateway; the box only ever sees a placeholder',
      detect: (env) => firstEnv(env, ['STAGEBENCH_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY']),
      build(source) {
        const placeholder = placeholderFor(source.value)
        return {
          files: [],
          env: { ANTHROPIC_API_KEY: placeholder },
          egress: [{ host: 'api.anthropic.com', mode: 'inspect', api: 'anthropic-messages', paths: CLAUDE_PATHS }],
          gatewaySecrets: [{ placeholder, value: source.value, hosts: ['api.anthropic.com'] }],
          leakCheck: [source.value],
          source: `$${source.name}`,
        }
      },
    },
    {
      id: 'oauth-token',
      describe: 'Claude subscription token (`claude setup-token`), held by the gateway; the box only ever sees a placeholder',
      detect: (env) => firstEnv(env, ['STAGEBENCH_CLAUDE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']),
      build(source) {
        const placeholder = placeholderFor(source.value)
        return {
          files: [],
          env: { CLAUDE_CODE_OAUTH_TOKEN: placeholder },
          egress: [{ host: 'api.anthropic.com', mode: 'inspect', api: 'anthropic-messages', paths: CLAUDE_PATHS }],
          gatewaySecrets: [{ placeholder, value: source.value, hosts: ['api.anthropic.com'] }],
          leakCheck: [source.value],
          source: `$${source.name}`,
        }
      },
    },
  ],
  files() {
    return [
      {
        path: '.claude/settings.json',
        content: `${JSON.stringify({
          permissions: { deny: ['WebSearch', 'WebFetch'], defaultMode: 'bypassPermissions' },
          includeCoAuthoredBy: false,
        }, null, 2)}\n`,
      },
      {
        // First-run dialogs would block an unattended session. Only written
        // when absent, so a resumed session keeps the state Claude Code saved.
        path: '.claude/.claude.json',
        keepExisting: true,
        content: `${JSON.stringify({
          hasCompletedOnboarding: true,
          bypassPermissionsModeAccepted: true,
          projects: { [BOX_WORKSPACE]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
        }, null, 2)}\n`,
      },
    ]
  },
  command(context) {
    const servers = context.mcpServers && Object.keys(context.mcpServers).length > 0
      ? ['--mcp-config', JSON.stringify({ mcpServers: context.mcpServers })]
      : []
    const common = ['--dangerously-skip-permissions', '--disallowedTools', 'WebSearch', 'WebFetch', ...(context.model ? ['--model', context.model] : []), ...(context.effort ? ['--effort', context.effort] : []), ...servers, ...(context.extraArgs ?? [])]
    if (context.interactive) return ['claude', ...common, ...(context.resume ? ['--continue'] : []), ...(context.prompt ? [context.prompt] : [])]
    return ['claude', ...common, ...(context.resume ? ['--continue'] : []), '--output-format', 'stream-json', '--verbose', '-p', context.prompt]
  },
}

// Oh My Pi (`omp`, npm @oh-my-pi/pi-coding-agent) with models from Vercel AI
// Gateway. omp 19's `vercel-ai-gateway` provider speaks the Anthropic Messages
// wire to the gateway for every model it serves, Gemini included (all 417 rows
// of its bundled catalog say `api: anthropic-messages`), and lists models from
// the OpenAI-style catalog endpoint. Those two are the whole allowlist: omp
// asks the gateway for no token counts, credits, or generation lookups.
export const AI_GATEWAY_HOST = 'ai-gateway.vercel.sh'
export const OMP_AI_GATEWAY_PATHS = ['^/v1/messages$', '^/v1/models$']
export const OMP_PROVIDER = 'vercel-ai-gateway'
export const OMP_AGENT_DIR = `${BOX_HOME}/.omp/agent`
export const OMP_SESSIONS = '.omp/agent/sessions'
// The thinking levels `omp --thinking` accepts.
export const OMP_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
// omp's model roles that drive a chat model. Every one is pointed at the run's
// model: an auxiliary call (titles, subagents, memory, the advisor) goes to the
// model the gateway pins, rather than to a "smol" model it would refuse.
export const OMP_CHAT_ROLES = ['default', 'smol', 'slow', 'vision', 'plan', 'commit', 'tiny', 'memory', 'task', 'advisor', 'widget']

// The run's model as the gateway sees it in a request body (`google/gemini-4-neon`)
// and as omp names it on its command line (`vercel-ai-gateway/google/gemini-4-neon`).
// Either form is accepted for --model.
export function ompModel(model) {
  const raw = String(model ?? '').trim()
  if (!raw) throw new Error('--harness omp needs the AI Gateway model it runs: --model <creator/model>, e.g. --model google/gemini-4-neon')
  const slug = raw.startsWith(`${OMP_PROVIDER}/`) ? raw.slice(OMP_PROVIDER.length + 1) : raw
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(slug) || slug.includes('//') || slug.endsWith('/')) throw new Error(`--model ${JSON.stringify(raw)} is not an AI Gateway model id (creator/model)`)
  return { slug, omp: `${OMP_PROVIDER}/${slug}` }
}

function ompThinking(effort) {
  if (!effort) return null
  if (!OMP_THINKING_LEVELS.includes(effort)) throw new Error(`omp has no thinking level "${effort}" (it takes ${OMP_THINKING_LEVELS.join(', ')})`)
  return effort
}

const omp = {
  label: 'Oh My Pi',
  binary: 'omp',
  // Its own image target (Bun and omp on top of the candidate box): see the Containerfile.
  image: 'candidate-omp',
  verified: true,
  env: {
    PI_CODING_AGENT_DIR: OMP_AGENT_DIR,
    // Belt and braces for what config.yml also says: no grievance reports to
    // qa.omp.sh, no title model call, no OpenTelemetry export.
    PI_AUTO_QA: '0',
    PI_NO_TITLE: '1',
    OTEL_SDK_DISABLED: 'true',
    // omp's openai-codex provider (unused here) asks registry.npmjs.org for
    // the latest @openai/codex at start-up to claim its client version; a
    // pinned version (the Codex CLI in the candidate image) stops the lookup.
    PI_AI_CODEX_CLIENT_VERSION: '0.169.0',
  },
  transcripts: [OMP_SESSIONS],
  // The gateway refuses any model but the run's, whether or not the operator
  // says --pin-models: omp is pointed at that one model for every role.
  pinModels: (context) => [ompModel(context.model).slug],
  check(options) {
    ompModel(options.model)
    if (options.effort) ompThinking(options.effort)
  },
  // What the launch record keeps about how omp was told to run: the model as
  // omp names it, and the thinking level the protocol's effort became.
  describeLaunch: (context) => ({
    model: ompModel(context.model).omp,
    thinking: ompThinking(context.effort),
    mode: context.interactive ? 'interactive' : 'print',
  }),
  authModes: [
    {
      id: 'api-key',
      describe: 'Vercel AI Gateway API key, held by the gateway; the box only ever sees a placeholder',
      detect: (env) => firstEnv(env, ['STAGEBENCH_AI_GATEWAY_API_KEY', 'AI_GATEWAY_API_KEY']),
      build(source) {
        const placeholder = placeholderFor(source.value)
        return {
          files: [],
          // The variable omp's vercel-ai-gateway provider reads its key from.
          env: { AI_GATEWAY_API_KEY: placeholder },
          egress: [{ host: AI_GATEWAY_HOST, mode: 'inspect', api: 'vercel-ai-gateway', paths: OMP_AI_GATEWAY_PATHS }],
          gatewaySecrets: [{ placeholder, value: source.value, hosts: [AI_GATEWAY_HOST] }],
          leakCheck: [source.value],
          source: `$${source.name}`,
        }
      },
    },
  ],
  files(context) {
    const model = ompModel(context.model)
    const thinking = ompThinking(context.effort)
    const header = [
      '# Written by the Stagebench lockdown launcher. The container is the sandbox:',
      '# omp runs unattended, reaches only Vercel AI Gateway through the lockdown',
      '# gateway, and every hosted tool is stripped there whatever this file says.',
      '',
    ].join('\n')
    const settings = {
      modelRoles: Object.fromEntries(OMP_CHAT_ROLES.map((role) => [role, model.omp])),
      ...(thinking ? { defaultThinkingLevel: thinking } : {}),
      tools: { approvalMode: 'yolo' },
      // Nothing that reaches past the model API: no web search (Exa, keyless,
      // or the provider's own), no URL fetching, no GitHub API.
      web_search: { enabled: false },
      fetch: { enabled: false },
      exa: { enabled: false },
      github: { enabled: false },
      providers: { webKeyless: false, cacheWarming: 'off' },
      // No MCP servers, extensions, skills, or plugins: none are inherited, and
      // none are discovered from the candidate's tree.
      mcp: { enableProjectConfig: false },
      extensions: [],
      skills: { enabled: false },
      marketplace: { autoUpdate: 'off' },
      // No updates, telemetry, or grievance uploads.
      startup: { checkUpdate: false, setupWizard: false },
      update: { auto: false },
      telemetry: { otlpExportEnabled: false },
      dev: { autoqa: false, autoqaConsent: 'denied' },
      // One model: a failed turn is retried on it, never on a fallback.
      retry: { modelFallback: false },
      recap: { enabled: false },
      memory: { backend: 'off' },
    }
    // The run's model, declared for omp: a model newer than omp's bundled
    // catalog would otherwise be found only by asking the gateway for its
    // model list at start-up, and an undeclared one gets omp's defaults for an
    // unknown model (128K context, 16K output), which would compact early and
    // cut turns short. The limits and the thinking surface are the ones omp's
    // catalog gives every Gemini 4 model on this provider, taken from the
    // gateway's own model rows: 1M context, 1M output ceiling, and thinking as
    // a token budget per level.
    // omp requires a provider that declares models to name its endpoint and
    // its key; `apiKey` is the name of the variable that holds it (here the
    // placeholder), never a key.
    const models = {
      providers: {
        [OMP_PROVIDER]: {
          baseUrl: `https://${AI_GATEWAY_HOST}`,
          apiKey: 'AI_GATEWAY_API_KEY',
          api: 'anthropic-messages',
          models: [{
            id: model.slug,
            api: 'anthropic-messages',
            baseUrl: `https://${AI_GATEWAY_HOST}`,
            reasoning: true,
            thinking: { mode: 'budget', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], requiresEffort: true },
            input: ['text', 'image'],
            contextWindow: 1_000_000,
            maxTokens: 1_000_000,
          }],
        },
      },
    }
    return [
      { path: '.omp/agent/config.yml', content: `${header}${toYaml(settings)}` },
      { path: '.omp/agent/models.yml', content: `${header}${toYaml(models)}` },
    ]
  },
  command(context) {
    if (Object.keys(context.mcpServers ?? {}).length > 0) throw new Error('--harness omp runs with no MCP servers')
    const model = ompModel(context.model)
    const thinking = ompThinking(context.effort)
    const common = [
      '--model', model.omp,
      ...(thinking ? ['--thinking', thinking] : []),
      '--cwd', BOX_WORKSPACE,
      '--approval-mode', 'yolo',
      // Auxiliary services (judge, spotlight) stay on the run's provider; no
      // title call; nothing loaded from outside the session.
      '--offline', '--no-title', '--no-extensions', '--no-skills',
      ...(context.extraArgs ?? []),
    ]
    // `--` ends the flags, so a message that starts with `-` or `@` is still
    // the message and never a flag or a file to attach.
    const message = context.prompt ? ['--', context.prompt] : []
    if (context.interactive) return ['omp', ...common, ...(context.resume ? ['--continue'] : []), ...message]
    return ['omp', '--print', ...common, ...(context.resume ? ['--continue'] : []), ...message]
  },
}

// Any other CLI. The operator names the model host(s) and which environment
// variable carries the credential; the launcher does the rest. This is how a
// harness without a dedicated adapter (Cursor, Grok, OpenCode, …) runs in the
// same box under the same gateway.
const custom = {
  label: 'Custom command',
  binary: null,
  verified: true,
  env: {},
  transcripts: [],
  authModes: [
    {
      id: 'custom',
      describe: '--secret-env NAME=host[,host] credentials are held by the gateway behind placeholders',
      detect: (env, options = {}) => ({ name: 'custom', value: { env, options } }),
      build(source) {
        const { env, options } = source.value
        const egress = String(options.egress ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
          const [host, mode] = entry.split('=')
          return { host, mode: mode === 'tunnel' ? 'tunnel' : 'inspect', paths: [] }
        })
        const boxEnv = {}
        const gatewaySecrets = []
        const leakCheck = []
        for (const entry of String(options['secret-env'] ?? '').split(';').map((value) => value.trim()).filter(Boolean)) {
          const [name, hosts] = entry.split('=')
          const value = env[name]?.trim()
          if (!value) throw new Error(`--secret-env names ${name}, which is not set in the environment`)
          if (!hosts) throw new Error(`--secret-env ${name} needs the host(s) the credential belongs to: ${name}=api.example.com`)
          const placeholder = placeholderFor(value)
          boxEnv[name] = placeholder
          gatewaySecrets.push({ placeholder, value, hosts: hosts.split(',') })
          leakCheck.push(value)
        }
        return { files: [], env: boxEnv, egress, gatewaySecrets, leakCheck, source: 'custom' }
      },
    },
  ],
  files: () => [],
  command(context) {
    if (!context.command) throw new Error('--harness custom requires --command "<shell command run inside the box>"')
    return ['sh', '-lc', context.command]
  },
}

export const HARNESSES = { codex, claude, omp, custom }

// Harnesses with no dedicated adapter yet, as starting points for
// `--harness custom`. None of these has been run end to end; the hosts are what
// each vendor documents, and the gateway's deny log shows what is missing.
export const HARNESS_PRESETS = {
  opencode: {
    label: 'OpenCode',
    image: 'EXTRA_NPM_GLOBALS="opencode-ai"',
    example: `--harness custom --egress api.anthropic.com --secret-env ANTHROPIC_API_KEY=api.anthropic.com --command 'opencode run "$(cat /workspace/PROMPT.md)"'`,
  },
  grok: {
    label: 'Grok CLI',
    image: 'EXTRA_NPM_GLOBALS="<the grok CLI package>"',
    example: `--harness custom --egress api.x.ai --secret-env XAI_API_KEY=api.x.ai --command 'grok -p "$(cat /workspace/PROMPT.md)"'`,
  },
  cursor: {
    label: 'Cursor Agent',
    image: 'install cursor-agent in a derived image',
    example: `--harness custom --egress api2.cursor.sh=tunnel --secret-env CURSOR_API_KEY=api2.cursor.sh --command 'cursor-agent -p --force "$(cat /workspace/PROMPT.md)"'`,
    caveat: 'Cursor runs its agent loop server-side over a proprietary protocol, so it needs tunnel mode: the gateway cannot strip hosted tools or pin the model, and the credential placeholder cannot be substituted. Treat a Cursor run as weaker than an inspected one.',
  },
}

export function resolveHarness(name) {
  const adapter = HARNESSES[name]
  if (!adapter) {
    const preset = HARNESS_PRESETS[name]
    if (preset) throw new Error(`${preset.label} has no dedicated adapter yet. Run it through the generic one: ${preset.example}${preset.caveat ? `\n${preset.caveat}` : ''}`)
    throw new Error(`Unknown harness "${name}". Known: ${Object.keys(HARNESSES).join(', ')} (presets: ${Object.keys(HARNESS_PRESETS).join(', ')})`)
  }
  return adapter
}

// Pick the auth mode: the one asked for, else the first that has a credential.
// Gateway-held modes are listed first, so they win when both are available.
export function resolveAuth(adapter, env, options = {}) {
  const modes = options.auth ? adapter.authModes.filter((mode) => mode.id === options.auth) : adapter.authModes
  if (options.auth && modes.length === 0) throw new Error(`${adapter.label} has no auth mode "${options.auth}" (known: ${adapter.authModes.map((mode) => mode.id).join(', ')})`)
  for (const mode of modes) {
    const source = mode.detect(env, options)
    if (source) return { id: mode.id, describe: mode.describe, ...mode.build(source) }
  }
  throw new Error(`No credential found for ${adapter.label}. Tried: ${modes.map((mode) => `${mode.id} (${mode.describe})`).join('; ')}`)
}
