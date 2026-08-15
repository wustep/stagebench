import { describe, expect, it } from 'vitest'
import { StatusModel } from '../src/piano/status'

describe('piano.basic-status-cleanup: status model', () => {
  it('starts ready with the synthesized voice, not loading', () => {
    const status = new StatusModel()
    expect(status.snapshot.status).toBe('ready')
    expect(status.snapshot.usingFallback).toBe(false)
    expect(status.snapshot.message).toMatch(/ready/i)
  })

  it('can represent loading, error and a labelled fallback', () => {
    const status = new StatusModel()
    status.setLoading('Loading piano voice…')
    expect(status.snapshot.status).toBe('loading')
    status.setError('Failed to initialize audio')
    expect(status.snapshot.status).toBe('error')
    status.setFallback('Basic keyboard fallback voice')
    expect(status.snapshot.status).toBe('fallback')
    expect(status.snapshot.usingFallback).toBe(true)
  })

  it('notifies subscribers on state changes', () => {
    const status = new StatusModel()
    const seen: string[] = []
    const unsub = status.subscribe(() => seen.push(status.snapshot.status))
    status.setLoading('loading')
    status.setReady('ready')
    unsub()
    status.setError('after unsubscribe')
    expect(seen).toEqual(['loading', 'ready'])
  })
})