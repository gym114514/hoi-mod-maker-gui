import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTreeStore, useProjectStore, useEditorUIStore } from "@/stores";
import { invoke } from "@tauri-apps/api/core";
import { save, ask } from "@tauri-apps/plugin-dialog";
import type { FocusTree, FocusNode } from "@/data/types";
import { FocusTreeEditor } from "./FocusTreeEditor";
import { FocusPropertyPanel } from "./FocusPropertyPanel";
import { ResizeHandle } from "@/components/common/ResizeHandle";

// ---------- Demo Data ----------

const DEMO_POLAND_TREE: FocusTree = {
  id: "polish_focus",
  country: [{ factor: 0, modifier: { add: 10, tag: "POL" } }],
  default: false,
  initialShowPosition: { focus: "POL_starting_focus" },
  focuses: [
    {
      id: "POL_starting_focus",
      icon: "GFX_focus_POL",
      x: 0,
      y: 0,
      cost: 5,
      prerequisite: [],
      mutuallyExclusive: [],
      searchFilters: ["FOCUS_FILTER_POLITICAL"],
      completionReward: "add_political_power = 50",
    },
    {
      id: "POL_military_base",
      icon: "GFX_focus_generic_military",
      x: 0,
      y: 1,
      cost: 7,
      prerequisite: [["POL_starting_focus"]],
      mutuallyExclusive: ["POL_political_base"],
      searchFilters: ["FOCUS_FILTER_WAR_SUPPORT", "FOCUS_FILTER_ARMY_XP"],
      completionReward: "army_experience = 25\nadd_manpower = 5000",
    },
    {
      id: "POL_political_base",
      icon: "GFX_focus_generic_political_pressure",
      x: 2,
      y: 1,
      cost: 7,
      prerequisite: [["POL_starting_focus"]],
      mutuallyExclusive: ["POL_military_base"],
      searchFilters: ["FOCUS_FILTER_POLITICAL"],
      completionReward: "add_political_power = 150",
    },
    {
      id: "POL_democratic_path",
      icon: "GFX_focus_generic_economy",
      x: 1,
      y: 2,
      cost: 10,
      prerequisite: [["POL_political_base"]],
      mutuallyExclusive: [],
      searchFilters: ["FOCUS_FILTER_STABILITY"],
      completionReward:
        "add_stability = 0.1\nadd_popularity = { ideology = democratic popularity = 0.15 }",
    },
    {
      id: "POL_industry_1",
      icon: "GFX_focus_generic_industry",
      x: 3,
      y: 2,
      cost: 10,
      prerequisite: [["POL_political_base"]],
      mutuallyExclusive: [],
      searchFilters: ["FOCUS_FILTER_INDUSTRY"],
      completionReward:
        "random_owned_controlled_state = {\n  limit = { free_building_slots = { building = industrial_complex size > 0 } }\n  add_extra_state_shared_building_slots = 1\n}",
    },
  ],
};

// ---------- History for Undo/Redo ----------

