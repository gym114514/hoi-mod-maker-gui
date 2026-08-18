// ============================================================
// blockMatcher.ts —— 只读积木匹配器
// 把 Rust parser 解析出的 Hoi4Ast 逐节点匹配到 entries.json（dump 知识库），
// 生成前端可渲染的只读积木树；匹配不上的节点兜底为「原始代码」块。
// ============================================================

import { invoke } from "@tauri-apps/api/core";
import entries from "@/data/entries.json";
import type { BlockInstance } from "@/data/types";

// ---------- AST 类型（与 Rust parser 的 serde JSON 一一对应） ----------

export type Hoi4Value =
  | { type: "string"; value: string }
  | { type: "number"; value: number; raw: string }
  | { type: "bool"; value: boolean }
  | { type: "object"; children: KeyValue[] }
  | { type: "array"; items: Hoi4Value[] }
  | { type: "comment"; value: string }
  | { type: "empty" };

export interface KeyValue {
  key: string;
  value: Hoi4Value;
  is_block?: boolean;
  trailing_comment?: string | null;
  operator?: string | null;
}

export interface Hoi4Ast {
  children: KeyValue[];
  source?: string | null;
}

// ---------- entries.json 形状 ----------

export type EntryKind = "effect" | "trigger" | "variable";

export interface EntryParamGuess {
  name?: string;
  type?: string;
  ops?: string[];
  hints?: string[];
}

export interface Entry {
  kind?: string;
  name?: string;
  scopes?: string[];
  desc_zh?: string;
  md?: boolean;
  var_scope?: string;
  params_guess?: EntryParamGuess[];
}

interface EntriesIndex {
  effect: Record<string, Entry>;
  trigger: Record<string, Entry>;
  variable: Record<string, Entry>;
}

const INDEX = entries as unknown as EntriesIndex;

// ---------- 兜底：把 AST 值重建为可读 HOI4 文本 ----------

/** 单个值 → 文本（不含 key） */
function valueToText(v: Hoi4Value): string {
  switch (v.type) {
    case "string":
      return v.value;
    case "number":
      return v.raw;
    case "bool":
      return v.value ? "yes" : "no";
    case "comment":
      return `# ${v.value}`;
    case "empty":
      return "";
    case "array":
      return `{ ${v.items.map(valueToText).filter(Boolean).join(" ")} }`;
    case "object":
      // 对象一般在渲染层展开成子块；这里兜底重建为内联文本
      return `{ ${v.children.map(nodeToInline).join(" ")} }`;
  }
}

/** 单个 key-value 节点 → 内联文本（兜底展示用） */
function nodeToInline(n: KeyValue): string {
  const op = n.operator || "=";
  return `${n.key} ${op} ${valueToText(n.value)}`;
}

/** 递归重建节点文本，用于「原始代码」兜底块 */
export function serializeNode(n: KeyValue): string {
  return nodeToInline(n).trim();
}

// ---------- 匹配 ----------

type MatchKind = EntryKind | "raw";

export interface ReadOnlyBlock {
  key: string;
  kind: MatchKind;
  /** 是否命中 dump（false = 兜底 raw 块） */
  matched: boolean;
  /** 值文本（无子块时显示 `key op value` 的 value 部分） */
  valueText?: string;
  /** 操作符（比较/等于），= 为 null */
  operator?: string | null;
  // ---- 命中时来自 dump 的元数据 ----
  descZh?: string;
  md?: boolean;
  scopes?: string[];
  // ---- 兜底时保留原文 ----
  rawText?: string;
  // ---- 递归子块（对象值） ----
  children?: ReadOnlyBlock[];
  trailingComment?: string | null;
}

/**
 * 按 key 命中 dump 索引。优先级 effect → trigger → variable。
 * 不区分大小写（游戏关键字大小写敏感但索引内统一，做一次兼容尝试）。
 */
export function lookupEntry(key: string): { entry: Entry; kind: EntryKind } | null {
  const name = key;
  if (INDEX.effect[name]) return { entry: INDEX.effect[name], kind: "effect" };
  if (INDEX.trigger[name]) return { entry: INDEX.trigger[name], kind: "trigger" };
  if (INDEX.variable[name]) return { entry: INDEX.variable[name], kind: "variable" };
  // 大小写兜底
  for (const k of ["effect", "trigger", "variable"] as const) {
    const idx = INDEX[k];
    const low = Object.keys(idx).find((n) => n.toLowerCase() === name.toLowerCase());
    if (low) return { entry: idx[low], kind: k };
  }
  return null;
}

// ============================================================
// AST → 嵌套积木树（真正"搭建积木"：递归解析，不是行级打平）
// ============================================================

let _blockSeq = 0;
function newBlkId(): string {
  return `dblk_${++_blockSeq}_${Date.now()}`;
}

/** value 的"值文本"（不含 key）：叶子块展示用。 */
export function valueText(v: Hoi4Value): string {
  switch (v.type) {
    case "string":
      return `"${v.value}"`;
    case "number":
      return v.raw;
    case "bool":
      return v.value ? "yes" : "no";
    case "comment":
      return `# ${v.value}`;
    case "empty":
      return "";
    case "array":
      return `{ ${v.items.map(valueText).filter(Boolean).join(" ")} }`;
    case "object":
      return `{ ... }`;
  }
}

/** 单条 AST KeyValue → BlockInstance（递归） */
export function astNodeToBlock(n: KeyValue): BlockInstance {
  const op = n.operator || "=";
  const hit = lookupEntry(n.key);

  // 值文本（叶子块）
  const scalarText =
    n.value.type === "object" || n.value.type === "empty"
      ? ""
      : valueText(n.value);

  // 容器块（object）：递归子块
  let children: BlockInstance[] | undefined;
  if (n.value.type === "object") {
    children = n.value.children.filter((c) => c.key || c.value.type !== "comment").map(astNodeToBlock);
  }

  const isRaw = !hit;
  return {
    id: newBlkId(),
    defId: isRaw ? "raw_text" : n.key,
    params: {},
    children,
    readOnly: true,
    kind: isRaw ? "raw" : hit!.kind,
    descZh: hit?.entry.desc_zh,
    // codeText：整条语句可读文本（嵌套时仅 key + 占位）
    codeText: children
      ? `${n.key} ${op} {`
      : scalarText
        ? `${n.key} ${op} ${scalarText}`
        : n.key,
  };
}

/**
 * 用 Rust parser（parse_code_ast）把代码字符串解析成 AST，
 * 再递归映射为嵌套积木树。
 */
export async function parseCodeToBlocks(code: string): Promise<BlockInstance[]> {
  if (!code || !code.trim()) return [];
  const ast = await invoke<Hoi4Ast>("parse_code_ast", { code });
  if (!ast || !Array.isArray(ast.children)) return [];
  return ast.children
    .filter((c) => c.key || c.value.type !== "comment")
    .map(astNodeToBlock);
}
