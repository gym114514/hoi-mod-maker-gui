import Editor, { type OnMount, loader } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";
import { useProjectStore, useEditorUIStore } from "@/stores";
import { invoke } from "@tauri-apps/api/core";

// @monaco-editor/react loads Monaco from CDN by default (jsdelivr).
// Switch to unpkg for better compatibility in some regions.
loader.config({ paths: { vs: "https://unpkg.com/monaco-editor@0.52.2/min/vs" } });

// Fix Monaco web worker in Tauri (tauri://localhost protocol can't load workers)
// Point workers to CDN URLs directly
(self as unknown as Record<string, unknown>).MonacoEnvironment = {
  getWorkerUrl: function (_moduleId: string, label: string) {
    const base = "https://unpkg.com/monaco-editor@0.52.2/min/vs";
    if (label === "json") return `${base}/language/json/jsonWorker.js`;
    if (label === "css" || label === "scss" || label === "less") return `${base}/language/css/cssWorker.js`;
    if (label === "html" || label === "handlebars" || label === "razor") return `${base}/language/html/htmlWorker.js`;
    if (label === "typescript" || label === "javascript") return `${base}/language/typescript/tsWorker.js`;
    return `${base}/base/worker/workerMain.js`;
  },
};

// ============ HOI4 Language Registration ============
// 染色词表由后端 get_token_vocabulary 返回（知识库单一数据源，与补全/hover 对齐）。
// 仅 buildings 不在知识库中，保留为硬编码例外。

// effect 用自定义主题色 #E5C07B（橙黄，vs-dark 无内置）；其余 token 全部 inherit vs-dark。
// 挂在 loader.init() 之后定义，保证先于 <Editor> 挂载完成（与 @monaco-editor/react 共用同一 Promise）。
loader.init().then((monaco) => {
  monaco.editor.defineTheme("hoi4-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "effect", foreground: "#E5C07B" },
      // 语义 token：命中知识的 effect/trigger 参数 key（路径索引，如 free_building_slots/size）
      { token: "param", foreground: "#4EC9B0" },
    ],
    colors: {},
  });
});

/** 不在知识库中的建筑名（唯一硬编码染色例外） */
const BUILDINGS = [
  "industrial_complex", "arms_factory", "dockyard",
  "infrastructure", "air_base", "naval_base", "bunker", "coastal_bunker",
  "anti_air_building", "radar_station", "synthetic_refinery", "fuel_silo",
  "rocket_site", "nuclear_reactor",
];

