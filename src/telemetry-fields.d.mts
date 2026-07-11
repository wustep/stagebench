// Type declarations for telemetry-fields.mjs, the single canonical telemetry
// vocabulary shared by the bench harness and the Vite gallery.
import type { Telemetry } from './types'

export const TELEMETRY_FIELDS: Array<keyof Telemetry>
export const TELEMETRY_FLAGS: Record<string, keyof Telemetry>
export function roundTelemetryValue(value: number): number