function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<{ past: T[]; present: T; future: T[] }>({
    past: [],
    present: initial,
    future: [],
  });

  const push = useCallback((newPresent: T) => {
    setHistory((prev) => ({
      past: [...prev.past, prev.present],
      present: newPresent,
      future: [],
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: prev.future.slice(1),
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return { history: history.present, push, undo, redo, canUndo, canRedo };
}

// ---------- Condition AST (allowBranch parsing) ----------

/**
 * allowBranch AST node types:
 * - AND: all children must be satisfied
 * - OR: at least one child must be satisfied
 * - NOT: child must NOT be satisfied
 * - ATOMIC: a single indivisible condition (e.g. tag = GER)
 *
 * Parsing rules (HOI4 semantics):
 * - Top-level key=value pairs are AND-ed
 * - OR/AND/NOT blocks are logical operators
 * - if/limit/else blocks are CONDITIONAL EFFECTS 鈫?skipped
 */

type ConditionNode =
  | { type: "and"; children: ConditionNode[] }
  | { type: "or"; children: ConditionNode[] }
  | { type: "not"; child: ConditionNode }
  | { type: "atomic"; key: string; value: string; label: string; id: string };

function hashStr(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return "c_" + Math.abs(hash).toString(36);
}

/**
 * Parse allowBranch text into a ConditionNode tree.
 * Returns null if allowBranch is empty or absent.
 */
function parseConditionTree(allowBranch: string | undefined): ConditionNode | null {
  if (!allowBranch || allowBranch.trim() === "") return null;

  const SKIP = new Set(["if", "limit", "else"]);

  function parseBlock(text: string): ConditionNode[] {
    const nodes: ConditionNode[] = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) break;

      let key = "";
      while (i < text.length && /[a-zA-Z0-9_]/.test(text[i])) {
        key += text[i]; i++;
      }
      if (!key) { i++; continue; }

      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) break;

      if (text[i] !== "=") continue;
      i++;

      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) break;

      if (text[i] === "{") {
        // Block value
        let depth = 1;
        let start = i + 1;
        i++;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth++;
          else if (text[i] === "}") depth--;
          i++;
        }
        const content = text.substring(start, i - 1);
        const kLower = key.toLowerCase();

        if (SKIP.has(kLower)) continue;

        if (kLower === "not") {
          const children = parseBlock(content);
          if (children.length === 1) {
            nodes.push({ type: "not", child: children[0] });
          } else if (children.length > 1) {
            nodes.push({ type: "not", child: { type: "and", children } });
          }
        } else if (kLower === "or" || kLower === "and") {
          const children = parseBlock(content);
          if (children.length > 0) {
            nodes.push({ type: kLower as "or" | "and", children });
          }
        } else {
          // Compound condition (e.g. has_game_rule = { ... })
          const label = key + " = { ... }";
          nodes.push({
            type: "atomic",
            key: key.toLowerCase(),
            value: "{...}",
            label,
            id: hashStr(label),
          });
        }
      } else {
        // Scalar value
        let value = "";
        if (text[i] === '"' || text[i] === "'") {
          const q = text[i];
          value += text[i]; i++;
          while (i < text.length && text[i] !== q) { value += text[i]; i++; }
          if (i < text.length) { value += text[i]; i++; }
        } else {
          while (i < text.length && !/[\s{}]/.test(text[i])) { value += text[i]; i++; }
        }
        const cleanValue = value.replace(/["']/g, "");
        const label = key + " = " + cleanValue;
        nodes.push({
          type: "atomic",
          key: key.toLowerCase(),
          value: cleanValue,
          label,
          id: hashStr(label),
        });
      }
    }
    return nodes;
  }

  const nodes = parseBlock(allowBranch);
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0];
  return { type: "and", children: nodes };
}

/**
 * Extract all unique atomic conditions from a condition tree.
 */
