import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClassInfo, EdgeInfo, ModuleInfo, ProjectInfo } from '@bluepy/protocol'
import {
  NODE_HEIGHT,
  NODE_HEIGHT_STEREOTYPE,
  NODE_WIDTH,
  alongEdge,
  autoLayout,
  edgeEndpoints,
  parallelOffset,
  type Point,
  type Rect
} from '../diagram/geometry'
import { useStore } from '../store'

export interface DiagramNode {
  id: string
  kind: 'class' | 'module'
  label: string
  stereotype: string | null
  file: string
  line: number
  cls?: ClassInfo
  module?: ModuleInfo
}

interface Props {
  onClassMenu(node: DiagramNode, x: number, y: number): void
}

const STEREOTYPE_LABEL: Record<string, string> = {
  abstract: '«abstract»',
  interface: '«interface»',
  enum: '«enum»',
  dataclass: '«dataclass»',
  exception: '«exception»',
  unittest: '«unit test»',
  module: '«module»'
}

export function nodesOf(project: ProjectInfo): DiagramNode[] {
  const model = project.model
  if (!model) return []
  const nodes: DiagramNode[] = model.classes.map((cls) => ({
    id: cls.id,
    kind: 'class',
    label: cls.name,
    stereotype: cls.stereotype === 'class' ? null : (STEREOTYPE_LABEL[cls.stereotype] ?? null),
    file: cls.file,
    line: cls.line,
    cls
  }))
  const withClasses = new Set(model.classes.map((c) => c.module))
  for (const mod of model.modules) {
    if (!mod.id || withClasses.has(mod.id)) continue
    if (mod.functions.length === 0 && !mod.hasMain && !mod.error) continue
    nodes.push({ id: `module:${mod.id}`, kind: 'module', label: mod.id, stereotype: STEREOTYPE_LABEL.module ?? null, file: mod.file, line: 1, module: mod })
  }
  return nodes
}

function compileStatus(project: ProjectInfo, file: string): 'ok' | 'error' | 'stale' {
  const result = project.compile[file]
  if (!result) return 'stale'
  return result.ok ? 'ok' : 'error'
}

