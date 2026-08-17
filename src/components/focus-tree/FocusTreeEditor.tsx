import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from "reactflow";
import "reactflow/dist/style.css";
import type { FocusNode } from "@/data/types";
import { FocusNodeComponent, NODE_WIDTH, NODE_HEIGHT } from "./FocusNodeComponent";
import BrokenLineEdge from "./BrokenLineEdge";
import { ask } from "@tauri-apps/plugin-dialog";

// ---------- Props ----------

interface Props {
  focusTree: {
    focuses: FocusNode[];
  };
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeSelect: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  selectedNodeId: string | null;
  searchQuery?: string;
}

// ---------- Constants ----------

const GRID_X = 180;
const GRID_Y = 180;

export { GRID_X, GRID_Y };

// 高亮颜色 —— 全部由 focusToNode 统一描边（FocusNodeComponent 不再管边框）
const SELECTED_HL_COLOR = "#c9a227"; // 选中金（与组件内文字/背景的选中色一致）
const PREREQ_HL_COLORS = ["#4a9de0", "#3fbf8f", "#9d6de0", "#e8930c"];
const EXCLUSIVE_HL_COLOR = "#d94a4a";
const SEARCH_HL_COLOR = "#2ac3de";

// 连线颜色 —— 贴近原版：前置灰线、互斥红线
const PREREQ_LINE_COLOR = "#9a9a9a";
const PREREQ_OR_LINE_COLOR = "#808080";

// ---------- Node Component Map ----------

const nodeTypes = {
  focus: FocusNodeComponent,
};

const edgeTypes = {
  brokenLine: BrokenLineEdge,
};

// ---------- Relative Position Resolver ----------

function resolvePositions(focuses: FocusNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map<string, FocusNode>();
  for (const f of focuses) {
    byId.set(f.id, f);
  }

  const resolved = new Map<string, { x: number; y: number }>();

  // Build relative-position graph
  const childrenOf = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const f of focuses) {
    if (!inDegree.has(f.id)) inDegree.set(f.id, 0);
    if (!childrenOf.has(f.id)) childrenOf.set(f.id, []);

    if (f.relativePositionId && byId.has(f.relativePositionId)) {
      inDegree.set(f.id, (inDegree.get(f.id) || 0) + 1);
      if (!childrenOf.has(f.relativePositionId)) childrenOf.set(f.relativePositionId, []);
      childrenOf.get(f.relativePositionId)!.push(f.id);
    }
  }

  // Resolve: roots use raw x,y; children add parent's absolute position
  const queue: string[] = [];
  const visited = new Set<string>();

  for (const f of focuses) {
    if ((inDegree.get(f.id) || 0) === 0) {
      resolved.set(f.id, { x: f.x, y: f.y });
      queue.push(f.id);
      visited.add(f.id);
    }
  }

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentAbsPos = resolved.get(parentId)!;
    for (const childId of childrenOf.get(parentId) || []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const child = byId.get(childId)!;
      resolved.set(childId, {
        x: parentAbsPos.x + child.x,
        y: parentAbsPos.y + child.y,
      });
      queue.push(childId);
    }
  }

  // Fallback: any unvisited node uses raw x,y
  for (const f of focuses) {
    if (!visited.has(f.id)) {
      resolved.set(f.id, { x: f.x, y: f.y });
    }
  }

  return resolved;
}

// ---------- Helper Functions ----------

/** 节点关联高亮类型：前置国策（按组取色）或互斥国策 */
interface NodeHighlight {
  kind: "prereq" | "exclusive";
  groupIdx?: number;
}

/**
 * 由选中的国策派生关联高亮映射：nodeId -> highlight
 * 各组前置国策按 prerequisite 的组索引分色；互斥国策统一红色。
 */
function buildHighlightMap(
  focuses: FocusNode[],
  selectedId: string | null
): Map<string, NodeHighlight> {
  const map = new Map<string, NodeHighlight>();
  if (!selectedId) return map;
  const selected = focuses.find((f) => f.id === selectedId);
  if (!selected) return map;

  (selected.prerequisite || []).forEach((group, groupIdx) => {
    for (const pid of group) {
      if (pid === selectedId) continue;
      map.set(pid, { kind: "prereq", groupIdx });
    }
  });

  for (const exId of selected.mutuallyExclusive || []) {
    if (exId === selectedId) continue;
    map.set(exId, { kind: "exclusive" });
  }

  return map;
}

function highlightColor(hl: NodeHighlight): string {
  if (hl.kind === "exclusive") return EXCLUSIVE_HL_COLOR;
  return PREREQ_HL_COLORS[(hl.groupIdx ?? 0) % PREREQ_HL_COLORS.length];
}

