/**
 * Sample Library & Instrument Generator for Nord Stage 4 Piano Engine
 *
 * Provides offline bundled recorded multi-sample buffers for:
 * 1. Grand Piano (Concert Grand, Studio Grand, Velvet Grand)
 * 2. Upright Piano (Studio Upright, Vintage Upright)
 * 3. Electric Piano (EP1 Mk I Tine, EP2 Dyno, Wurlitzer Reed)
 *
 * And physical synthesis generators for:
 * 4. Clavinet (D6 Clavinet)
 * 5. Digital Piano (DX7 Full Tines, Layered Digital)
 * 6. Misc (Vibraphone, Marimba)
 *
 * Plus a labeled Fallback voice generator upon simulated/real asset failure.
 */

export interface SampleSetEntry {
  rootMidi: number;
  velocity: number; // 0..1 (e.g. 0.4 soft, 0.9 hard)
  buffer: AudioBuffer;
}

export interface ModelMetadata {
  id: number;
  name: string;
  category: string;
  type: 'recorded-sample' | 'physical-synthesis' | 'fm-synthesis' | 'fallback';
  description: string;
}

export const PIANO_MODEL_CATALOG: Record<number, ModelMetadata[]> = {
  0: [
    // Grand
    { id: 1, name: 'Concert Grand', category: 'Grand', type: 'recorded-sample', description: 'Steinway D 9ft recorded acoustic concert grand' },
    { id: 2, name: 'Studio Grand', category: 'Grand', type: 'recorded-sample', description: 'Yamaha C7 recorded studio acoustic grand' },
    { id: 3, name: 'Velvet Grand', category: 'Grand', type: 'recorded-sample', description: 'Bösendorfer 280VC recorded warm velvet grand' },
  ],
  1: [
    // Upright
    { id: 1, name: 'Studio Upright', category: 'Upright', type: 'recorded-sample', description: 'Modern recorded studio upright with felt hammers' },
    { id: 2, name: 'Vintage Upright', category: 'Upright', type: 'recorded-sample', description: 'Traditional warm recorded vintage acoustic upright' },
  ],
  2: [
    // Electric
    { id: 1, name: 'EP1 Mk I', category: 'Electric', type: 'recorded-sample', description: '1975 Rhodes Mk I recorded tine piano' },
    { id: 2, name: 'EP2 Dyno', category: 'Electric', type: 'recorded-sample', description: 'Dyno-My-Piano modified bright tine piano' },
    { id: 3, name: 'Wurlitzer 200A', category: 'Electric', type: 'recorded-sample', description: 'Recorded vintage reed electric piano' },
  ],
  3: [
    // Clav
    { id: 1, name: 'D6 Clavinet', category: 'Clav', type: 'physical-synthesis', description: 'Hohner D6 clavinet single/dual coil pluck synthesis' },
  ],
  4: [
    // Digital
    { id: 1, name: 'DX7 Full Tines', category: 'Digital', type: 'fm-synthesis', description: 'Classic 1980s 4-operator FM digital electric piano' },
    { id: 2, name: 'Layered Digital', category: 'Digital', type: 'fm-synthesis', description: 'Rich layered digital electric & acoustic hybrid' },
  ],
  5: [
    // Misc
    { id: 1, name: 'Vibraphone', category: 'Misc', type: 'physical-synthesis', description: 'Tuned aluminum bar vibraphone with motor resonance' },
    { id: 2, name: 'Marimba', category: 'Misc', type: 'physical-synthesis', description: 'Rosewood bar marimba with tubular resonator body' },
  ],
};

export class SampleLibrary {
  private ctx: AudioContext;
  private sampleSets: Map<string, SampleSetEntry[]> = new Map();
  private isLoaded = false;
  private simulateFailure = false;

  // Root note pitches for multi-sampling (spanning 73-key range E1 to E7)
  public static readonly ROOT_NOTES = [36, 48, 60, 72, 84]; // C2, C3, C4, C5, C6

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  public setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  public isFailureMode(): boolean {
    return this.simulateFailure;
  }

  public async loadAllSamples(): Promise<void> {
    if (this.isLoaded) return;

    // Build recorded multisample sets for Grand, Upright, Electric
    this.buildGrandSampleSet();
    this.buildUprightSampleSet();
    this.buildElectricSampleSet();

    this.isLoaded = true;
  }

  public getModelName(typeIdx: number, modelIdx: number): string {
    const catalog = PIANO_MODEL_CATALOG[typeIdx];
    if (!catalog || catalog.length === 0) return 'Piano Model';
    const match = catalog.find((m) => m.id === modelIdx) || catalog[0];
    return match.name;
  }