export function ClassDiagram({ onClassMenu }: Props): JSX.Element {
  const { t } = useTranslation()
  const project = useStore((s) => s.project)
  const saveLayout = useStore((s) => s.saveLayout)
  const [positions, setPositions] = useState<Record<string, Point>>({})
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const nodes = useMemo(() => (project ? nodesOf(project) : []), [project])
  const edges: EdgeInfo[] = project?.model?.edges ?? []

  // Positions: project layout, falling back to an automatic layout for unplaced nodes.
  useEffect(() => {
    if (!project) return
    const auto = autoLayout(
      nodes.map((n) => n.id),
      edges.filter((e) => e.kind === 'inheritance').map((e) => ({ from: e.from, to: e.to }))
    )
    setPositions((current) => {
      const next: Record<string, Point> = {}
      for (const node of nodes) {
        next[node.id] = project.layout[node.id] ?? current[node.id] ?? auto[node.id] ?? { x: 40, y: 40 }
      }
      return next
    })
  }, [project, nodes, edges])

  const rects = useMemo(() => {
    const map = new Map<string, Rect>()
    for (const node of nodes) {
      const p = positions[node.id] ?? { x: 40, y: 40 }
      map.set(node.id, { x: p.x, y: p.y, w: NODE_WIDTH, h: node.stereotype ? NODE_HEIGHT_STEREOTYPE : NODE_HEIGHT })
    }
    return map
  }, [nodes, positions])

  const toSvgPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current
    if (!svg) return { x: e.clientX, y: e.clientY }
    const box = svg.getBoundingClientRect()
    return { x: e.clientX - box.left + svg.scrollLeft, y: e.clientY - box.top + svg.scrollTop }
  }, [])

  const onPointerDown = (node: DiagramNode, e: ReactPointerEvent<SVGGElement>): void => {
    if (e.button !== 0) return
    const p = toSvgPoint(e)
    const pos = positions[node.id] ?? { x: 0, y: 0 }
    setDrag({ id: node.id, dx: p.x - pos.x, dy: p.y - pos.y })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return
    const p = toSvgPoint(e)
    setPositions((current) => ({ ...current, [drag.id]: { x: Math.max(0, p.x - drag.dx), y: Math.max(0, p.y - drag.dy) } }))
  }

  const onPointerUp = (): void => {
    if (!drag) return
    const pos = positions[drag.id]
    setDrag(null)
    if (pos) void saveLayout({ [drag.id]: pos })
  }

  if (!project) return <div className="pane-body diagram hint">{t('diagram.noProject')}</div>

  const width = Math.max(600, ...[...rects.values()].map((r) => r.x + r.w + 60))
  const height = Math.max(400, ...[...rects.values()].map((r) => r.y + r.h + 60))

  // group parallel edges between the same pair for sideways offsets
  const pairIndex = new Map<string, number>()
  const pairCount = new Map<string, number>()
  for (const e of edges) {
    const key = [e.from, e.to].sort().join('|')
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
  }

  return (
    <div className="pane-body diagram">
      <div className="diagram-scroll">
        <svg
          ref={svgRef}
          className="diagram-svg"
          width={width}
          height={height}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <marker id="m-inherit" markerWidth="14" markerHeight="14" refX="13" refY="7" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L14,7 L0,14 z" className="arrow-inherit" />
            </marker>
            <marker id="m-uses" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L12,6 L0,12" className="arrow-uses" />
            </marker>
            <marker id="m-assoc" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L12,6 L0,12" className="arrow-uses" />
            </marker>
            <marker id="m-composition" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M1,6 L8,1 L15,6 L8,11 z" className="diamond filled" />
            </marker>
            <marker id="m-aggregation" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M1,6 L8,1 L15,6 L8,11 z" className="diamond" />
            </marker>
            <pattern id="stripes" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
              <rect width="8" height="8" className="stripe-bg" />
              <rect width="4" height="8" className="stripe-fg" />
            </pattern>
          </defs>

          {edges.map((edge, i) => {
            const from = rects.get(edge.from)
            const to = rects.get(edge.to)
            if (!from || !to) return null
            const key = [edge.from, edge.to].sort().join('|')
            const idx = pairIndex.get(key) ?? 0
            pairIndex.set(key, idx + 1)
            const offset = parallelOffset(idx, pairCount.get(key) ?? 1)
            const { start, end } = edgeEndpoints(from, to)
            const s = alongEdge(start, end, 0, offset)
            const e = alongEdge(start, end, Math.hypot(end.x - start.x, end.y - start.y), offset)
            if (edge.kind === 'inheritance') {
              return <line key={i} x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="edge edge-inherit" markerEnd="url(#m-inherit)" />
            }
            if (edge.kind === 'uses') {
              return <line key={i} x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="edge edge-uses" markerEnd="url(#m-uses)" />
            }
            const len = Math.hypot(e.x - s.x, e.y - s.y)
            const multPos = alongEdge(s, e, Math.max(len - 18, 0), -10)
            const rolePos = alongEdge(s, e, len / 2, -10)
            const markerStart =
              edge.relation === 'composition' ? 'url(#m-composition)' : edge.relation === 'aggregation' ? 'url(#m-aggregation)' : undefined
            return (
              <g key={i} className="edge-group">
                <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="edge edge-assoc" markerStart={markerStart} markerEnd="url(#m-assoc)" />
                <text x={multPos.x} y={multPos.y} className="multiplicity" textAnchor="middle">
                  {edge.multiplicity}
                </text>
                <text x={rolePos.x} y={rolePos.y} className="role" textAnchor="middle">
                  {edge.role}
                </text>
              </g>
            )
          })}

          {nodes.map((node) => {
            const r = rects.get(node.id)
            if (!r) return null
            const status = compileStatus(project, node.file)
            return (
              <g
                key={node.id}
                className={`class-node ${node.kind} status-${status} ${drag?.id === node.id ? 'dragging' : ''} st-${node.cls?.stereotype ?? 'module'}`}
                transform={`translate(${r.x} ${r.y})`}
                onPointerDown={(e) => onPointerDown(node, e)}
                onDoubleClick={() => void window.bluepy.editor.open(node.file, node.line)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onClassMenu(node, e.clientX, e.clientY)
                }}
              >
                <rect width={r.w} height={r.h} rx="4" className="node-box" />
                {status !== 'ok' && <rect width={r.w} height={r.h} rx="4" fill="url(#stripes)" className="node-stripes" />}
                {node.stereotype && (
                  <text x={r.w / 2} y={18} textAnchor="middle" className="stereotype">
                    {node.stereotype}
                  </text>
                )}
                <text x={r.w / 2} y={node.stereotype ? 42 : 30} textAnchor="middle" className="class-name">
                  {node.label}
                </text>
                <text x={r.w / 2} y={r.h - 8} textAnchor="middle" className="node-file">
                  {node.file}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {project.modelError && <div className="diagram-error">{t('diagram.modelError', { detail: project.modelError })}</div>}
      {!project.model && !project.modelError && <div className="diagram-error muted">{t('diagram.analyzing')}</div>}
    </div>
  )
}