function focusToNode(
  focus: FocusNode,
  absolutePos: { x: number; y: number },
  selectedNodeId: string | null,
  searchQuery?: string,
  highlight?: NodeHighlight
): Node<FocusNode> {
  const q = searchQuery?.toLowerCase();
  const matchesSearch =
    q && (
      focus.id.toLowerCase().includes(q) ||
      (focus.icon && focus.icon.toLowerCase().includes(q)) ||
      (focus.searchFilters && focus.searchFilters.some((f) => f.toLowerCase().includes(q))) ||
      (focus.completionReward && focus.completionReward.toLowerCase().includes(q))
    );

  // 高亮优先级：选中 > 关联（互斥/前置） > 搜索；同一节点只渲染一种高亮
  // 描边走 style，背景色走 className（global.css 里 .hl-* 规则），决策统一在此
  let style: CSSProperties | undefined;
  let hlClass: string | undefined;
  if (focus.id === selectedNodeId) {
    hlClass = "hl-selected";
    style = {
      boxShadow: `0 0 0 3px ${SELECTED_HL_COLOR}, 0 0 20px ${SELECTED_HL_COLOR}99, inset 0 0 8px ${SELECTED_HL_COLOR}33`,
      zIndex: 10,
    };
  } else if (highlight) {
    const color = highlightColor(highlight);
    hlClass =
      highlight.kind === "exclusive"
        ? "hl-exclusive"
        : `hl-pre-${(highlight.groupIdx ?? 0) % PREREQ_HL_COLORS.length}`;
    style = {
      boxShadow: `0 0 0 3px ${color}, 0 0 18px ${color}80, inset 0 0 8px ${color}40`,
      zIndex: 6,
    };
  } else if (matchesSearch) {
    hlClass = "hl-search";
    style = {
      boxShadow: `0 0 0 3px ${SEARCH_HL_COLOR}, 0 0 20px ${SEARCH_HL_COLOR}8c, inset 0 0 8px ${SEARCH_HL_COLOR}30`,
      zIndex: 5,
    };
  }

  const pixelX = absolutePos.x * GRID_X - NODE_WIDTH / 2;
  const pixelY = absolutePos.y * GRID_Y - NODE_HEIGHT / 2;

  return {
    id: focus.id,
    type: "focus",
    position: { x: pixelX, y: pixelY },
    data: focus,
    selected: focus.id === selectedNodeId,
    className: hlClass,
    style,
  };
}