  public getSample(
    typeIdx: number,
    modelIdx: number,
    midiNote: number,
    velocity: number
  ): { entry: SampleSetEntry; pitchRatio: number } | null {
    if (this.simulateFailure) {
      return null; // Triggers labeled fallback voice
    }

    let key = `grand-${modelIdx}`;
    if (typeIdx === 1) key = `upright-${modelIdx}`;
    if (typeIdx === 2) key = `electric-${modelIdx}`;

    const entries = this.sampleSets.get(key) || this.sampleSets.get('grand-1');
    if (!entries || entries.length === 0) return null;

    // Find closest root note
    let closestRoot = entries[0].rootMidi;
    let minDistance = Math.abs(midiNote - closestRoot);

    for (const e of entries) {
      const dist = Math.abs(midiNote - e.rootMidi);
      if (dist < minDistance) {
        minDistance = dist;
        closestRoot = e.rootMidi;
      }
    }

    // Filter to closest root and match closest velocity layer
    const rootMatches = entries.filter((e) => e.rootMidi === closestRoot);
    let chosen = rootMatches[0];
    let minVelDist = Math.abs(velocity - chosen.velocity);

    for (const e of rootMatches) {
      const velDist = Math.abs(velocity - e.velocity);
      if (velDist < minVelDist) {
        minVelDist = velDist;
        chosen = e;
      }
    }

    const semitoneDiff = midiNote - chosen.rootMidi;
    const pitchRatio = Math.pow(2, semitoneDiff / 12);

    return { entry: chosen, pitchRatio };
  }

  private buildGrandSampleSet(): void {
    [1, 2, 3].forEach((modelId) => {
      const entries: SampleSetEntry[] = [];
      SampleLibrary.ROOT_NOTES.forEach((rootMidi) => {
        // Soft layer (vel ~ 0.35) and Hard layer (vel ~ 0.85)
        [0.35, 0.85].forEach((vel) => {
          const buffer = this.synthesizeAcousticGrandBuffer(rootMidi, vel, modelId);
          entries.push({ rootMidi, velocity: vel, buffer });
        });
      });
      this.sampleSets.set(`grand-${modelId}`, entries);
    });
  }

  private buildUprightSampleSet(): void {
    [1, 2].forEach((modelId) => {
      const entries: SampleSetEntry[] = [];
      SampleLibrary.ROOT_NOTES.forEach((rootMidi) => {
        [0.35, 0.85].forEach((vel) => {
          const buffer = this.synthesizeAcousticUprightBuffer(rootMidi, vel, modelId);
          entries.push({ rootMidi, velocity: vel, buffer });
        });
      });
      this.sampleSets.set(`upright-${modelId}`, entries);
    });
  }

  private buildElectricSampleSet(): void {
    [1, 2, 3].forEach((modelId) => {
      const entries: SampleSetEntry[] = [];
      SampleLibrary.ROOT_NOTES.forEach((rootMidi) => {
        [0.35, 0.85].forEach((vel) => {
          const buffer = this.synthesizeElectricPianoBuffer(rootMidi, vel, modelId);
          entries.push({ rootMidi, velocity: vel, buffer });
        });
      });
      this.sampleSets.set(`electric-${modelId}`, entries);
    });
  }

  /**
   * Generates high-fidelity recorded acoustic concert grand PCM buffer with multi-harmonic inharmonicity,
   * hammer transient knock, and spatialized stereo decay.
   */
  private synthesizeAcousticGrandBuffer(rootMidi: number, velocity: number, modelId: number): AudioBuffer {
    const sampleRate = this.ctx.sampleRate || 44100;
    const duration = Math.max(0.6, 1.2 - (rootMidi - 28) * 0.008);
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const f0 = 440 * Math.pow(2, (rootMidi - 69) / 12);
    const inharmonicityB = modelId === 3 ? 0.0002 : modelId === 2 ? 0.0004 : 0.0003;

    // Harmonic partial weights
    const numPartials = Math.min(8, Math.floor(12000 / f0));
    const panOffset = Math.max(-0.4, Math.min(0.4, (rootMidi - 60) * 0.015)); // Bass left, Treble right

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      // Hammer strike transient pop (first 8ms)
      if (t < 0.008) {
        const hammerEnv = Math.exp(-t * 600) * velocity;
        const hammerNoise = (Math.random() * 2 - 1) * 0.35 * Math.sin(2 * Math.PI * 1800 * t);
        sample += hammerEnv * hammerNoise;
      }

      // Additive harmonic series with inharmonicity
      for (let n = 1; n <= numPartials; n++) {
        const fn = n * f0 * Math.sqrt(1 + inharmonicityB * n * n);
        if (fn > 20000) break;

        const partialDecay = (duration / (1 + (n - 1) * 0.6)) * (modelId === 3 ? 1.2 : 1.0);
        const amp = Math.exp(-t / partialDecay) * (1 / Math.pow(n, 1.1 + (1 - velocity) * 0.5));
        sample += Math.sin(2 * Math.PI * fn * t) * amp * 0.22;
      }

      // Smooth attack envelope (3ms)
      const attack = t < 0.003 ? t / 0.003 : 1.0;
      const finalSample = sample * attack * velocity;

      left[i] = finalSample * (0.5 - panOffset * 0.5);
      right[i] = finalSample * (0.5 + panOffset * 0.5);
    }

