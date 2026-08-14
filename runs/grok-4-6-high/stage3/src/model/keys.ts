import { VARIANT, isBlackMidi, noteName } from './variant'

export interface KeyDef {
  midi: number
  name: string
  black: boolean
  whiteIndex: number
  id: string
}

export function buildKeybed(): KeyDef[] {
  const keys: KeyDef[] = []
  let whiteIndex = -1
  for (let midi = VARIANT.midiMin; midi <= VARIANT.midiMax; midi++) {
    const black = isBlackMidi(midi)
    if (!black) whiteIndex += 1
    keys.push({
      midi,
      name: noteName(midi),
      black,
      whiteIndex: black ? whiteIndex : whiteIndex,
      id: `key-${midi}`,
    })
  }
  return keys
}

export const KEYBED = buildKeybed()
export const WHITE_KEYS = KEYBED.filter((k) => !k.black)
export const BLACK_KEYS = KEYBED.filter((k) => k.black)

export function blackKeyLeftPercent(key: KeyDef, blackWidthFractionOfWhite: number): number {
  const whiteCount = WHITE_KEYS.length
  const whiteWidth = 100 / whiteCount
  const blackWidth = whiteWidth * blackWidthFractionOfWhite
  return (key.whiteIndex + 1) * whiteWidth - blackWidth / 2
}
