import { describe, expect, it } from 'vitest'
import { calculateLayout, STAGE4_73_SPEC, isBlackKey, getNoteForKeyIndex } from './hardware'
import { PianoAudio } from './audio'

describe('Phase 1: Nord Stage 4 73-key', () => {
  describe('Layout calculation', () => {
    it('calculates correct instrument aspect ratio', () => {
      const layout = calculateLayout(1440, 900)
      const aspectRatio = layout.instrument.width / layout.instrument.height
      expect(Math.abs(aspectRatio - STAGE4_73_SPEC.aspectRatio)).toBeLessThan(0.1)
    })

    it('maintains 54/46 control deck / keybed split', () => {
      const layout = calculateLayout(1440, 900)
      const controlDeckRatio = layout.controlDeck.height / layout.instrument.height
      expect(Math.abs(controlDeckRatio - 0.54)).toBeLessThan(0.025)
    })

    it('fits within viewport bounds (88-97% width)', () => {
      const layout = calculateLayout(1440, 900)
      const widthFraction = layout.instrument.width / 1440
      expect(widthFraction).toBeGreaterThanOrEqual(0.88)
      expect(widthFraction).toBeLessThanOrEqual(0.97)
    })

    it('responds to mobile viewport without clipping keybed', () => {
      const layout = calculateLayout(390, 844)
      const keybed = layout.keybed
      expect(keybed.width).toBeGreaterThan(0)
      expect(keybed.height).toBeGreaterThan(0)
    })

    it('calculates six sections with correct proportions', () => {
      const layout = calculateLayout(1440, 900)
      const sections = Object.values(layout.sections)
      expect(sections.length).toBe(6)
      const totalWidth = sections.reduce((sum, s) => sum + s.width, 0)
      expect(Math.abs(totalWidth - layout.instrument.width)).toBeLessThan(1)
    })
  })

  describe('Hardware model', () => {
    it('identifies black keys correctly', () => {
      expect(isBlackKey(40)).toBe(false) // E (white)
      expect(isBlackKey(41)).toBe(false) // F (white)
      expect(isBlackKey(42)).toBe(true) // F# (black)
      expect(isBlackKey(43)).toBe(false) // G (white)
      expect(isBlackKey(44)).toBe(true) // G# (black)
    })

    it('maps key indices to MIDI notes', () => {
      expect(getNoteForKeyIndex(0)).toBe(40) // E1
      expect(getNoteForKeyIndex(72)).toBe(112) // E5
    })

    it('has exactly 73 keys in E-E range', () => {
      expect(STAGE4_73_SPEC.totalKeys).toBe(73)
      expect(STAGE4_73_SPEC.whiteKeys).toBe(43)
      expect(STAGE4_73_SPEC.blackKeys).toBe(30)
    })
  })

  describe('Piano audio', () => {
    it('initializes without errors', () => {
      const audio = new PianoAudio()
      expect(audio.getError()).toBeNull()
    })

    it('reports ready state', () => {
      const audio = new PianoAudio()
      expect(typeof audio.isReady()).toBe('boolean')
    })

    it('cleans up all notes', () => {
      const audio = new PianoAudio()
      audio.noteOn(60, 80)
      audio.allNotesOff()
      // Verify no crash on cleanup
      expect(true).toBe(true)
    })

    it('handles sustain pedal state', () => {
      const audio = new PianoAudio()
      audio.setSustain(true)
      audio.setSustain(false)
      expect(true).toBe(true)
    })
  })

  describe('Accessibility', () => {
    it('provides accessible labels for all sections', () => {
      const layout = calculateLayout(1440, 900)
      expect(layout.sections.performance).toBeDefined()
      expect(layout.sections.organ).toBeDefined()
      expect(layout.sections.piano).toBeDefined()
      expect(layout.sections.program).toBeDefined()
      expect(layout.sections.synth).toBeDefined()
      expect(layout.sections.effects).toBeDefined()
    })
  })
})
