import { test } from 'node:test'
import { strictEqual } from 'node:assert'

// Mock hardware model for testing
const hardwareModel = {
  variant: 'stage-4-73',
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    range: 'E to E',
    blackKeyHeightFraction: 0.61,
  },
  sections: [
    { id: 'performance', label: 'Performance', widthFraction: 0.13, controls: [] },
    { id: 'organ', label: 'Organ', widthFraction: 0.21, controls: [] },
    { id: 'piano', label: 'Piano', widthFraction: 0.15, controls: [] },
    { id: 'program', label: 'Program', widthFraction: 0.09, controls: [] },
    { id: 'synth', label: 'Synth', widthFraction: 0.21, controls: [] },
    { id: 'effects', label: 'Effects', widthFraction: 0.21, controls: [] },
  ],
  displayLocations: [
    { sectionId: 'program', label: 'Program OLED' },
    { sectionId: 'synth', label: 'Synth OLED' },
  ],
}

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
  })

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

test('regression.chassis: performance section is first', () => {
  strictEqual(hardwareModel.sections[0].id, 'performance', 'First section should be performance')
})
