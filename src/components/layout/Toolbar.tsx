import { useProjectStore, useEditorUIStore, useFocusTreeStore } from "@/stores";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { EditorTab, ValidationResult } from "@/data/types";

interface TabConfig {
  id: EditorTab;
  label: string;
  icon: string;
  ready?: boolean; // false = coming soon
}

const TABS: TabConfig[] = [
  { id: "focus-tree", label: "国策树", icon: "🌲", ready: true },
  { id: "code", label: "代码", icon: "⚙️", ready: true },
  { id: "ideas", label: "精神", icon: "💡", ready: false },
  { id: "events", label: "事件", icon: "📜", ready: false },
  { id: "characters", label: "角色", icon: "👤", ready: false },
  { id: "decisions", label: "决议", icon: "📋", ready: false },
  { id: "localisation", label: "本地化", icon: "🌐", ready: false },
];

export function Toolbar() {
  const { activeTab, setActiveTab, showValidationPanel, toggleValidationPanel, validationResult } = useEditorUIStore();
  const { project, isDirty, activeFile, files } = useProjectStore();

  const handleSave = async () => {
    const state = useProjectStore.getState();
    const file = state.activeFile;
    const tmp = state.tempPath;
    if (!file) return;

    try {
      if (file.type === "focus_tree" && tmp) {
        const content = await invoke<string>("get_file_preview", { path: tmp });
        await invoke("write_text_file", { path: file.path, content });
        state.updateFileContent(file.path, content);
      } else if (file.content) {
        await invoke("write_text_file", { path: file.path, content: file.content });
      }
      state.markClean();
    } catch (e) {
      alert("保存失败: " + e);
    }
  };

  const handleValidate = async () => {
    if (!activeFile) return;
    try {
      const result = await invoke<ValidationResult>("validate_file", {
        path: activeFile.path,
      });
      useEditorUIStore.getState().setValidationResult(result);
      if (!showValidationPanel) toggleValidationPanel();
    } catch (e) {
      alert("验证失败: " + e);
    }
  };

  const handleExport = async () => {
    if (!activeFile) {
      alert("请先选择一个文件");
      return;
    }
    const defaultName = activeFile.name?.replace(/\.txt$/i, "") || "export";
    const savePath = await save({
      defaultPath: `${defaultName}.txt`,
      filters: [{ name: "HOI4 Script", extensions: ["txt"] }],
    });
    if (!savePath) return;

    try {
      if (activeFile.type === "focus_tree") {
        const focusTree = useFocusTreeStore.getState().activeFocusTree;
        if (focusTree && focusTree.focuses.length > 0) {
          const json = JSON.stringify({ focuses: focusTree.focuses });
          const result = await invoke<string>("export_focus_tree_cmd", {
            path: savePath,
            json,
          });
          alert("✅ " + result);
        } else {
          await invoke("write_text_file", { path: savePath, content: activeFile.content });
          alert("✅ 已导出到:\n" + savePath);
        }
      } else {
        await invoke("write_text_file", { path: savePath, content: activeFile.content });
        useProjectStore.getState().markClean();
        alert("✅ 已导出到:\n" + savePath);
      }
    } catch (e) {
      alert("❌ 导出失败: " + e);
    }
  };

  const errorCount = validationResult?.errors.length ?? 0;
  const warnCount = validationResult?.warnings.length ?? 0;

  return (
    <div
      style={{
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        background: "#242424",
        borderBottom: "1px solid #3d3d3d",
      }}
    >
      {/* Logo / Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>🎮</span>
        <span style={{ fontWeight: 600, color: "#c9a227" }}>HOI Mod Maker</span>
        {project && (
          <span style={{ fontSize: 12, color: "#707070" }}>
            — {project.name}
            {isDirty && <span style={{ color: "#c9a227" }}> •</span>}
          </span>
        )}
        {project && files.length > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "#505050",
              background: "#1e1e1e",
              padding: "1px 6px",
              borderRadius: 8,
            }}
          >
            {files.length} 文件
          </span>
        )}
      </div>

      {/* Tab bar — only show ready tabs prominently */}
      <div style={{ display: "flex", gap: 2 }}>
        {TABS.filter(t => t.ready).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 12px",
              fontSize: 12,
              background: activeTab === tab.id ? "#2d2d2d" : "transparent",
              color: activeTab === tab.id ? "#c9a227" : "#a0a0a0",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
        {/* Coming soon tabs — muted */}
        {TABS.filter(t => !t.ready).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title="即将推出"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 8px",
              fontSize: 11,
              background: "transparent",
              color: activeTab === tab.id ? "#606060" : "#3a3a3a",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <span>{tab.icon}</span>
          </button>
        ))}
      </div>

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Save button (Ctrl+S) */}
        <button
          onClick={handleSave}
          disabled={!activeFile || !isDirty}
          title="保存 (Ctrl+S)"
          style={{
            padding: "4px 10px",
            fontSize: 11,
            background: isDirty ? "#2d5a1e" : "#2d2d2d",
            color: isDirty ? "#6fcf4a" : "#505050",
            border: "1px solid #3d3d3d",
            borderRadius: 4,
            cursor: activeFile && isDirty ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>💾</span>
          <span>保存</span>
        </button>

        {/* Validate button */}
        <button
          onClick={handleValidate}
          disabled={!activeFile}
          title={activeFile ? `验证 ${activeFile.path.split(/[/\\]/).pop()}` : "先选择一个文件"}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            background: "#2d2d2d",
            color: activeFile ? "#a0a0a0" : "#505050",
            border: "1px solid #3d3d3d",
            borderRadius: 4,
            cursor: activeFile ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>🔍</span>
          <span>验证</span>
          {errorCount > 0 && (
            <span
              style={{
                background: "#e74c3c",
                color: "#fff",
                fontSize: 9,
                padding: "0 4px",
                borderRadius: 6,
                fontWeight: 700,
              }}
            >
              {errorCount}
            </span>
          )}
          {errorCount === 0 && warnCount > 0 && (
            <span
              style={{
                background: "#f39c12",
                color: "#000",
                fontSize: 9,
                padding: "0 4px",
                borderRadius: 6,
                fontWeight: 700,
              }}
            >
              {warnCount}
            </span>
          )}
        </button>

        {/* Toggle validation panel */}
        <button
          onClick={toggleValidationPanel}
          title={showValidationPanel ? "隐藏验证面板" : "显示验证面板"}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            background: showValidationPanel ? "#2d2d2d" : "transparent",
            color: "#707070",
            border: "1px solid #3d3d3d",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          📋
        </button>

        {/* Export button */}
        <button
          onClick={handleExport}
          style={{
            padding: "4px 12px",
            fontSize: 11,
            background: "#c9a227",
            color: "#1a1a1a",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          📤 导出
        </button>
      </div>
    </div>
  );
}
