/** Pure geometry for the class diagram (unit-tested, no DOM). */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export const NODE_WIDTH = 170
export const NODE_HEIGHT = 58
export const NODE_HEIGHT_STEREOTYPE = 72

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Where the segment from the rect's centre towards `target` leaves the rect. */
export function boundaryPoint(r: Rect, target: Point): Point {
  const c = center(r)
  const dx = target.x - c.x
  const dy = target.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = r.w / 2
  const hh = r.h / 2
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY
  const s = Math.min(scaleX, scaleY)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

/** Endpoints of an edge between two rects, each on the rect's border. */
export function edgeEndpoints(from: Rect, to: Rect): { start: Point; end: Point } {
  return { start: boundaryPoint(from, center(to)), end: boundaryPoint(to, center(from)) }
}

/** A point `distance` along the edge from `start` towards `end`, offset sideways by `side`. */
export function alongEdge(start: Point, end: Point, distance: number, side = 0): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return { x: start.x + ux * distance - uy * side, y: start.y + uy * distance + ux * side }
}

/** Self-loop or parallel-edge offset: parallel edges between the same pair get spread sideways. */
export function parallelOffset(index: number, count: number, spacing = 14): number {
  return (index - (count - 1) / 2) * spacing
}

/** Simple layered auto layout: base classes above their subclasses, otherwise a grid. */
export function autoLayout(
  ids: string[],
  inheritance: { from: string; to: string }[],
  options: { columnWidth?: number; rowHeight?: number; columns?: number } = {}
): Record<string, Point> {
  const columnWidth = options.columnWidth ?? 220
  const rowHeight = options.rowHeight ?? 130
  const columns = options.columns ?? 4
  const parents = new Map<string, string[]>()
  for (const e of inheritance) parents.set(e.from, [...(parents.get(e.from) ?? []), e.to])
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const ps = (parents.get(id) ?? []).filter((p) => ids.includes(p))
    const d = ps.length ? 1 + Math.max(...ps.map(depthOf)) : 0
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  const layers = new Map<number, string[]>()
  for (const id of ids) {
    const d = depthOf(id)
    layers.set(d, [...(layers.get(d) ?? []), id])
  }
  const result: Record<string, Point> = {}
  let row = 0
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(d) ?? []
    layer.forEach((id, i) => {
      result[id] = { x: 40 + (i % columns) * columnWidth, y: 40 + (row + Math.floor(i / columns)) * rowHeight }
    })
    row += Math.ceil(layer.length / columns)
  }
  return result
}