function extractAtomics(node: ConditionNode | null): Map<string, { key: string; value: string; label: string; id: string }> {
  const result = new Map<string, { key: string; value: string; label: string; id: string }>();
  if (!node) return result;

  function walk(n: ConditionNode) {
    if (n.type === "atomic") {
      if (!result.has(n.id)) result.set(n.id, n);
    } else if (n.type === "not") {
      walk(n.child);
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(node);
  return result;
}

/**
 * Evaluate a condition tree against a set of satisfied atomic condition IDs.
 */
function evaluateConditionTree(node: ConditionNode | null, satisfiedIds: Set<string>): boolean {
  if (!node) return true; // no condition 鈫?always visible

  switch (node.type) {
    case "atomic":
      return satisfiedIds.has(node.id);
    case "and":
      return node.children.every((c) => evaluateConditionTree(c, satisfiedIds));
    case "or":
      return node.children.some((c) => evaluateConditionTree(c, satisfiedIds));
    case "not":
      return !evaluateConditionTree(node.child, satisfiedIds);
  }
}

// ---------- Atomic Condition Filter ----------

interface FocusConditionInfo {
  /** Combined condition tree (own + inherited from ancestors) */
  tree: ConditionNode | null;
  /** All atomic conditions in the combined tree */
  atomics: Map<string, { key: string; value: string; label: string; id: string }>;
}

/**
 * Build condition info for each focus, including inheritance from ancestors.
 * A focus's effective condition = AND(own allowBranch, parent's effective condition).
 */
function buildFocusConditions(focuses: FocusNode[]): Map<string, FocusConditionInfo> {
  const result = new Map<string, FocusConditionInfo>();
  const byId = new Map(focuses.map((f) => [f.id, f]));

  // Build parent map
  const parents = new Map<string, Set<string>>();
  for (const f of focuses) {
    if (!parents.has(f.id)) parents.set(f.id, new Set());
    for (const orGroup of f.prerequisite || []) {
      for (const pid of orGroup) {
        parents.get(f.id)!.add(pid);
      }
    }
  }

  // Topological sort (BFS from roots)
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const f of focuses) {
    if (!parents.has(f.id) || parents.get(f.id)!.size === 0) {
      queue.push(f.id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const focus = byId.get(id);
    if (!focus) continue;

    const ownTree = parseConditionTree(focus.allowBranch);

    // Inherit from parents
    const parentTrees: ConditionNode[] = [];
    for (const pid of parents.get(id) || []) {
      const pInfo = result.get(pid);
      if (pInfo?.tree) parentTrees.push(pInfo.tree);
    }

    // Combine: own + inherited (AND)
    let combinedTree: ConditionNode | null = ownTree;
    if (parentTrees.length > 0) {
      const allTrees = ownTree ? [ownTree, ...parentTrees] : parentTrees;
      if (allTrees.length === 1) {
        combinedTree = allTrees[0];
      } else {
        combinedTree = { type: "and", children: allTrees };
      }
    }

    const atomics = extractAtomics(combinedTree);
    result.set(id, { tree: combinedTree, atomics });

    // Enqueue children
    for (const f2 of focuses) {
      for (const orGroup of f2.prerequisite || []) {
        if (orGroup.includes(id)) {
          queue.push(f2.id);
        }
      }
    }
  }

  // Handle any unvisited focuses (cycles)
  for (const f of focuses) {
    if (!result.has(f.id)) {
      const ownTree = parseConditionTree(f.allowBranch);
      result.set(f.id, { tree: ownTree, atomics: extractAtomics(ownTree) });
    }
  }

  return result;
}

/**
 * Get all unique atomic conditions across all focuses, grouped by key.
 */
function collectAllAtomics(
  focusConditions: Map<string, FocusConditionInfo>
): Map<string, { key: string; value: string; label: string; id: string }> {
  const all = new Map<string, { key: string; value: string; label: string; id: string }>();
  for (const info of focusConditions.values()) {
    for (const [id, atomic] of info.atomics) {
      if (!all.has(id)) all.set(id, atomic);
    }
  }
  return all;
}

// ---------- Atomic Condition Filter UI ----------

function AtomicConditionFilter({
  allAtomics,
  satisfiedIds,
  onToggle,
  filteredCount,
  totalCount,
}: {
  allAtomics: Map<string, { key: string; value: string; label: string; id: string }>;
  satisfiedIds: Set<string>;
  onToggle: (id: string) => void;
  filteredCount: number;
  totalCount: number;
}) {
  if (allAtomics.size === 0) return null;

  // Group by key
  const byKey = new Map<string, typeof allAtomics extends Map<string, infer V> ? V[] : never>();
  for (const atomic of allAtomics.values()) {
    const key = atomic.key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(atomic);
  }

  const keyOrder = ["tag", "original_tag", "has_dlc", "has_government", "ideology", "has_country_flag", "has_global_flag"];
  const sortedKeys = [...byKey.keys()].sort((a, b) => {
    const ia = keyOrder.indexOf(a);
    const ib = keyOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  const satisfiedCount = [...allAtomics.values()].filter((a) => satisfiedIds.has(a.id)).length;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        background: "#1a1a2e",
        borderBottom: "1px solid #333",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11, color: "#888" }}>{"条件："}</span>
      {sortedKeys.map((key) => (
        <div
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 6px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid #333",
          }}
        >
          <span style={{ fontSize: 10, color: "#666", marginRight: 2 }}>{key}:</span>
          {byKey.get(key)!.map((atomic) => {
            const isOn = satisfiedIds.has(atomic.id);
            return (
              <button
                key={atomic.id}
                onClick={() => onToggle(atomic.id)}
                title={atomic.label}
                style={{
                  padding: "1px 6px",
                  borderRadius: 8,
                  fontSize: 10,
                  border: isOn ? "1px solid #4ade80" : "1px solid #444",
                  background: isOn ? "#14532d" : "transparent",
                  color: isOn ? "#4ade80" : "#777",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {atomic.value}
              </button>
            );
          })}
        </div>
      ))}
      <div style={{ marginLeft: "auto" }} />
      <span style={{ fontSize: 10, color: "#666" }}>
        <span style={{ color: "#4ade80" }}>{satisfiedCount}</span>/{allAtomics.size} {"满足"}
        {"\u00A0·\u00A0"}
        {filteredCount}/{totalCount} {"节点可见"}
      </span>
    </div>
  );
}

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSaveAs: () => void;
  onOverwrite: () => void;
  hasActiveFile: boolean;
  nodeCount: number;
  inputRef?: React.RefObject<HTMLInputElement>;
}

function SearchBar({
  value,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSaveAs,
  onOverwrite,
  hasActiveFile,
  nodeCount,
  inputRef,
}: SearchBarProps & { inputRef?: React.RefObject<HTMLInputElement> }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        right: 8,
        display: "flex",
        alignItems: "center",
        gap: 8,
        zIndex: 10,
        background: "rgba(20,20,20,0.9)",
        borderRadius: 8,
        padding: "6px 10px",
        border: "1px solid #3d3d3d",
      }}
    >
      <span style={{ color: "#707070", fontSize: 14 }}>{"📂"}</span>
      <input
        ref={inputRef}
        type="text"
        placeholder={"搜索节点... (ID / 图标 / 过滤器 / 效果)"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#e8e8e8",
          fontSize: 13,
          minWidth: 0,
        }}
      />
      <span style={{ color: "#707070", fontSize: 11, whiteSpace: "nowrap" }}>
        {nodeCount} {"节点"}
      </span>
      <div style={{ width: 1, height: 20, background: "#3d3d3d" }} />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title={"撤销 (Ctrl+Z)"}
        style={{
          background: "transparent",
          border: "none",
          color: canUndo ? "#e8e8e8" : "#404040",
          cursor: canUndo ? "pointer" : "default",
          fontSize: 14,
          padding: "2px 6px",
          borderRadius: 4,
        }}
      >
        {"↩️"}
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="重做 (Ctrl+Y)"
        style={{
          background: "transparent",
          border: "none",
          color: canRedo ? "#e8e8e8" : "#404040",
          cursor: canRedo ? "pointer" : "default",
          fontSize: 14,
          padding: "2px 6px",
          borderRadius: 4,
        }}
      >
        {"↩️"}
      </button>
      <div style={{ width: 1, height: 20, background: "#3d3d3d" }} />
      <button
        onClick={onSaveAs}
        title="另存为... (选择新位置保存)"
        style={{
          background: "#2d4a2d",
          border: "1px solid #3d6a3d",
          color: "#6fcf6f",
          cursor: "pointer",
          fontSize: 12,
          padding: "3px 10px",
          borderRadius: 4,
        }}
      >
        {"📋 另存为"}
      </button>
      <button
        onClick={onOverwrite}
        disabled={!hasActiveFile}
        title={hasActiveFile ? "覆盖原文" : "没有打开的文件"}
        style={{
          background: hasActiveFile ? "#4a2d2d" : "#2a2a2a",
          border: hasActiveFile ? "1px solid #6a3d3d" : "1px solid #3d3d3d",
          color: hasActiveFile ? "#e8a8a8" : "#606060",
          cursor: hasActiveFile ? "pointer" : "not-allowed",
          fontSize: 12,
          padding: "3px 10px",
          borderRadius: 4,
        }}
      >
        {"📋 覆盖原文件"}
      </button>
    </div>
  );
}

