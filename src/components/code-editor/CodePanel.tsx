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

const HOI4_MONARCH: Record<string, unknown> = {
  defaultToken: "",
  keywords: [
    "focus", "id", "icon", "prerequisite", "mutually_exclusive",
    "relative_position_id", "x", "y", "cost", "available", "bypass",
    "completion_reward", "cancel", "ai_will_do", "search_filters",
    "select_effect", "default", "will_lead_to_war_with",
    "continue_if_invalid", "available_if_capitulated",
    "cancel_if_invalid", "allow_branch",
  ],
  effects: [
    "add_political_power", "add_stability", "add_war_support",
    "add_ideas", "remove_ideas", "add_country_leader_trait",
    "army_experience", "navy_experience", "air_experience",
    "add_manpower", "add_doctrine_cost_reduction", "create_wargoal",
    "add_civilian_factory", "add_military_factory", "add_dockyard",
    "add_research_slot", "add_tech_bonus",
    "puppet", "annex_country", "set_rule", "set_politics",
    "set_country_flag", "clr_country_flag", "custom_effect_tooltip",
    "random_list", "random_owned_controlled_state", "every_owned_state",
    "add_extra_state_shared_building_slots", "add_building_construction",
    "set_state_flag", "transfer_state",
    "declare_war_on", "white_peace", "give_guarantee",
    "add_to_faction", "remove_from_faction",
  ],
  triggers: [
    "has_government", "has_war", "has_stability", "has_war_support",
    "is_subject", "is_in_faction", "has_country_flag", "has_tech",
    "has_completed_focus", "tag", "original_tag", "has_full_control_of_state",
    "num_of_factories", "num_of_military_factories", "num_of_civilian_factories",
    "surrender_progress", "is_ai", "is_historical_focus_on",
    "has_capitulated", "is_puppet", "free_building_slots",
  ],
  buildings: [
    "industrial_complex", "arms_factory", "dockyard",
    "infrastructure", "air_base", "naval_base", "bunker", "coastal_bunker",
    "anti_air_building", "radar_station", "synthetic_refinery", "fuel_silo",
    "rocket_site", "nuclear_reactor",
  ],
  gfx: [
    "GFX_goal_generic_political_pressure",
    "GFX_goal_generic_demand_territory",
    "GFX_goal_generic_forceful_treaty",
    "GFX_goal_generic_military_sphere",
    "GFX_goal_generic_major_war",
    "GFX_goal_generic_construct_civ_factory",
    "GFX_goal_generic_construct_mil_factory",
    "GFX_goal_generic_construction",
    "GFX_goal_generic_production2",
    "GFX_goal_generic_scientific_exchange",
    "GFX_focus_generic_army",
    "GFX_focus_generic_air",
    "GFX_focus_generic_navy",
  ],
  tokenizer: {
    root: [
      [/#[^\n]*/, "comment"],
      [/"[^"]*"/, "string"],
      [/\b\d+(\.\d+)?/, "number"],
      [/(focus)\s*(?=\{)/, "keyword"],
      [/(=\s*)(yes|no)\b/, ["operator", "keyword"]],
      [/\b(add_political_power|add_stability|add_war_support|add_ideas|remove_ideas|add_country_leader_trait|army_experience|navy_experience|air_experience|add_manpower|add_doctrine_cost_reduction|create_wargoal|add_civilian_factory|add_military_factory|add_dockyard|add_research_slot|add_tech_bonus|puppet|annex_country|set_rule|set_politics|set_country_flag|clr_country_flag|custom_effect_tooltip|random_list|random_owned_controlled_state|every_owned_state|add_extra_state_shared_building_slots|add_building_construction|set_state_flag|transfer_state|declare_war_on|white_peace|give_guarantee|add_to_faction|remove_from_faction)\b/, "string.key.json"],
      [/\b(has_government|has_war|has_stability|has_war_support|is_subject|is_in_faction|has_country_flag|has_tech|has_completed_focus|original_tag|has_full_control_of_state|num_of_factories|num_of_military_factories|num_of_civilian_factories|surrender_progress|is_ai|is_historical_focus_on|has_capitulated|is_puppet|free_building_slots)\b/, "variable"],
      [/\b(industrial_complex|arms_factory|dockyard|infrastructure|air_base|naval_base|bunker|coastal_bunker|anti_air_building|radar_station|synthetic_refinery|fuel_silo|rocket_site|nuclear_reactor)\b/, "constant"],
      [/\b(GFX_\w+)\b/, "tag"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "" } }],
      [/[{}()\[\]]/, "@brackets"],
      [/[;,.]/, "delimiter"],
    ],
  },
};

// ============ Completion & Hover Providers ============

interface CompletionItem { label: string; kind: number; detail: string; insertText: string; }

const HOI4_COMPLETION_PROVIDER = {
  provideCompletionItems: async (model: { getValue: () => string; getLineContent: (n: number) => string }, position: { lineNumber: number; column: number }) => {
    try {
      const completions = await invoke<CompletionItem[]>("get_completions", {
        content: model.getValue(), line: position.lineNumber, column: position.column,
      });
      return {
        suggestions: completions.map((c) => ({
          label: c.label, kind: c.kind, detail: c.detail, insertText: c.insertText,
          range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column },
        })),
      };
    } catch { return { suggestions: [] }; }
  },
};

const HOI4_HOVER_PROVIDER = {
  provideHover: async (model: { getValue: () => string; getWordAtPosition: (p: { lineNumber: number; column: number }) => { word: string; startColumn: number; endColumn: number } | null }, position: { lineNumber: number; column: number }) => {
    try {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const info = await invoke<string | null>("get_hover_info", {
        word: word.word, content: model.getValue(), line: position.lineNumber, column: position.column,
      });
      if (!info) return null;
      return {
        range: { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn },
        contents: [{ value: info }],
      };
    } catch { return null; }
  },
};

// ============ CodePanel Component ============

export function CodePanel() {
  const activeFile = useProjectStore((s) => s.activeFile);
  const updateFileContent = useProjectStore((s) => s.updateFileContent);
  const goToLine = useEditorUIStore((s) => s.goToLine);
  const setGoToLine = useEditorUIStore((s) => (s as unknown as Record<string, unknown>).setGoToLine as (line: number | null) => void);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  const handleMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance;

    // Register HOI4 language
    if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "hoi4")) {
      monaco.languages.register({ id: "hoi4" });
      monaco.languages.setMonarchTokensProvider("hoi4", HOI4_MONARCH as any);
      monaco.languages.registerCompletionItemProvider("hoi4", HOI4_COMPLETION_PROVIDER as any);
      monaco.languages.registerHoverProvider("hoi4", HOI4_HOVER_PROVIDER as any);
    }

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
        theme="vs-dark"
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
        }}
        loading={<div style={{ padding: 20, color: "#888" }}>加载编辑器...</div>}
      />
    </div>
  );
}