function buildEdges(focuses: FocusNode[], absolutePositions: Map<string, { x: number; y: number }>): Edge[] {
  const edges: Edge[] = [];

  // 构建占据网格（用于折线障碍检测）
  const occupiedGrid = new Set<string>();
  for (const f of focuses) {
    occupiedGrid.add(`${absolutePositions.get(f.id)?.x ?? 0},${absolutePositions.get(f.id)?.y ?? 0}`);
  }

  for (const focus of focuses) {
    const preGroups = focus.prerequisite || [];
    const hasMultipleGroups = preGroups.length > 1;

    for (let groupIdx = 0; groupIdx < preGroups.length; groupIdx++) {
      const preGroup = preGroups[groupIdx];
      const isOrGroup = preGroup.length > 1;

      for (const preId of preGroup) {
        const preFocus = focuses.find((f) => f.id === preId);
        if (!preFocus) continue;

        // 网格坐标传递给自定义边
        const edgeData = {
          sourceGridX: absolutePositions.get(preId)?.x ?? 0,
          sourceGridY: absolutePositions.get(preId)?.y ?? 0,
          targetGridX: absolutePositions.get(focus.id)?.x ?? 0,
          targetGridY: absolutePositions.get(focus.id)?.y ?? 0,
          occupiedGrid,
        };

        if (hasMultipleGroups && !isOrGroup) {
          edges.push({
            id: `pre-${preId}-${focus.id}-and`,
            source: preId,
            target: focus.id,
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "brokenLine",
            style: { stroke: PREREQ_LINE_COLOR, strokeWidth: 2 },
            animated: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: PREREQ_LINE_COLOR },
            data: { kind: "prerequisite_and", ...edgeData },
            label: "AND",
            labelStyle: { fill: PREREQ_LINE_COLOR, fontSize: 9, fontWeight: 700 },
            labelBgStyle: { fill: "#1a1a1a", fillOpacity: 0.8 },
            labelBgPadding: [2, 4] as [number, number],
            labelBgBorderRadius: 3,
          });
        } else if (isOrGroup) {
          edges.push({
            id: `pre-${preId}-${focus.id}-or-${groupIdx}`,
            source: preId,
            target: focus.id,
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "brokenLine",
            style: { stroke: PREREQ_OR_LINE_COLOR, strokeWidth: 1.5, strokeDasharray: "6,3" },
            animated: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: PREREQ_OR_LINE_COLOR },
            data: { kind: "prerequisite_or", groupIdx, ...edgeData },
            label: "OR",
            labelStyle: { fill: PREREQ_OR_LINE_COLOR, fontSize: 9, fontWeight: 700 },
            labelBgStyle: { fill: "#1a1a1a", fillOpacity: 0.8 },
            labelBgPadding: [2, 4] as [number, number],
            labelBgBorderRadius: 3,
          });
        } else {
          edges.push({
            id: `pre-${preId}-${focus.id}`,
            source: preId,
            target: focus.id,
            sourceHandle: "bottom",
            targetHandle: "top",
            type: "brokenLine",
            style: { stroke: PREREQ_LINE_COLOR, strokeWidth: 2 },
            animated: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: PREREQ_LINE_COLOR },
            data: { kind: "prerequisite", ...edgeData },
          });
        }
      }
    }
  }

  // Mutually exclusive edges — bidirectional red dashed, same-Y only, adjacent only
  const mutualEdges = new Map<string, { a: string; b: string; y: number }>();
  for (const focus of focuses) {
    for (const exId of focus.mutuallyExclusive || []) {
      const exFocus = focuses.find((f) => f.id === exId);
      if (!exFocus) continue;
      if ((absolutePositions.get(focus.id)?.y ?? 0) !== (absolutePositions.get(exFocus.id)?.y ?? 0)) continue;
      const pairKey = [focus.id, exId].sort().join("||");
      if (!mutualEdges.has(pairKey)) {
        mutualEdges.set(pairKey, { a: focus.id, b: exId, y: (absolutePositions.get(focus.id)?.y ?? 0) });
      }
    }
  }

  const byY = new Map<number, { a: string; b: string }[]>();
  for (const edge of mutualEdges.values()) {
    if (!byY.has(edge.y)) byY.set(edge.y, []);
    byY.get(edge.y)!.push({ a: edge.a, b: edge.b });
  }

  for (const [, pairs] of byY) {
    const adj = new Map<string, Set<string>>();
    for (const { a, b } of pairs) {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
    const nodeIds = [...adj.keys()].sort(
      (a, b) => (absolutePositions.get(a)?.x ?? 0) - (absolutePositions.get(b)?.x ?? 0)
    );
    const adjacentPairs = new Set<string>();
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const left = nodeIds[i];
      for (let j = i + 1; j < nodeIds.length; j++) {
        const right = nodeIds[j];
        if (adj.get(left)?.has(right)) {
          adjacentPairs.add([left, right].sort().join("||"));
          break;
        }
      }
    }

    for (const pairKey of adjacentPairs) {
      const [a, b] = pairKey.split("||");
      const focusA = focuses.find((f) => f.id === a);
      const focusB = focuses.find((f) => f.id === b);
      if (!focusA || !focusB) continue;
      // Dynamically determine handle based on relative position
      const aIsLeft = (absolutePositions.get(a)?.x ?? 0) <= (absolutePositions.get(b)?.x ?? 0);
      const source = aIsLeft ? a : b;
      const target = aIsLeft ? b : a;
      edges.push({
        id: `mutual-${pairKey}`,
        source,
        target,
        sourceHandle: "right",
        targetHandle: "left",
        type: "brokenLine",
        style: { stroke: EXCLUSIVE_HL_COLOR, strokeWidth: 2 },
        animated: false,
        markerStart: { type: MarkerType.ArrowClosed, color: EXCLUSIVE_HL_COLOR },
        markerEnd: { type: MarkerType.ArrowClosed, color: EXCLUSIVE_HL_COLOR },
        data: { kind: "mutuallyExclusive", isExclusive: true },
      });
    }
  }

  return edges;
}

// ---------- Inner Component ----------

