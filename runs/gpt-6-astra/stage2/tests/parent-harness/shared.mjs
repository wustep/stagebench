// Local JSON serializer used by the vendored parent capture module.
import fs from 'node:fs'
export function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
