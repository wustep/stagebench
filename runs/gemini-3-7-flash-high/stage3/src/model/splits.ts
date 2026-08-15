export type SplitPointName = 'Low' | 'Mid' | 'High';

export const SPLIT_POSITIONS = [
  'C2',
  'F2',
  'C3',
  'F3',
  'C4',
  'F4',
  'C5',
  'F5',
  'C6',
  'F6',
  'C7',
] as const;

export type SplitPosition = typeof SPLIT_POSITIONS[number];

// MIDI note numbers for the 11 positions
export const SPLIT_POSITION_MIDIS: Record<SplitPosition, number> = {
  C2: 36,
  F2: 41,
  C3: 48,
  F3: 53,
  C4: 60,
  F4: 65,
  C5: 72,
  F5: 77,
  C6: 84,
  F6: 89,
  C7: 96,
};

export type CrossfadeWidth = 0 | 6 | 12;

export interface SplitConfig {
  enabled: boolean;
  lowSplitActive: boolean;
  lowPosition: SplitPosition;
  lowCrossfade: CrossfadeWidth;

  midSplitActive: boolean;
  midPosition: SplitPosition;
  midCrossfade: CrossfadeWidth;

  highSplitActive: boolean;
  highPosition: SplitPosition;
  highCrossfade: CrossfadeWidth;
}

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  enabled: false,
  lowSplitActive: false,
  lowPosition: 'C3',
  lowCrossfade: 0,

  midSplitActive: true, // Default split point is Mid at C4
  midPosition: 'C4',
  midCrossfade: 0,

  highSplitActive: false,
  highPosition: 'C5',
  highCrossfade: 0,
};

export type ZoneIndex = 0 | 1 | 2 | 3; // 4 zones: 1, 2, 3, 4 (0-indexed: 0, 1, 2, 3)

export interface LayerZoneAssignment {
  zone1: boolean; // Low / Zone 1
  zone2: boolean; // Low-Mid / Zone 2
  zone3: boolean; // Mid-High / Zone 3
  zone4: boolean; // High / Zone 4
}

export const ALL_ZONES_ASSIGNMENT: LayerZoneAssignment = {
  zone1: true,
  zone2: true,
  zone3: true,
  zone4: true,
};

/**
 * Calculates which zones are active based on active split points,
 * and determines the effective gain multiplier (0..1) for a given MIDI note
 * taking crossfade width (0, 6, 12 semitones) into account.
 */
export function calculateNoteZoneGains(
  midi: number,
  splits: SplitConfig,
  assignment: LayerZoneAssignment
): number {
  if (!splits.enabled) {
    // If splits are disabled, full keyboard is accessible to all enabled layers
    return 1.0;
  }

  // Determine active split boundaries in MIDI notes
  const activeBoundaries: Array<{ midi: number; crossfade: CrossfadeWidth }> = [];

  if (splits.lowSplitActive) {
    activeBoundaries.push({
      midi: SPLIT_POSITION_MIDIS[splits.lowPosition] ?? 48,
      crossfade: splits.lowCrossfade,
    });
  }

  if (splits.midSplitActive) {
    activeBoundaries.push({
      midi: SPLIT_POSITION_MIDIS[splits.midPosition] ?? 60,
      crossfade: splits.midCrossfade,
    });
  }

  if (splits.highSplitActive) {
    activeBoundaries.push({
      midi: SPLIT_POSITION_MIDIS[splits.highPosition] ?? 72,
      crossfade: splits.highCrossfade,
    });
  }

  // Sort boundaries ascending
  activeBoundaries.sort((a, b) => a.midi - b.midi);

  if (activeBoundaries.length === 0) {
    return 1.0;
  }

  // For up to 3 boundaries, we have up to 4 zones (zone 0, 1, 2, 3)
  // Map zones to assignment flags
  const zoneFlags = [assignment.zone1, assignment.zone2, assignment.zone3, assignment.zone4];

  // If there is only 1 boundary (e.g. Mid at C4), Zone 0 is left of boundary, Zone 1 is right
  // If layer is assigned to all zones, gain is 1.0 everywhere
  // Let's compute continuous zone membership with crossfade slopes

  // Compute gain contribution for each zone
  let maxGain = 0;

  for (let z = 0; z <= activeBoundaries.length; z++) {
    const isAssigned = zoneFlags[z] ?? false;
    if (!isAssigned) continue;

    // Calculate gain for zone z at this midi note
    let zoneGain = 1.0;

    // Left boundary of zone z (if z > 0)
    if (z > 0) {
      const leftBoundary = activeBoundaries[z - 1];
      const splitMidi = leftBoundary.midi;
      const xfade = leftBoundary.crossfade;

      if (xfade === 0) {
        if (midi < splitMidi) {
          zoneGain = 0;
        }
      } else {
        // Crossfade region: [splitMidi - xfade, splitMidi + xfade]
        const fadeStart = splitMidi - xfade;
        const fadeEnd = splitMidi + xfade;
        if (midi <= fadeStart) {
          zoneGain = 0;
        } else if (midi < fadeEnd) {
          // Linear ramp from 0 to 1
          const progress = (midi - fadeStart) / (fadeEnd - fadeStart);
          zoneGain *= Math.max(0, Math.min(1, progress));
        }
      }
    }

    // Right boundary of zone z (if z < activeBoundaries.length)
    if (z < activeBoundaries.length) {
      const rightBoundary = activeBoundaries[z];
      const splitMidi = rightBoundary.midi;
      const xfade = rightBoundary.crossfade;

      if (xfade === 0) {
        if (midi >= splitMidi) {
          zoneGain = 0;
        }
      } else {
        const fadeStart = splitMidi - xfade;
        const fadeEnd = splitMidi + xfade;
        if (midi >= fadeEnd) {
          zoneGain = 0;
        } else if (midi > fadeStart) {
          // Linear ramp from 1 to 0
          const progress = (fadeEnd - midi) / (fadeEnd - fadeStart);
          zoneGain *= Math.max(0, Math.min(1, progress));
        }
      }
    }

    if (zoneGain > maxGain) {
      maxGain = zoneGain;
    }
  }

  return maxGain;
}
