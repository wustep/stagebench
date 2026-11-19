// Secret scrubbing for archived agent transcripts. Transcripts are committed
// into runs/<id>/transcripts/, so before any byte is written there every
// string is passed through these rules and each hit is replaced with a stable
// `***REDACTED_<KIND>***` placeholder. Only counts per kind are ever reported —
// never the matched value.
//
// The rules lean toward redacting when a pattern is ambiguous: a transcript
// that loses a token-shaped string is still an audit record; one that leaks a
// credential is not publishable. They deliberately leave workspace paths,
// digests, and ordinary code alone so transcripts stay useful.

const placeholder = (kind) => `***REDACTED_${kind}***`

// Values that look like credentials only by their shape: unambiguous vendor
// prefixes. Each entry is [kind, regex]; the whole match is replaced.
const TOKEN_RULES = [
  ['PRIVATE_KEY', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g],
  ['ANTHROPIC_KEY', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{16,}/g],
  ['OPENAI_KEY', /(?<![A-Za-z0-9])sk-(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{20,}/g],
  ['GITHUB_TOKEN', /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['SLACK_TOKEN', /(?<![A-Za-z0-9])xox[abprse]-[A-Za-z0-9-]{10,}/g],
  ['AWS_ACCESS_KEY', /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g],
  ['GOOGLE_API_KEY', /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g],
  ['STRIPE_KEY', /(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['NPM_TOKEN', /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g],
  ['HF_TOKEN', /(?<![A-Za-z0-9])hf_[A-Za-z0-9]{30,}/g],
  ['VERCEL_TOKEN', /(?<![A-Za-z0-9])vercel_[A-Za-z0-9_-]{20,}/g],
  ['AI_GATEWAY_KEY', /(?<![A-Za-z0-9])vck_[A-Za-z0-9_-]{20,}/g],
  ['JWT', /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
]

// Contextual rules: a header or assignment whose *name* says it holds a
// secret. Group 1 (the name and separator) is kept, the value is replaced, so
// the transcript still shows which credential was involved. Values stop at
// quotes and backslashes so a redaction never breaks the surrounding JSON
// string escaping.
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|passwd|private[_-]?key|access[_-]?key|client[_-]?secret|credential|session[_-]?key|cookie)[A-Za-z0-9_.-]*`
const CONTEXT_RULES = [
  // Authorization: Bearer abc / Proxy-Authorization: Basic abc / "authorization": "token abc"
  ['AUTH_HEADER', /((?:proxy-)?authorization\\*["']?\s*[:=]\s*\\*["']?\s*(?:bearer|basic|token|digest)?\s*)([^\s"'\\,}]{6,})/gi],
  ['AUTH_HEADER', /(\bbearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi],
  ['API_KEY_HEADER', /((?:x-api-key|x-goog-api-key|api-key|x-auth-token)\\*["']?\s*[:=]\s*\\*["']?\s*)([^\s"'\\,}]{6,})/gi],
  ['COOKIE', /((?:^|[\s"'{,])(?:set-)?cookie\\*["']?\s*[:=]\s*\\*["']?)([^"'\\\n]{8,})/gi],
  // URL credentials: https://user:secret@host
  ['URL_CREDENTIALS', /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@"'\\]+:[^\s/@"'\\]+)(?=@)/gi],
  // KEY=value / "apiKey": "value" / password: value. The value must look like
  // a credential, not a placeholder, number, boolean, or variable reference.
  ['SECRET_ASSIGNMENT', new RegExp(String.raw`(\b${SECRET_NAME}\\*["']?\s*(?::|=|:=)\s*\\*["']?)(?![$<{*%]|process\.env|import\.meta|env\.|os\.environ|null\b|true\b|false\b|undefined\b|none\b|REDACTED|\*\*\*)([^\s"'\\,;}{)(\]\[]{8,})`, 'gi')],
]

// Personal contact details: email addresses other than well-known
// non-personal senders. Kept separate so callers can count them distinctly.
const EMAIL_ALLOW = /(?:^noreply@|@users\.noreply\.github\.com$|@example\.(?:com|org|net)$|@anthropic\.com$|@openai\.com$)/i
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g

// Values that a contextual rule would otherwise catch but that are clearly not
// credentials (token counts, design tokens, identifiers, file paths, CSS).
// Real credentials nearly always carry digits; a digit-free identifier such as
// `options.apiKeyValue`, `++this.loadToken` or `TokenType` is code, not a secret.
function looksBenign(kind, prefix, rawValue) {
  if (kind === 'URL_CREDENTIALS' || kind === 'COOKIE') return false
  if (kind === 'AUTH_HEADER' || kind === 'API_KEY_HEADER') {
    // "Authorization: Bearer" / "Header" / "<token>": words, not tokens.
    return /^[A-Za-z]{1,15}$/.test(rawValue)
  }
  const value = rawValue.replace(/^(?:\+\+|--|!+)/, '')
  if (/^[0-9.,_-]+$/.test(value)) return true // numbers, counts
  if (/^[a-z]+(?:[-_][a-z]+)+$/.test(value) && value.length < 32) return true // kebab/snake words: "max-tokens", "design_token"
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value) && !/\d/.test(value)) return true // member expressions
  if (/^[A-Za-z_$][\w$]*$/.test(value) && /[a-z][A-Z]/.test(value) && !/\d/.test(value)) return true // camelCase identifiers
  // A bare word after "tokens:" is a design-token or token-count label, not a
  // credential; after "password:"/"secret:" the same word stays redacted.
  if (/tokens?\W*$/i.test(prefix) && /^[A-Za-z]+$/.test(value)) return true
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')) return true // paths
  if (/^(?:var|calc|rgba?|hsla?)\(/.test(value)) return true
  return false
}

function count(redactions, kind) {
  redactions[kind] = (redactions[kind] ?? 0) + 1
}

// Scrub one string. Returns the scrubbed string; hit counts accumulate into
// `redactions` ({ KIND: n }).
export function scrubText(input, redactions = {}) {
  if (typeof input !== 'string' || input.length === 0) return input
  let text = input
  for (const [kind, pattern] of TOKEN_RULES) {
    text = text.replace(pattern, () => {
      count(redactions, kind)
      return placeholder(kind)
    })
  }
  for (const [kind, pattern] of CONTEXT_RULES) {
    text = text.replace(pattern, (match, prefix, value) => {
      if (value.includes('***REDACTED_')) return match
      if (looksBenign(kind, prefix, value)) return match
      count(redactions, kind)
      return `${prefix}${placeholder(kind)}`
    })
  }
  text = text.replace(EMAIL, (match) => {
    if (EMAIL_ALLOW.test(match)) return match
    count(redactions, 'EMAIL')
    return placeholder('EMAIL')
  })
  return text
}

// Keys whose values are opaque payloads, not prose: base64 image data and
// provider-encrypted reasoning. Regexes over megabytes of base64 can only
// produce false positives (and would corrupt the image), so they are skipped.
const OPAQUE_KEYS = new Set(['encrypted_content'])
// Account identifiers the agent runtime stamps into session metadata. Not
// credentials, but they identify the operator's account, so they are dropped.
const ACCOUNT_KEYS = new Set(['creator_user_id', 'creator_account_id', 'account_id', 'accountUuid', 'organizationUuid', 'user_id', 'userID', 'email'])

function isOpaqueString(value) {
  return value.length > 512 && /^data:(?:image|audio|video|application\/octet-stream)\/?[^;,]*;base64,/.test(value)
}

function scrubValue(value, redactions) {
  if (typeof value === 'string') {
    if (isOpaqueString(value)) return value
    return scrubText(value, redactions)
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, redactions))
  if (value && typeof value === 'object') {
    const isBase64Source = value.type === 'base64' && typeof value.data === 'string'
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      if (OPAQUE_KEYS.has(key) || (isBase64Source && key === 'data')) {
        out[key] = child
      } else if (ACCOUNT_KEYS.has(key) && typeof child === 'string' && child.length > 0 && !child.includes('***REDACTED_')) {
        count(redactions, 'ACCOUNT_ID')
        out[key] = placeholder('ACCOUNT_ID')
      } else {
        out[key] = scrubValue(child, redactions)
      }
    }
    return out
  }
  return value
}

// Scrub a JSON Lines document. Each line is parsed and every string value is
// scrubbed structurally (so secrets inside escaped JSON-in-JSON are seen
// unescaped once); a line with no hits keeps its original bytes, a line with
// hits is re-serialized. Lines that are not JSON are scrubbed as text. The
// output is always valid JSONL wherever the input was.
export function scrubJsonl(input) {
  const redactions = {}
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input)
  const lines = text.split('\n')
  let changedLines = 0
  let unparsableLines = 0
  const out = lines.map((line) => {
    if (line.trim() === '') return line
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      unparsableLines++
      const before = Object.values(redactions).reduce((sum, n) => sum + n, 0)
      const scrubbed = scrubText(line, redactions)
      if (Object.values(redactions).reduce((sum, n) => sum + n, 0) !== before) changedLines++
      return scrubbed
    }
    const local = {}
    const scrubbed = scrubValue(parsed, local)
    if (Object.keys(local).length === 0) return line
    for (const [kind, n] of Object.entries(local)) redactions[kind] = (redactions[kind] ?? 0) + n
    changedLines++
    return JSON.stringify(scrubbed)
  })
  return { text: out.join('\n'), redactions, changedLines, unparsableLines }
}

// Scrub any archived file by its type: JSON Lines structurally, JSON as one
// document, everything else as text.
export function scrubFile(name, input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input)
  if (/\.jsonl$/i.test(name)) return scrubJsonl(text)
  if (/\.json$/i.test(name)) {
    try {
      const redactions = {}
      const scrubbed = scrubValue(JSON.parse(text), redactions)
      return { text: Object.keys(redactions).length ? `${JSON.stringify(scrubbed, null, 2)}\n` : text, redactions, changedLines: 0, unparsableLines: 0 }
    } catch {
      // fall through to text
    }
  }
  const redactions = {}
  return { text: scrubText(text, redactions), redactions, changedLines: 0, unparsableLines: 0 }
}

// Last line of defence: scrubbing is idempotent (placeholders match no rule),
// so a second pass over already-scrubbed output must find nothing. Returns the
// kinds still found, which callers treat as a hard error.
export function residualSecretKinds(name, scrubbedText) {
  return Object.keys(scrubFile(name, scrubbedText).redactions)
}
