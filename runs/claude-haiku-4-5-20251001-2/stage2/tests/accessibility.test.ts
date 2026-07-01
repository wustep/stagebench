import { test } from 'node:test'
import { strictEqual } from 'node:assert'
import { hardwareModel } from '../src/hardware'

test('accessibility.controls: all controls have labels', () => {
  for (const section of hardwareModel.sections) {
    for (const control of section.controls) {
      strictEqual(typeof control.label, 'string', `Control ${control.id} should have label`)
      strictEqual(control.label.length > 0, true, `Control ${control.id} label should not be empty`)
    }
  }
})

test('accessibility.controls: controls have explicit types for role mapping', () => {
  const validTypes = ['knob', 'button', 'led', 'drawbar', 'switch', 'encoder', 'wheel', 'fader']

  for (const section of hardwareModel.sections) {
    for (const control of section.controls) {
      strictEqual(
        validTypes.includes(control.type),
        true,
        `Control ${control.id} should have valid type: ${control.type}`
      )
    }
  }
})

test('accessibility.controls: knobs and encoders have value constraints', () => {
  for (const section of hardwareModel.sections) {
    for (const control of section.controls) {
      if (control.type === 'knob' || control.type === 'encoder' || control.type === 'wheel') {
        const c = control as any
        strictEqual(typeof c.value, 'number', `${control.id} should have numeric value`)
        strictEqual(typeof c.min, 'number', `${control.id} should have min`)
        strictEqual(typeof c.max, 'number', `${control.id} should have max`)
        strictEqual(c.value >= c.min && c.value <= c.max, true, `${control.id} value should be in range`)
      }
    }
  }
})
