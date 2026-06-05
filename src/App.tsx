import { Toolbar } from "@/components/layout/Toolbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { FocusTreePanel } from "@/components/focus-tree/FocusTreePanel";
import { IdeasPanel } from "@/components/ideas/IdeasPanel";
import { EventsPanel } from "@/components/events/EventsPanel";
import { CodePanel } from "@/components/code-editor/CodePanel";
import { ValidationPanel } from "@/components/common/ValidationPanel";
import { WelcomeScreen } from "@/components/layout/WelcomeScreen";
import { useEditorUIStore, useProjectStore } from "@/stores";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { ErrorBoundary } from "@/components/debug/ErrorBoundary";

export default function App() {
  const { activeTab, showValidationPanel, sidebarWidth, setSidebarWidth } = useEditorUIStore();
  const { project } = useProjectStore();

  const renderContent = () => {
    if (!project) return <WelcomeScreen />;
    switch (activeTab) {
      case "focus-tree": return <FocusTreePanel />;
      case "ideas": return <IdeasPanel />;
      case "events": return <EventsPanel />;
      case "characters": return <div style={{ padding: 24, color: "#707070" }}>角色编辑器 — 即将推出 🚧</div>;
      case "decisions": return <div style={{ padding: 24, color: "#707070" }}>决议编辑器 — 即将推出 🚧</div>;
      case "localisation": return <div style={{ padding: 24, color: "#707070" }}>本地化管理器 — 即将推出 🚧</div>;
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
