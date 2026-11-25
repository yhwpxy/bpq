import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {type ReactElement, useMemo} from 'react';
import type {GraphEdge, GraphNode} from '../../../src/shared/types';
import {
  formatEdgeLabel,
  formatExecutorKind,
  formatNodeKind,
  formatNodeStatus,
  tr,
  type UiLang,
} from '../i18n';

interface PhaseBoxData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly lang: UiLang;
  readonly onToggleCollapse?: (nodeId: string, collapsed: boolean) => void;
}

interface TwinNodeData extends Record<string, unknown> {
  readonly node: GraphNode;
  readonly selected: boolean;
  readonly impacted: boolean;
  readonly lang: UiLang;
  readonly mode: 'design' | 'run';
}

function PhaseBoxRenderer({data}: NodeProps<Node<PhaseBoxData>>): ReactElement {
  const {node, doneCount, totalCount, lang, onToggleCollapse} = data;
  return (
    <div className="phase-box">
      <div className="phase-header">
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.title}
        >
          {node.title}
        </span>
        <div
          style={{display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0}}
        >
          <span className="tag">
            {doneCount}/{totalCount}
          </span>
          {onToggleCollapse && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={e => {
                e.stopPropagation();
                onToggleCollapse(node.id, !node.collapsed);
              }}
            >
              {node.collapsed
                ? tr(lang, '展开', 'Expand')
                : tr(lang, '折叠', 'Collapse')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getDesignBadge(
  lang: UiLang,
  node: GraphNode,
): {readonly className: string; readonly label: string} {
  switch (node.kind) {
    case 'checkpoint':
      return {
        className: 'tag tag-teal',
        label: formatNodeKind(lang, 'checkpoint'),
      };
    case 'restore':
      return {className: 'tag tag-red', label: formatNodeKind(lang, 'restore')};
    case 'human_gate':
      return {
        className: 'tag tag-amber',
        label: formatNodeKind(lang, 'human_gate'),
      };
    case 'decision':
      return {
        className: 'tag tag-indigo',
        label: formatNodeKind(lang, 'decision'),
      };
    default:
      return {
        className: 'tag tag-indigo',
        label: formatExecutorKind(lang, node.executorKind),
      };
  }
}

function getRunStatusTagClass(node: GraphNode): string {
  switch (node.status) {
    case 'succeeded':
    case 'waived':
      return 'tag tag-green';
    case 'failed':
      return 'tag tag-red';
    case 'waiting_human':
      return 'tag tag-amber';
    case 'running':
      return 'tag tag-indigo';
    default:
      return node.kind === 'checkpoint' ? 'tag tag-teal' : 'tag';
  }
}

function TwinNodeRenderer({data}: NodeProps<Node<TwinNodeData>>): ReactElement {
  const {node, selected, impacted, lang, mode} = data;
  const cls = [
    'graph-node-card',
    `kind-${node.kind}`,
    selected ? 'selected' : '',
    mode === 'run' ? `status-${node.status}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const designBadge = getDesignBadge(lang, node);

  return (
    <div
      className={cls}
      style={
        impacted
          ? {boxShadow: '0 0 0 2px #f59e0b', borderColor: '#d97706'}
          : undefined
      }
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 0,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: node.kind === 'checkpoint' ? '#0f766e' : '#475569',
            }}
          >
            {node.code}
          </span>
          {mode === 'run' && node.kind === 'checkpoint' && (
            <span
              className="tag tag-teal"
              style={{fontSize: 9.5, padding: '0 5px'}}
            >
              {formatNodeKind(lang, 'checkpoint')}
            </span>
          )}
        </div>
        {mode === 'run' ? (
          <span className={getRunStatusTagClass(node)} style={{fontSize: 10}}>
            {formatNodeStatus(lang, node.status)}
          </span>
        ) : (
          <span className={designBadge.className} style={{fontSize: 10}}>
            {designBadge.label}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#0f172a',
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={node.title}
      >
        {node.title}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          fontSize: 10,
          color: '#64748b',
        }}
      >
        <span
          className="mono"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.capabilityId}
        </span>
        {node.requirementRefs.length > 0 && (
          <span style={{flexShrink: 0}}>
            {node.requirementRefs.slice(0, 2).join(',')}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Top} id="top" />
    </div>
  );
}

const NODE_TYPES = {
  phaseBox: PhaseBoxRenderer,
  twinNode: TwinNodeRenderer,
};

export interface TwinGraphCanvasProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly selectedNodeId: string | null;
  readonly impactedCodes?: readonly string[];
  readonly mode: 'design' | 'run';
  readonly lang: UiLang;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onToggleCollapse?: (nodeId: string, collapsed: boolean) => void;
}

export function TwinGraphCanvas(props: TwinGraphCanvasProps): ReactElement {
  const {
    nodes,
    edges,
    selectedNodeId,
    impactedCodes = [],
    mode,
    lang,
    onSelectNode,
    onToggleCollapse,
  } = props;

  const {rfNodes, rfEdges} = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const collapsedIds = new Set(
      nodes
        .filter(n => n.kind === 'phase_container' && n.collapsed)
        .map(n => n.id),
    );
    const impactSet = new Set(impactedCodes);

    const outNodes: Node[] = [];
    for (const n of nodes) {
      if (n.containerNodeId && collapsedIds.has(n.containerNodeId)) {
        continue;
      }
      if (n.kind === 'phase_container') {
        const kids = nodes.filter(c => c.containerNodeId === n.id);
        const doneCount = kids.filter(
          c => c.status === 'succeeded' || c.status === 'waived',
        ).length;
        const w = n.collapsed ? 240 : n.width;
        const h = n.collapsed ? 56 : n.height;
        outNodes.push({
          id: n.id,
          type: 'phaseBox',
          position: {x: n.positionX, y: n.positionY},
          width: w,
          height: h,
          style: {width: w, height: h, zIndex: 0},
          draggable: false,
          data: {
            node: n,
            doneCount,
            totalCount: kids.length,
            lang,
            onToggleCollapse,
          } satisfies PhaseBoxData,
        });
        continue;
      }

      const parent = n.containerNodeId ? byId.get(n.containerNodeId) : null;
      const relX = parent ? n.positionX - parent.positionX : n.positionX;
      const relY = parent ? n.positionY - parent.positionY : n.positionY;

      outNodes.push({
        id: n.id,
        type: 'twinNode',
        parentId: parent ? parent.id : undefined,
        extent: parent ? 'parent' : undefined,
        position: {x: relX, y: relY},
        width: n.width,
        height: n.height,
        style: {width: n.width, height: n.height, zIndex: 2},
        draggable: false,
        data: {
          node: n,
          selected: n.id === selectedNodeId,
          impacted: impactSet.has(n.code),
          lang,
          mode,
        } satisfies TwinNodeData,
      });
    }

    const visibleIds = new Set(outNodes.map(n => n.id));
    const visibleEdges = edges.filter(
      e => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId),
    );
    const syncEdgesByTarget = new Map<string, number>();
    for (const e of visibleEdges) {
      if (e.label.trim().toLowerCase() === 'sync') {
        syncEdgesByTarget.set(
          e.targetNodeId,
          (syncEdgesByTarget.get(e.targetNodeId) ?? 0) + 1,
        );
      }
    }
    const syncSeenByTarget = new Map<string, number>();

    const outEdges: Edge[] = visibleEdges.map(e => {
      const src = byId.get(e.sourceNodeId);
      const tgt = byId.get(e.targetNodeId);
      const isFail = e.kind === 'fail';
      const isLoop = e.kind === 'loop';
      const isPass = e.kind === 'pass';
      const isCheckpointEdge =
        !isFail &&
        !isLoop &&
        !isPass &&
        (src?.kind === 'checkpoint' || tgt?.kind === 'checkpoint');

      const stroke = isFail
        ? '#ef4444'
        : isLoop
          ? '#f59e0b'
          : isPass
            ? '#16a34a'
            : isCheckpointEdge
              ? '#0d9488'
              : '#6366f1';

      let sourceHandle = 'bottom';
      let targetHandle = 'top';
      if (isLoop) {
        sourceHandle = 'left';
        targetHandle = 'left';
      } else if (src && tgt) {
        const dx = tgt.positionX - src.positionX;
        const dy = tgt.positionY - src.positionY;
        if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) {
          if (dx > 0) {
            sourceHandle = 'right';
            targetHandle = 'left';
          } else {
            sourceHandle = 'left';
            targetHandle = 'right';
          }
        } else if (dy >= 0) {
          sourceHandle = 'bottom';
          targetHandle = 'top';
        } else {
          sourceHandle = 'top';
          targetHandle = 'bottom';
        }
      }

      const rawTrimmed = e.label.trim();
      const isSync = rawTrimmed.toLowerCase() === 'sync';
      let edgeLabel: string | undefined = rawTrimmed
        ? formatEdgeLabel(lang, rawTrimmed)
        : undefined;
      if (isSync) {
        const totalSync = syncEdgesByTarget.get(e.targetNodeId) ?? 1;
        const seen = syncSeenByTarget.get(e.targetNodeId) ?? 0;
        syncSeenByTarget.set(e.targetNodeId, seen + 1);
        if (totalSync > 1 && seen !== Math.floor(totalSync / 2)) {
          edgeLabel = undefined;
        }
      }

      return {
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle,
        targetHandle,
        type: 'smoothstep',
        zIndex: 10,
        animated: mode === 'run' && src?.status === 'running',
        label: edgeLabel,
        labelStyle: {fontSize: 10, fontWeight: 600, fill: '#334155'},
        labelShowBg: Boolean(edgeLabel),
        labelBgStyle: {fill: '#ffffff', fillOpacity: 0.94},
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        },
        style: {
          stroke,
          strokeWidth: isFail || isLoop ? 1.8 : 1.4,
          strokeDasharray: isLoop ? '4 4' : undefined,
        },
      };
    });

    return {rfNodes: outNodes, rfEdges: outEdges};
  }, [
    nodes,
    edges,
    selectedNodeId,
    impactedCodes,
    mode,
    lang,
    onToggleCollapse,
  ]);

  return (
    <div style={{flex: 1, minHeight: 0, width: '100%'}}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{padding: 0.16}}
        onNodeClick={(_evt, node) => onSelectNode(node.id)}
      >
        <Background gap={18} size={1} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={n => {
            if (n.type === 'phaseBox') {
              return '#eef2ff';
            }
            const gNode = (n.data as TwinNodeData | undefined)?.node;
            if (gNode?.kind === 'checkpoint') {
              return '#0d9488';
            }
            if (gNode?.kind === 'restore') {
              return '#ef4444';
            }
            if (gNode?.kind === 'human_gate') {
              return '#f59e0b';
            }
            return '#94a3b8';
          }}
        />
      </ReactFlow>
    </div>
  );
}
