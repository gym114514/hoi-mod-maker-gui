import { useEffect } from "react";
import { Toolbar } from "@/components/layout/Toolbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { FocusTreePanel } from "@/components/focus-tree/FocusTreePanel";
import { CodePanel } from "@/components/code-editor/CodePanel";
import { ValidationPanel } from "@/components/common/ValidationPanel";
import { WelcomeScreen } from "@/components/layout/WelcomeScreen";
import { useEditorUIStore, useProjectStore } from "@/stores";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { ErrorBoundary } from "@/components/debug/ErrorBoundary";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const { activeTab, showValidationPanel, sidebarWidth, setSidebarWidth } = useEditorUIStore();
  const { project } = useProjectStore();

  // Ctrl+S 保存：将 tmp 文件写回源文件
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const state = useProjectStore.getState();
        const file = state.activeFile;
        const tmp = state.tempPath;
        if (!file) return;

        try {
          if (file.type === "focus_tree" && tmp) {
            // 读取 tmp 内容，写回源文件
            const content = await invoke<string>("get_file_preview", { path: tmp });
            await invoke("write_text_file", { path: file.path, content });
            state.updateFileContent(file.path, content);
          } else if (file.content) {
            // 非 focus_tree：直接用当前内容写回
            await invoke("write_text_file", { path: file.path, content: file.content });
          }
          state.markClean();
          // 状态栏提示
          const el = document.getElementById("save-toast");
          if (el) {
            el.style.opacity = "1";
            setTimeout(() => { el.style.opacity = "0"; }, 1500);
          }
        } catch (e) {
          alert("保存失败: " + e);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const renderContent = () => {
    if (!project) return <WelcomeScreen />;
    switch (activeTab) {
      case "focus-tree": return <FocusTreePanel />;
      case "ideas": return <div style={{ padding: 40, textAlign: "center", color: "#707070" }}><div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div><div style={{ fontSize: 16, fontWeight: 600 }}>精神编辑器</div><div style={{ fontSize: 13, marginTop: 8 }}>即将在后续版本中推出</div></div>;
      case "events": return <div style={{ padding: 40, textAlign: "center", color: "#707070" }}><div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div><div style={{ fontSize: 16, fontWeight: 600 }}>事件编辑器</div><div style={{ fontSize: 13, marginTop: 8 }}>即将在后续版本中推出</div></div>;
      case "characters": return <div style={{ padding: 40, textAlign: "center", color: "#707070" }}><div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div><div style={{ fontSize: 16, fontWeight: 600 }}>角色编辑器</div><div style={{ fontSize: 13, marginTop: 8 }}>即将在后续版本中推出</div></div>;
      case "decisions": return <div style={{ padding: 40, textAlign: "center", color: "#707070" }}><div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div><div style={{ fontSize: 16, fontWeight: 600 }}>决议编辑器</div><div style={{ fontSize: 13, marginTop: 8 }}>即将在后续版本中推出</div></div>;
      case "localisation": return <div style={{ padding: 40, textAlign: "center", color: "#707070" }}><div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div><div style={{ fontSize: 16, fontWeight: 600 }}>本地化管理器</div><div style={{ fontSize: 13, marginTop: 8 }}>即将在后续版本中推出</div></div>;
      case "code": return <CodePanel />;
      default: return <FocusTreePanel />;
    }
  };

  return (
    <ErrorBoundary>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden", background: "var(--color-bg-primary)" }}>
        <Toolbar />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {project && (
            <>
              <div style={{ width: sidebarWidth, borderRight: "1px solid var(--color-border)", background: "var(--color-bg-secondary)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <Sidebar />
              </div>
              <ResizeHandle direction="left" width={sidebarWidth} onResize={setSidebarWidth} min={160} max={400} />
            </>
          )}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "hidden" }}>{renderContent()}</div>
            {showValidationPanel && project && <ValidationPanel />}
          </div>
        </div>
        <StatusBar />
        <DebugPanel />
      </div>
    </ErrorBoundary>
  );
}