// ---------- Branch Filter Component ----------

export function FocusTreePanel() {
  const { activeFile } = useProjectStore();
  const updateFileContent = useProjectStore((s) => s.updateFileContent);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { selectedFocusId, updateFocus, removeFocus, selectFocus } =
    useFocusTreeStore();
  const rightPanelWidth = useEditorUIStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useEditorUIStore((s) => s.setRightPanelWidth);

  const [treeData, setTreeData] = useState<FocusNode[]>(DEMO_POLAND_TREE.focuses);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Expose debug info on window
  useEffect(() => {
    (window as any).__treeDebug = {
      treeData,
      setTreeData,
      selectedFocus: treeData.find(f => f.id === selectedFocusId),
      listFocuses: () => treeData.map(f => ({
        id: f.id,
        hasBlocks: !!f.blocks,
        hasCR: !!f.completionReward,
        hasAvail: !!f.available,
        hasBypass: !!f.bypass,
        hasSE: !!f.selectEffect,
      })),
    };
  }, [treeData, selectedFocusId]);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Build condition AST for each focus (with inheritance from ancestors)
  const focusConditions = useMemo(() => buildFocusConditions(treeData), [treeData]);
  const allAtomics = useMemo(() => collectAllAtomics(focusConditions), [focusConditions]);

  // User-toggled satisfied atomic condition IDs
  const [satisfiedIds, setSatisfiedIds] = useState<Set<string>>(new Set());

  // Filtered focuses: visible if all inherited+own atomic conditions are satisfied
  const filteredFocuses = useMemo(() => {
    return treeData.filter((f) => {
      const info = focusConditions.get(f.id);
      if (!info || !info.tree) return true; // no condition -> always visible
      return evaluateConditionTree(info.tree, satisfiedIds);
    });
  }, [treeData, focusConditions, satisfiedIds]);

  // Toggle an atomic condition
  const handleAtomicToggle = useCallback((id: string) => {
    setSatisfiedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reset filter when tree data changes (new file loaded)
  useEffect(() => {
    setSatisfiedIds(new Set());
  }, [activeFile?.path]);
  // Track last loaded path
  const lastLoadedRef = useRef<string | null>(null);
  const isRealDataRef = useRef(false);

  // Undo/Redo history
  const { history: historyNodes, push: pushHistory, undo, redo, canUndo, canRedo } =
    useHistory<FocusNode[]>(DEMO_POLAND_TREE.focuses);

  // Sync treeData with history
  useEffect(() => {
    setTreeData(historyNodes);
  }, [historyNodes]);

  // Load tree when activeFile changes
  useEffect(() => {
    if (!activeFile || activeFile.type !== "focus_tree") {
      setTreeData(DEMO_POLAND_TREE.focuses);
      pushHistory(DEMO_POLAND_TREE.focuses);
      setParseError(null);
      lastLoadedRef.current = null;
      isRealDataRef.current = false;
      return;
    }

    if (activeFile.path === lastLoadedRef.current) return;
    lastLoadedRef.current = activeFile.path;


    setIsLoading(true);
    setParseError(null);

    // Create temp copy first, then parse from it
    const doLoad = async () => {
      try {
        // tmp copy is already created by store.openFile()
        const tmpPath = useProjectStore.getState().tempPath;
        if (!tmpPath) {
          console.warn("[FocusTreePanel] No tempPath set, skipping parse");
          return;
        }
        tempPathRef.current = tmpPath;
        autoSavePathRef.current = tmpPath;

        const json = await invoke<string>("parse_focus_tree_cmd", { path: tmpPath });
        const parsed = JSON.parse(json);
        const focuses: FocusNode[] = (parsed.focuses || []).map((f: any) => ({
          id: f.id,
          icon: f.icon || "GFX_focus_generic",
          x: f.x ?? 0,
          y: f.y ?? 0,
          cost: f.cost ?? 1,
          relativePositionId: f.relativePositionId,
          prerequisite: f.prerequisite || [],
          mutuallyExclusive: f.mutuallyExclusive || [],
          available: f.available,
          allowBranch: f.allowBranch,
          bypass: f.bypass,
          completionReward: f.completionReward,
          selectEffect: f.selectEffect,
          hiddenEffect: f.hiddenEffect,
          searchFilters: f.searchFilters || [],
          innerCircle: f.innerCircle,
          continuous: f.continuous,
          dynamic: f.dynamic,
          cancelIfInvalid: f.cancelIfInvalid,
          continueIfInvalid: f.continueIfInvalid,
          availableIfCapitulated: f.availableIfCapitulated,
        }));
        if (focuses.length === 0) {
          console.warn("[FocusTreePanel] No focuses found, using demo data");
          setParseError("\u6ca1\u6709\u5728\u6587\u4ef6\u4e2d\u627e\u5230 focus \u8282\u70b9\uff08\u53ef\u80fd\u662f\u7a7a\u6587\u4ef6\u6216\u683c\u5f0f\u4e0d\u5339\u914d\uff09");
          setTreeData(DEMO_POLAND_TREE.focuses);
          pushHistory(DEMO_POLAND_TREE.focuses);
          isRealDataRef.current = false;
          return;
        }
        setTreeData(focuses);
        pushHistory(focuses);
        useFocusTreeStore.getState().setActiveFocusTree({ id: "loaded", focuses });
        isRealDataRef.current = true;
      } catch (e) {
        console.error("[FocusTreePanel] Parse error:", e);
        setParseError(String(e));
        setTreeData(DEMO_POLAND_TREE.focuses);
        pushHistory(DEMO_POLAND_TREE.focuses);
        useFocusTreeStore.getState().setFocusTrees([DEMO_POLAND_TREE]);
        useFocusTreeStore.getState().setActiveFocusTree(DEMO_POLAND_TREE);
        isRealDataRef.current = false;
      } finally {
        setIsLoading(false);
      }
    };
    doLoad();
  }, [activeFile?.path, activeFile?.type, pushHistory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        redo();
      }
      // Ctrl+F or / 鈫?focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // Escape 鈫?clear search + deselect
      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        } else {
          setSearchQuery("");
          selectFocus(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Node move
  const handleNodeMove = useCallback(
    (id: string, x: number, y: number) => {
      const updated = treeData.map((f) => (f.id === id ? { ...f, x, y } : f));
      setTreeData(updated);
      pushHistory(updated);
      updateFocus(id, { x, y });
    },
    [treeData, pushHistory, updateFocus]
  );

  // Focus update (with bidirectional mutuallyExclusive sync)
  const handleFocusUpdate = useCallback(
    (id: string, updates: Partial<FocusNode>) => {
      let updated = treeData.map((f) => (f.id === id ? { ...f, ...updates } : f));

      // Bidirectional sync for mutuallyExclusive
      if (updates.mutuallyExclusive !== undefined) {
        const oldEx = treeData.find((f) => f.id === id)?.mutuallyExclusive || [];
        const newEx = updates.mutuallyExclusive as string[];
        const added = newEx.filter((x) => x !== "" && !oldEx.includes(x));
        const removed = oldEx.filter((x) => !newEx.includes(x));

        updated = updated.map((f) => {
          if (added.includes(f.id)) {
            const ex = f.mutuallyExclusive || [];
            if (!ex.includes(id)) return { ...f, mutuallyExclusive: [...ex, id] };
          }
          if (removed.includes(f.id)) {
            return { ...f, mutuallyExclusive: (f.mutuallyExclusive || []).filter((x) => x !== id) };
          }
          return f;
        });
      }

      setTreeData(updated);
      pushHistory(updated);
      updateFocus(id, updates);
      // Also sync the other side to store
      if (updates.mutuallyExclusive !== undefined) {
        const oldEx = treeData.find((f) => f.id === id)?.mutuallyExclusive || [];
        const newEx = updates.mutuallyExclusive as string[];
        const added = newEx.filter((x) => x !== "" && !oldEx.includes(x));
        const removed = oldEx.filter((x) => !newEx.includes(x));
        for (const targetId of added) {
          const target = updated.find((f) => f.id === targetId);
          if (target) updateFocus(targetId, { mutuallyExclusive: target.mutuallyExclusive });
        }
        for (const targetId of removed) {
          const target = updated.find((f) => f.id === targetId);
          if (target) updateFocus(targetId, { mutuallyExclusive: target.mutuallyExclusive });
        }
      }
    },
    [treeData, pushHistory, updateFocus]
  );

  // Focus delete
  const handleFocusDelete = useCallback(
    async (id: string) => {
      if (!await ask('删除国策 "' + id + '"？\n\n这将同时移除所有依赖该节点的前置依赖。', { title: '确认删除' })) return;

      const updated = treeData
        .filter((f) => f.id !== id)
        .map((f) => ({
          ...f,
          prerequisite: (f.prerequisite || [])
            .map((g) => g.filter((preId) => preId !== id))
            .filter((g) => g.length > 0),
          mutuallyExclusive: (f.mutuallyExclusive || []).filter((exId) => exId !== id),
        }));

      setTreeData(updated);
      pushHistory(updated);
      removeFocus(id);
      selectFocus(null);
    },
    [treeData, pushHistory, removeFocus, selectFocus]
  );

  // Batch delete
  const handleBatchDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const updated = treeData
        .filter((f) => !idSet.has(f.id))
        .map((f) => ({
          ...f,
          prerequisite: (f.prerequisite || [])
            .map((g) => g.filter((preId) => !idSet.has(preId)))
            .filter((g) => g.length > 0),
          mutuallyExclusive: (f.mutuallyExclusive || []).filter((exId) => !idSet.has(exId)),
        }));

      setTreeData(updated);
      pushHistory(updated);
      ids.forEach((id) => removeFocus(id));
      selectFocus(null);
    },
    [treeData, pushHistory, removeFocus, selectFocus]
  );

  // Add new focus
  const handleAddFocus = useCallback(
    (newFocus: FocusNode) => {
      const updated = [...treeData, newFocus];
      setTreeData(updated);
      pushHistory(updated);
      useFocusTreeStore.getState().addFocus(newFocus);
      selectFocus(newFocus.id);
    },
    [treeData, pushHistory, selectFocus]
  );

  // Export to .txt - Save As (choose new location)
  const handleSaveAs = useCallback(async () => {
    try {
      // Get default filename from current file or generate one
      const defaultName = activeFile?.name?.replace(/\.txt$/i, "") || "custom_focus_tree";
      
      // Open save dialog
      const savePath = await save({
        filters: [{ name: "HOI4 Focus Tree", extensions: ["txt"] }],
        defaultPath: `${defaultName}.txt`,
      });
      
      if (!savePath) return; // User cancelled
      
      const json = JSON.stringify({ focuses: treeData });
      const result = await invoke<string>("export_focus_tree_cmd", {
        path: savePath,
        json,
      });
      
      // Update active file reference to the new path
      if (activeFile) {
        useProjectStore.getState().addFile({
          ...activeFile,
          path: savePath,
          name: savePath.split(/[/\\]/).pop() || defaultName,
        });
      }
      
      alert("✅ 另存为成功！\n\n" + result);
    } catch (e) {
      console.error("[FocusTreePanel] Save As error:", e);
      // Fallback to clipboard
      try {
        const txt = generateFocusTreeTxt(treeData);
        await navigator.clipboard.writeText(txt);
            alert("另存失败（文件创建失败）\n\n请检查路径权限或磁盘空间。");
      } catch {
          alert("另存为失败：" + String(e));
      }
    }
  }, [treeData, activeFile]);

  // Export to .txt - Overwrite existing file
  const handleOverwrite = useCallback(async () => {
    if (!activeFile?.path) {
          alert("⚠ 没有打开的文件");
      return;
    }
    
    if (!await ask(`确定要覆盖原文件吗？\n\n${activeFile.path}`, { title: "确认覆盖" })) {
      return;
    }
    
    try {
      const json = JSON.stringify({ focuses: treeData });
      const result = await invoke<string>("export_focus_tree_cmd", {
        path: activeFile.path,
        json,
      });
      alert("✅ 已覆盖原文件！\n\n" + result);
    } catch (e) {
      console.error("[FocusTreePanel] Overwrite error:", e);
      alert("覆盖失败：" + String(e));
    }
  }, [treeData, activeFile]);

  // Auto-save helper (ref to avoid re-triggering effect)
  const autoSavePathRef = useRef<string | null>(null);
  // Temp file path: all reads/writes go through this
  const tempPathRef = useRef<string | null>(null);

  // Debounced sync: treeData 鈫?activeFile.content + auto-save to disk + cache
  useEffect(() => {
    if (!activeFile?.path || activeFile.type !== "focus_tree") return;
    // Update store cache immediately
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      const code = generateFocusTreeTxt(treeData);
      updateFileContent(activeFile.path, code);
      if (autoSavePathRef.current) {
        invoke("write_text_file", { path: autoSavePathRef.current, content: code }).catch(() => {});
      }
    }, 500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      const code = generateFocusTreeTxt(treeData);
      updateFileContent(activeFile.path, code);
      if (autoSavePathRef.current) {
        invoke("write_text_file", { path: autoSavePathRef.current, content: code }).catch(() => {});
      }
    };
  }, [treeData, activeFile?.path, activeFile?.type, updateFileContent]);

  const selectedFocus = treeData.find((f) => f.id === selectedFocusId) || null;

  if (!activeFile || activeFile.type !== "focus_tree") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-text-secondary)",
          fontSize: 14,
          gap: 8,
          flexDirection: "column",
        }}
      >
        <span style={{ fontSize: 32 }}>{"📂"}</span>
        <span>{"在左侧选择一个国策树文件开始编辑"}</span>
        {activeFile && activeFile.type !== "focus_tree" && (
          <span style={{ fontSize: 12, color: "#888" }}>
            当前文件类型：{activeFile.type}（不支持国策树视图）
          </span>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-text-secondary)",
          fontSize: 14,
          gap: 8,
        }}
      >
          <span>{"正在解析国策树..."}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {parseError && (
          <div
            style={{
              position: "absolute",
              top: 60,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#3d1a1a",
              border: "1px solid #c0392b",
              color: "#f5c6cb",
              padding: "6px 16px",
              borderRadius: 6,
              fontSize: 12,
              zIndex: 10,
              maxWidth: 400,
              textAlign: "center",
            }}
          >
            {"⚠️ 解析失败，显示演示数据："}{parseError.slice(0, 80)}
          </div>
        )}

        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onSaveAs={handleSaveAs}
          onOverwrite={handleOverwrite}
          hasActiveFile={!!activeFile?.path}
          nodeCount={treeData.length}
          inputRef={searchInputRef}
        />

        <div style={{ width: "100%", height: "100%", paddingTop: 48, display: "flex", flexDirection: "column" }}>
          <AtomicConditionFilter
            allAtomics={allAtomics}
            satisfiedIds={satisfiedIds}
            onToggle={handleAtomicToggle}
            filteredCount={filteredFocuses.length}
            totalCount={treeData.length}
          />
          <div style={{ flex: 1 }}>
            <FocusTreeEditor
              focusTree={{ focuses: filteredFocuses }}
              onNodeMove={handleNodeMove}
              onNodeSelect={selectFocus}
              onBatchDelete={handleBatchDelete}
              selectedNodeId={selectedFocusId}
              searchQuery={searchQuery}
            />
          </div>
        </div>
      </div>

      <ResizeHandle
        direction="right"
        width={rightPanelWidth}
        onResize={setRightPanelWidth}
        min={300}
        max={800}
      />

      <div
        style={{
          width: rightPanelWidth,
          borderLeft: "1px solid var(--color-border)",
          background: "var(--color-bg-secondary)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <FocusPropertyPanel
          focus={selectedFocus}
          onUpdate={handleFocusUpdate}
          onDelete={handleFocusDelete}
          onAddFocus={handleAddFocus}
          onClose={() => selectFocus(null)}
          allFocusIds={treeData.map((f) => f.id)}
        />
      </div>
    </div>
  );
}