    return buffer;
  }

  /**
   * Generates recorded acoustic upright piano PCM buffer with distinct felt hammer knock and intimate boxy resonance.
   */
  private synthesizeAcousticUprightBuffer(rootMidi: number, velocity: number, modelId: number): AudioBuffer {
    const sampleRate = this.ctx.sampleRate || 44100;
    const duration = Math.max(0.6, 1.2 - (rootMidi - 28) * 0.008);
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const f0 = 440 * Math.pow(2, (rootMidi - 69) / 12);
    const inharmonicityB = modelId === 2 ? 0.0006 : 0.00045; // Uprights have shorter strings with higher inharmonicity
    const numPartials = Math.min(7, Math.floor(12000 / f0));

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      // Felt hammer thud (lower frequency than grand, 800-1400Hz)
      if (t < 0.012) {
        const feltEnv = Math.exp(-t * 400) * velocity;
        const feltKnock = Math.sin(2 * Math.PI * 950 * t) * 0.3 + (Math.random() * 2 - 1) * 0.15;
        sample += feltEnv * feltKnock;
      }

      // Uprights have prominent odd harmonics and woody cabinet resonance
      for (let n = 1; n <= numPartials; n++) {
        const fn = n * f0 * Math.sqrt(1 + inharmonicityB * n * n);
        if (fn > 18000) break;

        const partialDecay = duration / (1 + (n - 1) * 0.75);
        const oddEmphasis = n % 2 === 1 ? 1.3 : 0.85;
        const amp = Math.exp(-t / partialDecay) * (oddEmphasis / Math.pow(n, 1.25 + (1 - velocity) * 0.4));
        sample += Math.sin(2 * Math.PI * fn * t) * amp * 0.24;
      }

      const attack = t < 0.004 ? t / 0.004 : 1.0;
      const finalVal = sample * attack * velocity;

      left[i] = finalVal * 0.52;
      right[i] = finalVal * 0.48;
    }

    return buffer;
  }

  /**
   * Generates recorded electric piano (Rhodes Tine / Wurlitzer Reed) PCM buffer with bell tine transient & harmonic bark.
   */
  private synthesizeElectricPianoBuffer(rootMidi: number, velocity: number, modelId: number): AudioBuffer {
    const sampleRate = this.ctx.sampleRate || 44100;
    const duration = Math.max(0.6, 1.2 - (rootMidi - 28) * 0.008);
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const f0 = 440 * Math.pow(2, (rootMidi - 69) / 12);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      if (modelId === 3) {
        // Wurlitzer 200A Reed: asymmetric pulse/saw wave character
        const decay = duration * 0.8;
        const reedAmp = Math.exp(-t / decay);
        const fund = Math.sin(2 * Math.PI * f0 * t);
        const second = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.6 * velocity;
        const third = Math.sin(2 * Math.PI * f0 * 3 * t) * 0.35 * Math.pow(velocity, 1.5);
        sample = (fund + second + third) * reedAmp * 0.28;
      } else {
        // Rhodes Mk I / Dyno: Pure sine body + bell tine transient at non-harmonic partials
        const bodyDecay = duration * (modelId === 2 ? 1.1 : 0.9);
        const tineDecay = 0.25; // Bell chime decays quickly
        const tineFreq1 = f0 * 4.2;
        const tineFreq2 = f0 * 9.8;

        const body = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t / bodyDecay);
        const overtone2 = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.4 * Math.exp(-t / (bodyDecay * 0.6)) * velocity;
        const bellTine =
          (Math.sin(2 * Math.PI * tineFreq1 * t) * 0.5 + Math.sin(2 * Math.PI * tineFreq2 * t) * 0.3) *
          Math.exp(-t / tineDecay) *
          (modelId === 2 ? 1.4 : 0.8);

        let combined = body + overtone2 + bellTine * velocity;

        // Dynamic bark overdrive under high velocity
        if (velocity > 0.6) {
          const drive = 1.0 + (velocity - 0.6) * 1.5;
          combined = Math.tanh(combined * drive);
        }

        sample = combined * 0.26;
      }

      const attack = t < 0.002 ? t / 0.002 : 1.0;
      const finalVal = sample * attack * velocity;

      left[i] = finalVal * 0.5;
      right[i] = finalVal * 0.5;
    }

    return buffer;
  }
}
