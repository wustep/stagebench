import { test } from 'node:test'
import { strictEqual } from 'node:assert'

const controls = [
  { id: 'knob-1', label: 'Knob 1', type: 'knob', value: 50, min: 0, max: 100 },
  { id: 'button-1', label: 'Button 1', type: 'button', active: false },
  { id: 'encoder-1', label: 'Encoder 1', type: 'encoder', value: 0, min: 0, max: 200 },
]

test('accessibility.controls: all controls have labels', () => {
  for (const control of controls) {
    strictEqual(typeof control.label, 'string', `Control ${control.id} should have label`)
    strictEqual(control.label.length > 0, true, `Control ${control.id} label should not be empty`)
  }
})

test('accessibility.controls: controls have explicit types for role mapping', () => {
  const validTypes = ['knob', 'button', 'led', 'drawbar', 'switch', 'encoder', 'wheel', 'fader']

  for (const control of controls) {
    strictEqual(
      validTypes.includes(control.type),
      true,
      `Control ${control.id} should have valid type: ${control.type}`
    )
  }
})

test('accessibility.controls: knobs and encoders have value constraints', () => {
  for (const control of controls) {
    if (control.type === 'knob' || control.type === 'encoder' || control.type === 'wheel') {
      strictEqual(typeof control.value, 'number', `${control.id} should have numeric value`)
      strictEqual(typeof control.min, 'number', `${control.id} should have min`)
      strictEqual(typeof control.max, 'number', `${control.id} should have max`)
      strictEqual(
        control.value >= control.min && control.value <= control.max,
        true,
        `${control.id} value should be in range`
      )
    }
  }
})
