import { Graph, Shape, type Node, type Edge, type Cell } from '@antv/x6'
import { Selection } from '@antv/x6-plugin-selection'
import { Snapline } from '@antv/x6-plugin-snapline'
import { nanoid } from 'nanoid'
import { connectionError } from '../../../shared/plan.js'
import { NODE_STATUS_COLORS, NODE_TYPE_COLORS, NODE_TYPE_LABELS } from '../../../shared/constants.js'
import type { Plan, PlanNode, NodeRunState, ValidationIssue } from '../types'
interface Callbacks { changed: (plan: Plan) => void; selected: (id: string) => void; notify: (message: string) => void; zoom: (value: number) => void }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const glyphs: Record<string, string> = { start: '▶', task: '▤', condition: '◇', delay: '◷', end: '■' }
export class CanvasAdapter {
  graph: Graph
  private plan: Plan
  private syncing = false
  private locked = false
  private lastToast = ''
  private lastToastTime = 0
  private selected = ''
  private states: Record<string, NodeRunState> = {}
  private dragSource: { id: string; port: string; x: number; y: number } | null = null
  private dropListener: (event: MouseEvent) => void
  private issues: ValidationIssue[] = []
  private resizeObserver: ResizeObserver
  constructor(container: HTMLElement, plan: Plan, private callbacks: Callbacks) {
    this.plan = clone(plan)
    this.graph = new Graph({
      container, autoResize: true, background: { color: '#f5f6f8' },
      grid: { visible: true, size: 20, type: 'dot', args: { color: '#d8dce5', thickness: 1 } },
      panning: { enabled: true, eventTypes: ['rightMouseDown'] },
      mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: .3, maxScale: 1.8 },
      interacting: () => this.locked ? { nodeMovable: false, edgeMovable: false, magnetConnectable: false, arrowheadMovable: false, vertexMovable: false, vertexAddable: false, vertexDeletable: false } : { edgeMovable: false, arrowheadMovable: false, vertexMovable: false, vertexAddable: false, vertexDeletable: false },
      connecting: {
        snap: { radius: 24 }, allowBlank: false, allowLoop: true, allowNode: false, allowEdge: false,
        connector: { name: 'rounded', args: { radius: 10 } }, router: { name: 'normal' },
        highlight: false,
        createEdge: () => new Shape.Edge({ attrs: { line: { stroke: '#8190b0', strokeWidth: 1.7, targetMarker: { name: 'block', width: 7, height: 6 } } }, zIndex: 0 }),
        validateMagnet: ({ magnet, cell, e }: any) => { const allowed = !this.locked && magnet.getAttribute('port-group') !== 'in'; if (allowed) this.dragSource = { id: cell.id, port: magnet.getAttribute('port'), x: e.clientX, y: e.clientY }; return allowed },
        validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort, edge }: any) => {
          if (!sourceCell || !targetCell) return false
          const message = targetPort !== 'in' ? '连线必须从出端口连接到入端口' : connectionError(this.plan, sourceCell.id, targetCell.id, sourcePort === 'true' || sourcePort === 'false' ? sourcePort : undefined, edge?.id)
          if (message) return false
          return !this.locked
        }
      }
    })
    this.dropListener = (event: MouseEvent) => {
      const source = this.dragSource; this.dragSource = null
      if (!source || Math.hypot(event.clientX-source.x,event.clientY-source.y)<10) return
      let nearest: Element | null = null, distance = 25
      for (const port of container.querySelectorAll('.x6-node circle[port]')) { const box=port.getBoundingClientRect(); const d=Math.hypot(event.clientX-(box.x+box.width/2),event.clientY-(box.y+box.height/2)); if(d<distance){distance=d;nearest=port} }
      if (!nearest) return
      const target = nearest.closest('[data-cell-id]')?.getAttribute('data-cell-id'); if(!target)return
      const message = nearest.getAttribute('port') !== 'in' ? '连线必须从出端口连接到入端口' : connectionError(this.plan,source.id,target,['true','false'].includes(source.port)?source.port:undefined)
      if (message) this.toast(message)
    }
    window.addEventListener('mouseup', this.dropListener, true)
    this.graph.use(new Selection({ enabled: true, multiple: true, rubberband: true, showNodeSelectionBox: false, showEdgeSelectionBox: false, modifiers: ['shift'] }))
    this.graph.use(new Snapline({ enabled: true }))
    this.graph.on('selection:changed', ({ selected }) => { if (this.syncing) return; this.selected = selected.length === 1 && selected[0].isNode() ? selected[0].id : ''; this.callbacks.selected(this.selected); this.paint() })
    this.graph.on('node:click', ({ node }) => { this.selected = node.id; this.callbacks.selected(node.id); this.paint() })
    this.graph.on('blank:click', () => { this.selected = ''; this.callbacks.selected(''); this.paint() })
    this.graph.on('node:moved', ({ node }) => {
      if (this.syncing || this.locked) return
      const p = clone(this.plan)
      for (const model of p.nodes) { const cell = this.graph.getCellById(model.id); if (cell?.isNode()) { const pos = cell.position(); model.x = Math.round(pos.x / 20) * 20; model.y = Math.round(pos.y / 20) * 20 } }
      this.emitChange(p)
    })
    this.graph.on('edge:connected', ({ edge, isNew }) => {
      if (this.syncing || this.locked || !isNew) return
      const source = edge.getSourceCellId(), target = edge.getTargetCellId(), port = edge.getSourcePortId()
      const label = port === 'true' || port === 'false' ? port : undefined
      const reason = connectionError(this.plan, source, target, label)
      if (reason) { edge.remove(); this.toast(reason); return }
      const p = clone(this.plan); p.edges.push({ id: edge.id, source, target, ...(label ? { label } : {}) }); this.emitChange(p)
    })
    this.graph.on('scale', ({ sx }) => callbacks.zoom(Math.round(sx * 100)))
    this.graph.on('node:mouseenter', ({ node }) => { if (!this.locked) node.attr('body/cursor', 'grab') })
    this.resizeObserver = new ResizeObserver(() => this.graph.resize(container.clientWidth, container.clientHeight))
    this.resizeObserver.observe(container)
    this.render(plan)
  }
  private toast(message: string) { if (message !== this.lastToast || Date.now() - this.lastToastTime > 1800) { this.callbacks.notify(message); this.lastToast = message; this.lastToastTime = Date.now() } }
  private emitChange(plan: Plan) { this.plan = clone(plan); this.graph.trigger('graph:changed', { plan }); this.callbacks.changed(plan) }
  private nodeConfig(n: PlanNode) {
    const condition = n.type === 'condition', color = (NODE_TYPE_COLORS as Record<string,string>)[n.type]
    const label = n.props.name || (n.type === 'condition' ? '条件判断' : (NODE_TYPE_LABELS as Record<string,string>)[n.type])
    const detail = n.type === 'task' ? `${n.props.duration} ms · 重试 ${n.props.retry}` : condition ? n.props.expression : n.type === 'delay' ? `等待 ${n.props.wait} ms` : n.type === 'start' ? '流程入口' : '流程完成'
    const items: any[] = []
    if (n.type !== 'start') items.push({ id: 'in', group: 'in' })
    if (condition) { items.push({ id: 'true', group: 'out', attrs: { circle: { stroke: '#50a878' }, text: { text: 'T', fill: '#50a878' } } }, { id: 'false', group: 'out', attrs: { circle: { stroke: '#d48c44' }, text: { text: 'F', fill: '#d48c44' } } }) }
    else if (n.type !== 'end') items.push({ id: 'out', group: 'out' })
    return {
      id: n.id, shape: condition ? 'polygon' : 'rect', x: n.x, y: n.y, width: 144, height: condition ? 80 : 64,
      markup: [{ tagName: condition ? 'polygon' : 'rect', selector: 'body' }, { tagName: 'text', selector: 'icon' }, { tagName: 'text', selector: 'title' }, { tagName: 'text', selector: 'detail' }],
      attrs: {
        body: { ...(condition ? { refPoints: '0,40 72,0 144,40 72,80' } : { rx: n.type === 'task' ? 6 : 10, ry: n.type === 'task' ? 6 : 10 }), fill: `${color}0e`, stroke: `${color}80`, strokeWidth: 1.2, filter: 'drop-shadow(0px 2px 2px rgba(34,45,75,.03))' },
        icon: { text: glyphs[n.type], refX: condition ? .5 : 14, refY: condition ? 18 : 22, fill: color, fontSize: 13, textAnchor: condition ? 'middle' : 'start', fontFamily: 'Arial' },
        title: { text: label, refX: condition ? .5 : 34, refY: condition ? 35 : 22, fill: '#28364b', fontSize: 12, fontWeight: 600, textAnchor: condition ? 'middle' : 'start', textWrap: { width: condition ? 90 : 102, height: 18, ellipsis: true }, fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif' },
        detail: { text: detail, refX: .5, refY: condition ? 53 : 44, fill: '#8993a4', fontSize: condition ? 9 : 9.5, textAnchor: 'middle', textWrap: { width: condition ? 92 : 122, height: 16, ellipsis: true }, fontFamily: 'SFMono-Regular, Consolas, monospace' }
      },
      ports: { groups: { in: { position: 'left', attrs: { circle: { r: 4, magnet: 'passive', stroke: '#b3bccd', fill: '#fff', strokeWidth: 1.5 } } }, out: { position: 'right', attrs: { circle: { r: 4, magnet: true, stroke: color, fill: '#fff', strokeWidth: 1.5 }, text: { fontSize: 8 } }, label: { position: { name: 'right', args: { x: 8 } } } } }, items },
      data: { type: n.type }, zIndex: 1
    }
  }
  render(plan: Plan) {
    this.plan = clone(plan); this.syncing = true
    const selectedIds = this.graph.getSelectedCells().map(c => c.id)
    this.graph.resetCells([
      ...plan.nodes.map(n => this.graph.createNode(this.nodeConfig(n) as any)),
      ...plan.edges.map(e => this.graph.createEdge({ id: e.id, source: { cell: e.source, port: plan.nodes.find(n => n.id === e.source)?.type === 'condition' ? e.label : 'out' }, target: { cell: e.target, port: 'in' }, router: { name: 'manhattan', args: { padding: 20 } }, connector: { name: 'rounded', args: { radius: 10 } }, attrs: { line: { stroke: e.label === 'true' ? '#79ad94' : e.label === 'false' ? '#d5aa77' : '#a6b0c3', strokeWidth: 1.5, targetMarker: { name: 'block', width: 6, height: 5 } } }, labels: e.label ? [{ attrs: { label: { text: e.label, fill: '#6b778d', fontSize: 10 }, body: { fill: '#f5f6f8', stroke: 'none', rx: 3, ry: 3 } }, position: .4 }] : [], zIndex: 0 }))
    ])
    this.graph.select(selectedIds.map(id => this.graph.getCellById(id)).filter(Boolean))
    this.syncing = false; this.paint()
  }
  setStates(states: Record<string, NodeRunState>) { this.states = states; this.paint() }
  setIssues(issues: ValidationIssue[]) { this.issues = issues; this.graph.trigger('plan:validated', { issues }); this.paint() }
  setLocked(value: boolean) { this.locked = value }
  select(id: string) { this.selected = id; this.paint(); this.graph.trigger('node:selected', { nodeId: id }) }
  private paint() {
    this.graph.getNodes().forEach(node => {
      const model = this.plan.nodes.find(n => n.id === node.id); if (!model) return
      const state = this.states[node.id]?.status
      const base = (NODE_TYPE_COLORS as Record<string,string>)[model.type]
      const color = state ? (NODE_STATUS_COLORS as Record<string,string>)[state] || base : base
      const invalid = this.issues.some(i => i.nodeId === node.id), selected = this.selected === node.id || this.graph.isSelected(node)
      node.attr({ body: { fill: `${color}16`, stroke: invalid ? '#f56c6c' : selected ? '#4f6ef2' : `${color}b0`, strokeWidth: invalid || selected ? 2 : 1.2, filter: selected ? 'drop-shadow(0px 0px 4px rgba(79,110,242,.24))' : 'drop-shadow(0px 2px 2px rgba(34,45,75,.03))' }, icon: { fill: color } })
    })
  }
  fit() { if (this.plan.nodes.length) this.graph.zoomToFit({ padding: 64, maxScale: 1 }) }
  zoom(delta: number) { this.graph.zoom(delta, { minScale: .3, maxScale: 1.8 }) }
  focus(id: string) { const cell = this.graph.getCellById(id); if (cell) { this.graph.centerCell(cell); this.graph.resetSelection([cell]); this.selected = id; this.callbacks.selected(id); this.paint() } }
  toLocal(x: number,y: number) { return this.graph.clientToLocal(x,y) }
  deleteSelected() { if (this.locked) return; const ids = new Set(this.graph.getSelectedCells().map(c => c.id)); if (this.selected) ids.add(this.selected); if (!ids.size) return; const p = clone(this.plan); p.nodes = p.nodes.filter(n => !ids.has(n.id)); p.edges = p.edges.filter(e => !ids.has(e.id) && !ids.has(e.source) && !ids.has(e.target)); this.selected = ''; this.callbacks.selected(''); this.emitChange(p) }
  copySelection() { const ids = new Set(this.graph.getSelectedCells().map(c => c.id)); if (this.selected) ids.add(this.selected); return { nodes: clone(this.plan.nodes.filter(n => ids.has(n.id))), edges: clone(this.plan.edges.filter(e => ids.has(e.source) && ids.has(e.target))) } }
  paste(data: { nodes: PlanNode[]; edges: Plan['edges'] }) { if (this.locked || !data.nodes.length) return; if (this.plan.nodes.length + data.nodes.length > 100 || this.plan.edges.length + data.edges.length > 200) { this.toast('方案最多允许 100 个节点、200 条边'); return } if (data.nodes.some(n => ['start','end'].includes(n.type) && this.plan.nodes.some(x => x.type === n.type))) { this.toast('开始和结束节点全图只能各有一个'); return } const map = new Map(data.nodes.map(n => [n.id,nanoid(10)])); const p = clone(this.plan); p.nodes.push(...data.nodes.map(n => ({ ...clone(n), id: map.get(n.id)!, x:n.x+40,y:n.y+40 }))); p.edges.push(...data.edges.map(e => ({...e,id:nanoid(10),source:map.get(e.source)!,target:map.get(e.target)!}))); this.emitChange(p) }
  dispose() { window.removeEventListener('mouseup',this.dropListener,true); this.resizeObserver.disconnect(); this.graph.dispose() }
}
