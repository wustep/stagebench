// Projections of benchmark materials for isolated workspaces. Both the
// implementation and evaluator workspaces receive TASK.md and the phase
// manifest filtered to the phases the run has reached, and only the assigned
// hardware variant — never future phase details, unassigned variants, or
// scoring internals.

const PHASE_BLOCK = /[ \t]*<!--\s*stagebench:phase-(\d+)\s*-->\n([\s\S]*?)[ \t]*<!--\s*\/stagebench:phase-\1\s*-->\n?/g

// Drop the marked per-phase blocks for phases after `phase`, and strip the
// marker comments from the blocks that remain.
export function filterTaskToPhase(markdown, phase) {
  return markdown
    .replace(PHASE_BLOCK, (match, number, body) => (Number(number) <= Number(phase) ? body : ''))
    .replace(/\n{3,}/g, '\n\n')
}

// The phase manifest with only the contracts for phases ≤ `phase`. Harness
// bookkeeping ($schema, target selection) is dropped, and defaultVariant is
// pinned to the assigned variant so it never names one the candidate's
// filtered variant registry omits.
export function projectProtocol(protocol, phase, variantId) {
  const { $schema: _schema, selection: _selection, ...rest } = protocol
  return {
    ...rest,
    ...(variantId ? { defaultVariant: variantId } : {}),
    note: `Workspace copy filtered to phases 1-${phase}; later phases are provided when they start.`,
    phases: protocol.phases.filter((entry) => entry.number <= Number(phase)),
  }
}

// The variant registry reduced to the single assigned variant.
export function projectVariants(variants, variantId) {
  const variant = variants.variants.find((entry) => entry.id === variantId)
  if (!variant) throw new Error(`Unknown run variant: ${variantId}`)
  const { default: _default, ...rest } = variants
  return {
    ...rest,
    note: 'Workspace copy filtered to the assigned variant.',
    variants: [variant],
  }
}
