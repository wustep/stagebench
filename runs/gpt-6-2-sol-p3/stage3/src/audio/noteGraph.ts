import { Graph } from './graph'

export function frequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12)
}

/** The Web Audio clock owns scheduled release completion, including offline renders. */
export class NoteGraph extends Graph {
  private readonly endSignal: ConstantSourceNode
  private readonly scheduled: AudioScheduledSourceNode[] = []
  private endTime = Infinity
  private disposed = false

  constructor(context: BaseAudioContext, clock: () => number, private readonly ended: () => void, start: number) {
    super(context, clock)
    this.endSignal = this.source(context.createConstantSource(), start)
    this.endSignal.onended = () => this.dispose()
  }

  source<T extends AudioScheduledSourceNode>(node: T, start: number) {
    this.scheduled.push(this.own(node))
    node.start(start)
    return node
  }

  bufferSource(node: AudioBufferSourceNode, start: number, offset: number) {
    this.scheduled.push(this.own(node))
    node.start(start, offset)
  }

  finish(time: number) {
    if (time >= this.endTime || this.disposed) return
    this.endTime = time
    for (const source of this.scheduled) source.stop(time)
  }

  override dispose() {
    if (this.disposed) return
    this.disposed = true
    this.endSignal.onended = null
    // Sources were already stopped if the scheduled envelope ran to completion.
    if (!Number.isFinite(this.endTime) || this.context.currentTime < this.endTime) {
      for (const source of this.scheduled) source.stop()
    }
    this.scheduled.length = 0
    super.dispose()
    this.ended()
  }
}

export function noiseBuffer(context: BaseAudioContext, count: number, seed: number) {
  const buffer = context.createBuffer(1, count, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i] = seed / 2147483648 - 1
  }
  return buffer
}
