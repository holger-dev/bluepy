import { describe, expect, it } from 'vitest'
import { alongEdge, autoLayout, boundaryPoint, edgeEndpoints, parallelOffset } from './geometry'

describe('boundaryPoint', () => {
  const r = { x: 0, y: 0, w: 100, h: 50 }
  it('hits the right edge for a target to the right', () => {
    expect(boundaryPoint(r, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 })
  })
  it('hits the bottom edge for a target below', () => {
    expect(boundaryPoint(r, { x: 50, y: 300 })).toEqual({ x: 50, y: 50 })
  })
  it('returns the centre when the target is the centre', () => {
    expect(boundaryPoint(r, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 })
  })
})

describe('edgeEndpoints', () => {
  it('connects borders, not centres', () => {
    const { start, end } = edgeEndpoints({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })
    expect(start).toEqual({ x: 100, y: 25 })
    expect(end).toEqual({ x: 300, y: 25 })
  })
})

describe('alongEdge / parallelOffset', () => {
  it('walks along the edge', () => {
    expect(alongEdge({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 4, y: 0 })
    expect(alongEdge({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 2)).toEqual({ x: 4, y: 2 })
  })
  it('spreads parallel edges symmetrically', () => {
    expect([0, 1, 2].map((i) => parallelOffset(i, 3))).toEqual([-14, 0, 14])
  })
})

describe('autoLayout', () => {
  it('puts base classes above subclasses', () => {
    const pos = autoLayout(['a.Sub', 'a.Base', 'a.Other'], [{ from: 'a.Sub', to: 'a.Base' }])
    expect(pos['a.Base']?.y).toBeLessThan(pos['a.Sub']?.y ?? 0)
    expect(pos['a.Other']?.y).toBe(pos['a.Base']?.y)
  })
  it('survives inheritance cycles', () => {
    const pos = autoLayout(['x', 'y'], [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }])
    expect(Object.keys(pos).sort()).toEqual(['x', 'y'])
  })
})
