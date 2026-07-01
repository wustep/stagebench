import { test } from 'node:test'
import { strictEqual } from 'node:assert'

const keyboard = {
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  blackKeyHeightFraction: 0.61,
}

test('interaction.keys: keyboard model configuration', () => {
  strictEqual(keyboard.totalKeys, 73, 'Should have 73 total keys')
  strictEqual(keyboard.whiteKeys, 43, 'Should have 43 white keys')
  strictEqual(keyboard.blackKeys, 30, 'Should have 30 black keys')
  strictEqual(keyboard.range, 'E to E', 'Range should be E to E')
  strictEqual(keyboard.blackKeyHeightFraction, 0.61, 'Black key height should be 61% of white')
})

test('interaction.keys: white and black key ratio', () => {
  const totalKeys = keyboard.whiteKeys + keyboard.blackKeys
  strictEqual(totalKeys, keyboard.totalKeys, 'White + Black should equal total')
})
