#!/usr/bin/env node
// Recompute honest token/cost telemetry from Claude Code subagent JSONL
// transcripts and print a ready-to-paste `pnpm bench telemetry` command.
//
// The run-completion notification's `subagent_tokens` is the final context
// size, not generated tokens, so it overstates usage. This sums the real
// per-turn output_tokens (and input + cache tokens) from the transcript.
//
// Usage:
//   node scripts/parse-subagent-telemetry.mjs <transcript.jsonl> [more.jsonl ...]
//   node scripts/parse-subagent-telemetry.mjs --run <id> --phase <N> <files...>
import { fileURLToPath } from 'node:url'
import { parseSubagentTelemetryFiles } from '../bench/lib/telemetry-jsonl.mjs'

function main(argv) {
  const files = []
  let run
  let phase
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--run') run = argv[++i]
    else if (arg === '--phase') phase = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/parse-subagent-telemetry.mjs [--run <id> --phase <N>] <transcript.jsonl ...>')
      return 0
    } else files.push(arg)
  }

  if (files.length === 0) {
    console.error('No transcript files given. Pass one or more Claude Code subagent .jsonl paths.')
    return 1
  }

  const parsed = parseSubagentTelemetryFiles(files)
  if (!parsed.ok) {
    console.error(`Could not compute telemetry: ${parsed.reason} (read ${parsed.lines} lines, skipped ${parsed.skipped}).`)
    return 1
  }

  console.log('Parsed', files.length, 'transcript file(s):')
  console.log(`  assistant turns : ${parsed.assistantTurns}`)
  console.log(`  input tokens    : ${parsed.inputTokens} (prompt ${parsed.breakdown.promptInput}, cache-create ${parsed.breakdown.cacheCreation}, cache-read ${parsed.breakdown.cacheRead})`)
  console.log(`  output tokens   : ${parsed.outputTokens}`)
  console.log(`  total tokens    : ${parsed.totalTokens}`)
  console.log(`  cost (USD)      : ${parsed.costUsd === null ? 'not in transcript' : parsed.costUsd}`)
  if (parsed.skipped > 0) console.log(`  (skipped ${parsed.skipped} unparseable line(s))`)

  const flags = [
    `--input-tokens ${parsed.inputTokens}`,
    `--output-tokens ${parsed.outputTokens}`,
    `--total-tokens ${parsed.totalTokens}`,
    parsed.costUsd !== null ? `--cost-usd ${parsed.costUsd}` : null,
  ].filter(Boolean).join(' ')
  const target = run && phase ? `${run} --phase ${phase} ` : '<run-id> --phase <N> '
  console.log('\nRecord it with:')
  console.log(`  pnpm bench telemetry ${target}${flags}`)
  console.log('\n(Reasoning tokens are not in the transcript — Claude bills thinking as output. Add --reasoning-tokens by hand only if you have a separate figure.)')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
export { main }