// ---------- TXT Generator (Fallback) ----------

function generateFocusTreeTxt(focuses: FocusNode[]): string {
  const lines: string[] = [
    "focus_tree = {",
    "    id = custom_focus",
    "    country = { factor = 0 }",
    "    default = no",
    "",
  ];

  for (const focus of focuses) {
    lines.push("    focus = {");
    lines.push(`        id = ${focus.id}`);
    lines.push(`        icon = ${focus.icon || "GFX_focus_generic"}`);
    lines.push(`        x = ${focus.x}`);
    lines.push(`        y = ${focus.y}`);
    lines.push(`        cost = ${focus.cost}`);

    if (focus.relativePositionId) {
      lines.push(`        relative_position_id = ${focus.relativePositionId}`);
    }

    // HOI4 format: each prerequisite = { ... } is one OR group
    // Multiple prerequisite blocks = AND between them
    // Inside each block: focus = ID1 focus = ID2 (OR)
    if (focus.prerequisite && focus.prerequisite.length > 0) {
      for (const group of focus.prerequisite) {
        if (group.length === 0) continue;
        const focusEntries = group.map((id) => `focus = ${id}`).join(" ");
        lines.push(`        prerequisite = { ${focusEntries} }`);
      }
    }

    // HOI4 format: mutually_exclusive = { focus = ID } per entry
    if (focus.mutuallyExclusive && focus.mutuallyExclusive.length > 0) {
      for (const exId of focus.mutuallyExclusive) {
        lines.push(`        mutually_exclusive = { focus = ${exId} }`);
      }
    }

    if (focus.available) {
      lines.push("        available = {");
      for (const line of focus.available.split("\n")) {
        lines.push("            " + line);
      }
      lines.push("        }");
    }

    if (focus.allowBranch) {
      lines.push("        allow_branch = {");
      for (const line of focus.allowBranch.split("\n")) {
        lines.push("            " + line);
      }
      lines.push("        }");
    }

    if (focus.completionReward) {
      lines.push("        completion_reward = {");
      for (const line of focus.completionReward.split("\n")) {
        lines.push("            " + line);
      }
      lines.push("        }");
    }

    if (focus.searchFilters && focus.searchFilters.length > 0) {
      lines.push(`        search_filters = { ${focus.searchFilters.join(" ")} }`);
    }

    if (focus.innerCircle) lines.push("        inner_circle = yes");
    if (focus.continuous) lines.push("        continuous = yes");

    lines.push("    }");
    lines.push("");
  }

  lines.push("}");
  return lines.join("\n");
}
