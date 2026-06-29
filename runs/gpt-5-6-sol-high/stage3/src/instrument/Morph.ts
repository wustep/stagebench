export type MorphSource = 'wheel' | 'aftertouch' | 'pedal'
export interface MorphAssignment { source: MorphSource; target: string; from: number; to: number; min: number; max: number }
export class MorphMatrix {
  private assignments = new Map<string, MorphAssignment>()
  assign(assignment: MorphAssignment) { this.assignments.set(`${assignment.source}:${assignment.target}`, { ...assignment }) }
  remove(source: MorphSource, target: string) { return this.assignments.delete(`${source}:${target}`) }
  clear(source?: MorphSource) { if (!source) this.assignments.clear(); else for (const [key, assignment] of this.assignments) if (assignment.source === source) this.assignments.delete(key) }
  values(source: MorphSource, amount: number) {
    const normalized = Math.min(1, Math.max(0, amount))
    return Object.fromEntries([...this.assignments.values()].filter((assignment) => assignment.source === source).map((assignment) => {
      const value = assignment.from + (assignment.to - assignment.from) * normalized
      return [assignment.target, Math.min(assignment.max, Math.max(assignment.min, value))]
    }))
  }
  snapshot() { return [...this.assignments.values()].map((assignment) => ({ ...assignment })) }
  restore(assignments: MorphAssignment[]) { this.assignments = new Map(assignments.map((assignment) => [`${assignment.source}:${assignment.target}`, { ...assignment }])) }
}
