import { test } from 'node:test'
import { strictEqual } from 'node:assert'
import { hardwareModel, sectionWidths } from '../src/hardware.ts'

test('visual.key-count: keyboard model has 73 keys', () => {
  strictEqual(hardwareModel.keyboard.totalKeys, 73, 'Total keys should be 73')
  strictEqual(hardwareModel.keyboard.whiteKeys, 43, 'Should have 43 white keys')
  strictEqual(hardwareModel.keyboard.blackKeys, 30, 'Should have 30 black keys')
  strictEqual(hardwareModel.keyboard.range, 'E to E', 'Range should be E to E')
})

test('visual.section-layout: six sections with correct width allocation', () => {
  strictEqual(hardwareModel.sections.length, 6, 'Should have exactly 6 sections')

  const expectedSections = ['performance', 'organ', 'piano', 'program', 'synth', 'effects']
  hardwareModel.sections.forEach((section, idx) => {
    strictEqual(section.id, expectedSections[idx], `Section ${idx} id should be ${expectedSections[idx]}`)
    strictEqual(section.widthFraction, Object.values(sectionWidths)[idx], `Width should match spec`)
  })

  // Check total width
  const totalWidth = hardwareModel.sections.reduce((sum, s) => sum + s.widthFraction, 0)
  strictEqual(Math.abs(totalWidth - 1.0) < 0.01, true, 'Total width should equal 1.0')
})

test('visual.control-inventory: only Program and Synth have OLED displays', () => {
  const displayLocations = hardwareModel.displayLocations.map(loc => loc.sectionId)

  strictEqual(displayLocations.includes('program'), true, 'Program should have OLED')
  strictEqual(displayLocations.includes('synth'), true, 'Synth should have OLED')

  strictEqual(displayLocations.includes('organ'), false, 'Organ should NOT have OLED')
  strictEqual(displayLocations.includes('piano'), false, 'Piano should NOT have OLED')
  strictEqual(displayLocations.includes('effects'), false, 'Effects should NOT have OLED')
})

test('visual.control-inventory: all controls have stable IDs', () => {
  const ids = new Set<string>()

  for (const section of hardwareModel.sections) {
    for (const control of section.controls) {
      strictEqual(typeof control.id, 'string', `Control should have string id: ${control.id}`)
      strictEqual(!ids.has(control.id), true, `Control id should be unique: ${control.id}`)
      ids.add(control.id)
    }
  }

  strictEqual(ids.size > 0, true, 'Should have at least one control')
})

test('regression.chassis: performance section has no OLED panel', () => {
  const performanceSection = hardwareModel.sections.find(s => s.id === 'performance')
  strictEqual(performanceSection !== undefined, true, 'Performance section should exist')

  const hasOled = performanceSection!.controls.some(c => c.type === 'display')
  strictEqual(hasOled, false, 'Performance section should not have OLED display')
})
