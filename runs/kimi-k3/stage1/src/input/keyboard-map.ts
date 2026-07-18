/**
 * Computer-keyboard → note map. Two rows like a tracker layout:
 *   lower row  z s x d c v g b h n j m ,  → C3 …
 *   upper row  q 2 w 3 e r 5 t 6 y 7 u i  → C4 …
 * Plus space = sustain pedal (labeled, honest approximation of the UI pedal).
 */
export const KEY_TO_NOTE: ReadonlyMap<string, number> = new Map([
  ['z', 48], ['s', 49], ['x', 50], ['d', 51], ['c', 52], ['v', 53], ['g', 54], ['b', 55],
  ['h', 56], ['n', 57], ['j', 58], ['m', 59], [',', 60],
  ['q', 60], ['2', 61], ['w', 62], ['3', 63], ['e', 64], ['r', 65], ['5', 66], ['t', 67],
  ['6', 68], ['y', 69], ['7', 70], ['u', 71], ['i', 72],
])

export const SUSTAIN_KEY = ' ' // spacebar
export const MAPPED_VELOCITY = 0.8