function FocusTreeEditorInner({
  focusTree,
  onNodeMove,
  onNodeSelect,
  onBatchDelete,
  selectedNodeId,
  searchQuery,
}: Props) {
  const { fitView, setCenter, getViewport, setViewport } = useReactFlow();

  // Drag guard: skip useEffect sync while dragging
  const isDragging = useRef(false);

  // Resolve relative positions
  const absolutePositions = useMemo(
    () => resolvePositions(focusTree.focuses),
    [focusTree.focuses]
  );

  // 选中国策的关联高亮映射（前置/互斥）
  const highlightMap = useMemo(
    () => buildHighlightMap(focusTree.focuses, selectedNodeId),
    [focusTree.focuses, selectedNodeId]
  );

  // Build nodes
  const initialNodes = useMemo(
    () =>
      focusTree.focuses.map((f) => {
        const abs = absolutePositions.get(f.id) || { x: f.x, y: f.y };
        return focusToNode(f, abs, selectedNodeId, searchQuery, highlightMap.get(f.id));
      }),
    [focusTree.focuses, absolutePositions, selectedNodeId, searchQuery, highlightMap]
  );

  // Build edges
  const initialEdges = useMemo(
    () => buildEdges(focusTree.focuses, absolutePositions),
    [focusTree.focuses, absolutePositions]
  );

  const [nodes, setNodes] = useState<Node<FocusNode>[]>(() => initialNodes);
  const [edges, setEdges] = useState<Edge[]>(() => initialEdges);

  // Sync nodes/edges from data whenever it changes (skip during drag)
  useEffect(() => {
    if (isDragging.current) return;
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  // Fit view on first load
  const hasFitViewRef = useRef(false);
  useEffect(() => {
    if (!hasFitViewRef.current && focusTree.focuses.length > 0) {
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
        hasFitViewRef.current = true;
      }, 50);
    }
  }, [focusTree.focuses.length, fitView]);

  // Node change handler: apply all changes via official API
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const ch of changes) {
        if (ch.type === "select" && ch.selected) {
          onNodeSelect(ch.id);
        }
      }
    },
    [onNodeSelect]
  );

  // Drag start/end: guard against useEffect overwriting drag position
  const handleNodeDragStart = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      isDragging.current = false;

      // Snap to center-based grid
      const cx = node.position.x + NODE_WIDTH / 2;
      const cy = node.position.y + NODE_HEIGHT / 2;
      const gridX = Math.round(cx / GRID_X);
      const gridY = Math.round(cy / GRID_Y);

      const focus = focusTree.focuses.find((f) => f.id === node.id);
      let saveX = gridX;
      let saveY = gridY;
      if (focus?.relativePositionId) {
        const parentAbsPos = absolutePositions.get(focus.relativePositionId);
        if (parentAbsPos) {
          saveX = gridX - parentAbsPos.x;
          saveY = gridY - parentAbsPos.y;
        }
      }

      onNodeMove(node.id, saveX, saveY);
    },
    [onNodeMove, focusTree.focuses, absolutePositions]
  );

  // Edge change handler
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        let changed = false;
        const next = eds.filter((e) => {
          const ch = changes.find((c) => c.type === "remove" && c.id === e.id);
          if (ch) changed = true;
          return !ch;
        });
        return changed ? next : eds;
      });
    },
    []
  );

  // Node click
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect]
  );

  // Node double-click → center
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setCenter(node.position.x + GRID_X / 2, node.position.y + GRID_Y / 2, {
        zoom: 1,
        duration: 300,
      });
    },
    [setCenter]
  );

  // Minimap color
  const minimapNodeColor = useCallback(
    (node: Node) => {
      if (node.id === selectedNodeId) return "#c9a227";
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const focus = focusTree.focuses.find((f) => f.id === node.id);
        if (focus && (
          focus.id.toLowerCase().includes(q) ||
          (focus.icon && focus.icon.toLowerCase().includes(q)) ||
          (focus.searchFilters && focus.searchFilters.some((f) => f.toLowerCase().includes(q))) ||
          (focus.completionReward && focus.completionReward.toLowerCase().includes(q))
        )) {
          return SEARCH_HL_COLOR;
        }
      }
      return "#3a5a8c";
    },
    [selectedNodeId, searchQuery, focusTree.focuses]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "=" || e.key === "+" || e.key === "Add") {
        e.preventDefault();
        const viewport = getViewport();
        setViewport({ ...viewport, zoom: Math.min(viewport.zoom * 1.2, 3) });
      }
      if (e.key === "-" || e.key === "Subtract") {
        e.preventDefault();
        const viewport = getViewport();
        setViewport({ ...viewport, zoom: Math.max(viewport.zoom / 1.2, 0.05) });
      }
      if (e.key === "0") {
        e.preventDefault();
        fitView({ padding: 0.2, duration: 300 });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const vp = getViewport();
        setViewport({ x: vp.x, y: vp.y + 80, zoom: vp.zoom });
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const vp = getViewport();
        setViewport({ x: vp.x, y: vp.y - 80, zoom: vp.zoom });
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const vp = getViewport();
        setViewport({ x: vp.x + 80, y: vp.y, zoom: vp.zoom });
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const vp = getViewport();
        setViewport({ x: vp.x - 80, y: vp.y, zoom: vp.zoom });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fitView, getViewport, setViewport]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        multiSelectionKeyCode="Shift"
        onNodesDelete={async (deletedNodes) => {
          if (deletedNodes.length > 0 && await ask(`删除 ${deletedNodes.length} 个选中节点？`, { title: '确认删除' })) {
            onBatchDelete(deletedNodes.map((n) => n.id));
          }
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#333"
        />
        <Controls
          showInteractive={false}
          position="bottom-right"
        />
        <MiniMap
          position="bottom-left"
          nodeColor={minimapNodeColor}
          maskColor="rgba(0,0,0,0.6)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// ---------- Wrapper ----------

export function FocusTreeEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <FocusTreeEditorInner {...props} />
    </ReactFlowProvider>
  );
}
