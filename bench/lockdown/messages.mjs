// Everything an operator may say to a boxed agent.
//
// In the audited runs the operator's words were part of the experiment and
// nobody had written them down: a prompt that banned writes and forgot reads, a
// pasted list of hard gates, "fix the 3 failing tests". Under protocol 3 an
// operator does not compose messages. They pick one of the templates below; the
// launcher fills it in from the harness's own records and writes the result
// into the run. A message that is not a template can still be sent, but only
// by saying so (`--off-protocol-message`), and the phase is marked for it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sha256, stagebenchHome } from '../lib/shared.mjs'

const GATES = 'pnpm test, pnpm typecheck, pnpm lint, and pnpm build'

export const CANDIDATE_MESSAGES = {
  initial: {
    describe: 'The first message of a phase. Sent automatically.',
    followUp: false,
    text: ({ workspace }) => `Read WORKSPACE.md in ${workspace} and follow it exactly. Implement this phase according to the instructions in inputs/, working only inside candidate/. Everything you may use is in this workspace: there is no internet, and nothing outside it is yours to read. Before you finish, run all four package gates inside candidate/: ${GATES}, and fix any failures. When you are done, report a brief summary of what you implemented and the result of each gate.`,
  },
  continue: {
    describe: 'The previous session ended before the phase was finished (timeout, crash, or usage limit).',
    followUp: true,
    text: () => `Continue. Your previous session ended before this phase was finished. Pick up where you left off and finish the phase exactly as WORKSPACE.md describes. Before you finish, run all four package gates inside candidate/: ${GATES}, and fix any failures. When you are done, report a brief summary of what you implemented and the result of each gate.`,
  },
  'seal-failure': {
    describe: 'The seal failed. Relays the seal\'s own output, verbatim, and nothing else.',
    followUp: true,
    text: ({ failure }) => {
      if (!failure) throw new Error('There is no recorded seal failure to relay. Run pnpm bench seal first; this message can only carry what the seal itself printed.')
      return `The operator tried to seal this phase and the seal failed. Its output is below, verbatim. Fix what it names, then run all four package gates inside candidate/ again (${GATES}) and report what you changed. Do not change anything it does not name.\n\n--- seal output ---\n${failure}\n--- end of seal output ---`
    },
  },
}

export const EVALUATOR_MESSAGES = {
  evaluate: {
    describe: 'The first message of an evaluation. Sent automatically.',
    followUp: false,
    text: ({ workspace }) => `Read EVAL.md in ${workspace} and follow it exactly. Work only inside ${workspace}. Fill in assessment.json completely, then stop.`,
  },
  review: {
    describe: 'An independent review of a filled assessment, by a fresh agent in the same box.',
    followUp: true,
    fresh: true,
    text: ({ workspace }) => `You are an independent reviewer. Another evaluator has filled in assessment.json in ${workspace} by following EVAL.md. Read EVAL.md, then check every rating and measurement in assessment.json against artifact/, build/, and inputs/: is it fair, and is it grounded in concrete evidence? Correct any rating or measurement that is unsupported, overstated, or too harsh by editing assessment.json in place, adding an evidence item that says what you changed and why. Leave the rest as it is. Work only inside ${workspace}.`,
  },
  continue: {
    describe: 'The previous evaluator session ended before the assessment was complete.',
    followUp: true,
    text: () => 'Continue. Your previous session ended before the assessment was complete. Pick up where you left off, follow EVAL.md, fill in assessment.json completely, then stop.',
  },
}

// Host paths and the run's name have no business inside the box: a seal error
// can quote either. Both are replaced before the text is stored or sent.
export function neutralizeFailure(text, { root, id, stageDir } = {}) {
  let result = String(text ?? '')
  const replace = (needle, replacement) => { if (needle && needle.length > 2) result = result.split(needle).join(replacement) }
  replace(stageDir, 'candidate')
  replace(root ? path.join(root, 'runs', id ?? '') : null, '<run>')
  replace(root, '<repository>')
  replace(stagebenchHome(), '<stagebench-home>')
  replace(os.homedir(), '~')
  replace(id, '<run>')
  // Long enough to carry a failing test's output, short enough to be a message.
  return result.length > 12_000 ? `${result.slice(0, 2_000)}\n…\n${result.slice(-10_000)}` : result
}

export function sealFailurePath(stateDir) {
  return path.join(stateDir, 'last-seal-failure.txt')
}

export function recordSealFailure(stateDir, text, context) {
  fs.mkdirSync(stateDir, { recursive: true })
  const neutral = neutralizeFailure(text, context)
  fs.writeFileSync(sealFailurePath(stateDir), neutral)
  return neutral
}

export function readSealFailure(stateDir) {
  const file = sealFailurePath(stateDir)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

// Decide what this launch says. Returns { template, text, offProtocol }.
//   policy 'template'  protocol 3: a template, or an explicit off-protocol message
//   policy 'free'      anything (red-team sessions, runs from before protocol 3)
export function resolveMessage(templates, { options = {}, followUp, interactive, policy = 'template', context = {} }) {
  const free = options.prompt ?? (options['prompt-file'] ? fs.readFileSync(options['prompt-file'], 'utf8') : null)
  const offProtocol = options['off-protocol-message'] ?? null
  const name = options.message ?? null
  if (offProtocol !== null) {
    const text = offProtocol === 'true' ? free : String(offProtocol)
    if (!text) throw new Error('--off-protocol-message needs the message text')
    return { template: 'off-protocol', text, offProtocol: true }
  }
  if (free !== null) {
    if (policy === 'template') {
      throw new Error(`Operator messages follow a fixed template under protocol 3: use --message <${Object.entries(templates).filter(([, entry]) => entry.followUp).map(([key]) => key).join('|')}>. To send your own words anyway, pass them as --off-protocol-message "..."; the phase is then marked as off-protocol in the run record and the gallery.`)
    }
    return { template: 'free', text: free, offProtocol: false }
  }
  if (name) {
    const entry = templates[name]
    if (!entry || (followUp && !entry.followUp) || (!followUp && entry.followUp)) {
      throw new Error(`--message must be one of: ${Object.entries(templates).filter(([, candidate]) => Boolean(candidate.followUp) === Boolean(followUp)).map(([key, candidate]) => `${key} (${candidate.describe})`).join('; ')}`)
    }
    return { template: name, text: entry.text(context), offProtocol: false }
  }
  if (!followUp) {
    const [first, entry] = Object.entries(templates).find(([, candidate]) => !candidate.followUp)
    return { template: first, text: entry.text(context), offProtocol: false }
  }
  if (interactive) return { template: 'interactive', text: null, offProtocol: policy === 'template' }
  throw new Error(`A follow-up launch needs --message <${Object.entries(templates).filter(([, entry]) => entry.followUp).map(([key]) => key).join('|')}>`)
}

export function messageRecord(message) {
  return { template: message.template, offProtocol: Boolean(message.offProtocol), sha256: message.text ? sha256(message.text) : null, text: message.text }
}