/** 用后端词表生成 Monarch tokenizer；传空词表 = 仅静态规则的降级版 */
function buildHoi4Monarch(vocab: Record<string, string[]>): Record<string, unknown> {
  const keyword = [...(vocab.class ?? []), ...(vocab.property ?? [])];
  // cases 列表对完整标识符做精确查表（Monarch @list 语义）。不能用 \b 交替正则：
  // Monarch 是 line.substr(pos) 切片后匹配规则，\b 在切片起点恒为真，
  // 单字母 x/y 会匹配到任意以 x/y 结尾的词末尾。
  // cases 键序 = 重合词优先级（与 Rust lookup_entry 的 effect→trigger→variable 一致）。
  // 注意：@default 必须最后插入——Monarch 按键插入顺序遍历 cases，@default 编译为
  // test:undefined（恒命中），若排在最前会吞掉所有染色（monarchCompile.js 的 compileAction）。
  const cases: Record<string, string> = {};
  if (vocab.effect?.length) cases["@effect"] = "effect";
  if (vocab.trigger?.length) cases["@trigger"] = "variable";
  if (vocab.variable?.length) cases["@variable"] = "variable.parameter";
  if (keyword.length) cases["@keyword"] = "keyword";
  if (BUILDINGS.length) cases["@buildings"] = "constant";
  cases["@default"] = "";
  return {
    defaultToken: "",
    keyword,
    effect: vocab.effect ?? [],
    trigger: vocab.trigger ?? [],
    variable: vocab.variable ?? [],
    buildings: BUILDINGS,
    tokenizer: {
      root: [
        [/#[^\n]*/, "comment"],
        [/"[^"]*"/, "string"],
        [/\b\d+(\.\d+)?/, "number"],
        [/(focus)\s*(?=\{)/, "keyword"],
        [/(=\s*)(yes|no)\b/, ["operator", "keyword"]],
        [/\b(GFX_\w+)\b/, "tag"],
        [/[a-zA-Z_]\w*/, { cases }],
        [/[{}()\[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
      ],
    },
  };
}

// ============ Semantic Tokens（参数着色，路径索引 free_building_slots/size） ============

/** 后端 get_semantic_tokens 返回的单条 token（行/列为 0-based UTF-16） */
interface SemanticToken {
  line: number;
  start_char: number;
  length: number;
  type_index: number;
  modifiers: number;
}

/**
 * 把后端 token 列表编码为 Monaco SemanticTokens.data（扁平 Uint32Array）。
 * 编码约定（每 token 5 个整数）：
 *   [deltaLine, startChar, length, typeIndex, modifiers]
 *   - deltaLine：相对上一个 token 的行增量（首个即绝对 0-based 行）；
 *   - startChar：同行内为相对上一 token 起始列的增量，换行后为绝对 0-based 列。
 * 后端已按 (line, start_char) 升序返回。
 */
function encodeSemanticTokens(toks: SemanticToken[]): Uint32Array {
  const data: number[] = [];
  let prevLine = 0;
  let prevStart = 0;
  for (const t of toks) {
    const deltaLine = t.line - prevLine;
    const startChar = deltaLine === 0 ? t.start_char - prevStart : t.start_char;
    data.push(deltaLine, startChar, t.length, t.type_index, t.modifiers);
    prevLine = t.line;
    prevStart = t.start_char;
  }
  return Uint32Array.from(data);
}

// ============ Completion & Hover Providers（Rust LSP 查询 entries.json 知识库） ============

interface CompletionItem {
  label: string;
  /** "effect" | "trigger" | "variable" | "property" | "class" */
  kind: string;
  detail: string;
  documentation: string;
}


/** 工厂：闭包捕获 monaco 实例，把 Rust 返回的类别字符串映射为 CompletionItemKind */
function makeCompletionProvider(monaco: Parameters<OnMount>[1]) {
  const KIND_MAP: Record<string, number> = {
    effect: monaco.languages.CompletionItemKind.Function,
    trigger: monaco.languages.CompletionItemKind.Keyword,
    variable: monaco.languages.CompletionItemKind.Variable,
    property: monaco.languages.CompletionItemKind.Property,
    class: monaco.languages.CompletionItemKind.Class,
  };
  return {
    provideCompletionItems: async (
      model: { getValue: () => string; getWordUntilPosition: (p: { lineNumber: number; column: number }) => { startColumn: number; endColumn: number } },
      position: { lineNumber: number; column: number },
    ) => {
      console.log("[completion] provider called", position.lineNumber, position.column);
      try {
        const completions = await invoke<CompletionItem[]>("get_completions", {
          content: model.getValue(), line: position.lineNumber, column: position.column,
        });
        console.log("[completion] rust ok:", completions.length);
        // range 必须覆盖光标前整个 token：
        // 若起点固定为 position.column，Monaco 接受选中项时只替换“打开补全时”的前缀，
        // 本地过滤阶段继续输入的字符会残留在结果前。
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber, startColumn: word.startColumn,
          endLineNumber: position.lineNumber, endColumn: word.endColumn,
        };
        return {
          suggestions: completions.map((c) => ({
            label: c.label,
            kind: KIND_MAP[c.kind] ?? monaco.languages.CompletionItemKind.Function,
            detail: c.detail,
            documentation: c.documentation,
            insertText: c.label,
            range,
          })),
        };
      } catch (e) {
        // 后端命令缺失（Rust 改动未重启）/ invoke 异常都会走到这里
        console.error("[completion] invoke failed:", e);
        return { suggestions: [] };
      }
    },
  };
}

function makeHoverProvider() {
  return {
    provideHover: async (model: { getValue: () => string; getWordAtPosition: (p: { lineNumber: number; column: number }) => { word: string; startColumn: number; endColumn: number } | null }, position: { lineNumber: number; column: number }) => {
      try {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        // 传全文 + 光标行列，让后端解析“当前位置所在块路径”，实现参数（路径索引）悬停
        const info = await invoke<string | null>("get_hover_info", {
          content: model.getValue(),
          line: position.lineNumber,
          column: position.column,
          word: word.word,
        });
        if (!info) return null;
        return {
          range: {
            startLineNumber: position.lineNumber, startColumn: word.startColumn,
            endLineNumber: position.lineNumber, endColumn: word.endColumn,
          },
          contents: [{ value: info }],
        };
      } catch { return null; }
    },
  };
}

// ============ CodePanel Component ============

export function CodePanel() {
  console.log(1);
  const activeFile = useProjectStore((s) => s.activeFile);
  const updateFileContent = useProjectStore((s) => s.updateFileContent);
  const goToLine = useEditorUIStore((s) => s.goToLine);
  const setGoToLine = useEditorUIStore((s) => (s as unknown as Record<string, unknown>).setGoToLine as (line: number | null) => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  const handleMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance;

    console.log(monaco.languages.getLanguages());
    // Register HOI4 language
    if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "hoi4")) {
      monaco.languages.register({ id: "hoi4" });
      monaco.languages.setLanguageConfiguration("hoi4", {
        wordPattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
      });
      monaco.languages.registerCompletionItemProvider("hoi4", makeCompletionProvider(monaco) as any);
      monaco.languages.registerHoverProvider("hoi4", makeHoverProvider() as any);

      // 参数着色（语义 token，路径索引）：只染“命中知识的参数 key”，与 Monarch 叠加（语义优先）
      monaco.languages.registerDocumentSemanticTokensProvider(
        "hoi4",
        {
          getLegend: () => ({ tokenTypes: ["param"], tokenModifiers: [] }),
          provideDocumentSemanticTokens: async (model: { getValue: () => string }) => {
            try {
              const toks = await invoke<SemanticToken[]>("get_semantic_tokens", {
                content: model.getValue(),
              });
              return { data: encodeSemanticTokens(toks) };
            } catch (e) {
              console.error("[semantic] invoke failed:", e);
              return { data: new Uint32Array() };
            }
          },
          releaseDocumentSemanticTokens: () => {},
        } as any,
      );
    }

    // 染色词表来自后端（与补全/hover 同一数据源）；失败时降级为仅静态规则
    invoke<Record<string, string[]>>("get_token_vocabulary")
      .then((vocab) => {
        monaco.languages.setMonarchTokensProvider("hoi4", buildHoi4Monarch(vocab) as any);
      })
      .catch((e) => {
        console.error("[tokenizer] invoke failed:", e);
        monaco.languages.setMonarchTokensProvider("hoi4", buildHoi4Monarch({}) as any);
      });

    // Ctrl+S: validation + auto-save to tmp
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const model = editorInstance.getModel();
      if (!model) return;
      const content = model.getValue();
      // Save to tmp file
      const tmp = useProjectStore.getState().tempPath;
      if (tmp) {
        invoke("write_text_file", { path: tmp, content }).catch(() => {});
      }
      // Validate
      try {
        const errors = await invoke<Array<{ message: string; line: number; severity: string }>>("validate_focus_tree", { content });
        const markers = errors.map((e) => ({
          message: e.message,
          severity: e.severity === "error" ? 8 : e.severity === "warning" ? 4 : 2,
          startLineNumber: e.line, startColumn: 1, endLineNumber: e.line, endColumn: model.getLineMaxColumn(e.line),
        }));
        monaco.editor.setModelMarkers(model, "hoi4-validation", markers);
      } catch (err) {
        console.error("Validation failed:", err);
      }
    });
  }, []);

  // Handle goToLine (jump to line from validation panel)
  useEffect(() => {
    if (goToLine && editorRef.current) {
      const editor = editorRef.current;
      editor.revealLineInCenter(goToLine);
      editor.setPosition({ lineNumber: goToLine, column: 1 });
      const model = editor.getModel();
      if (model) {
        const lineContent = model.getLineContent(goToLine);
        editor.deltaDecorations(editor._hoi4Decorations || [], [
          {
            range: { startLineNumber: goToLine, startColumn: 1, endLineNumber: goToLine, endColumn: lineContent.length + 1 },
            options: { isWholeLine: true, className: "hoi4-line-highlight", afterContentClassName: "hoi4-line-highlight" },
          },
        ]).forEach((id: string) => { editor._hoi4Decorations = [id]; });
      }
      editor.focus();
      setGoToLine(null);
    }
  }, [goToLine, setGoToLine]);

  const language = activeFile?.type === "focus_tree" ? "hoi4" : "plaintext";
  const content = activeFile?.content ?? "";

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <Editor
        language={language}
        value={content}
        theme="hoi4-dark"
        onChange={(value) => {
          if (activeFile && value !== undefined) {
            updateFileContent(activeFile.path, value);
            // Write to tmp file
            const tmp = useProjectStore.getState().tempPath;
            if (tmp) {
              invoke("write_text_file", { path: tmp, content: value }).catch(() => {});
            }

          }
        }}
        onMount={handleMount}
        options={{
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          minimap: { enabled: false },
          wordWrap: "on",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          bracketPairColorization: { enabled: true },
          // 只显示 provider 返回的建议，不混入文档内已有词（便于定位 provider 问题）
          suggest: { showWords: false },
          // 语义 token（参数着色）必须显式开启：Monaco 0.52 自定义主题的
          // semanticHighlighting 恒为 false，只有 editor 全局选项能真正打开
          "semanticHighlighting.enabled": true,
        }}
        loading={<div style={{ padding: 20, color: "#888" }}>加载编辑器...</div>}
      />
    </div>
  );
}
