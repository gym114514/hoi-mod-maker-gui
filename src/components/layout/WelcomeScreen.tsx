import { useState } from "react";
import { useProjectStore } from "@/stores";
import { open } from "@tauri-apps/plugin-dialog";

export function WelcomeScreen() {
  const { newProject, openProjectFolder } = useProjectStore();
  const [isCreating, setIsCreating] = useState(false);

  // 新建项目
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("My Awesome Mod");

  const handleNewProject = async () => {
    try {
      const folder = await open({
        directory: true,
        title: "选择 Mod 项目存放目录",
      });
      if (!folder) return;
      setPendingFolder(folder as string);
      setShowNameDialog(true);
    } catch (e: unknown) {
      alert("❌ 创建项目失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const confirmNewProject = async () => {
    if (!pendingFolder || !projectName.trim()) return;
    setIsCreating(true);
    setShowNameDialog(false);
    try {
      await newProject(projectName.trim(), pendingFolder);
    } catch (e: unknown) {
      alert("❌ 创建项目失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsCreating(false);
      setPendingFolder(null);
    }
  };

  // 打开现有项目文件夹
  const handleOpenProject = async () => {
    try {
      const folder = await open({
        directory: true,
        title: "选择 HOI4 Mod 项目文件夹",
      });
      if (!folder) return;
      await openProjectFolder(folder as string);
    } catch (e: unknown) {
      alert(
        "❌ 打开项目失败: " + (e instanceof Error ? e.message : String(e))
      );
    }
  };

  // 打开单个文件
  const handleOpenFile = async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "HOI4 Script", extensions: ["txt"] }],
      });
      if (file) {
        const filePath = typeof file === "string" ? file : file[0];
        await useProjectStore.getState().openFile(filePath);
      }
    } catch (e: unknown) {
      alert(
        "❌ 打开文件失败: " + (e instanceof Error ? e.message : String(e))
      );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 32,
        padding: 40,
      }}
    >
      {/* Logo */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎮</div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--color-accent-gold)",
            margin: 0,
            letterSpacing: "0.5px",
          }}
        >
          HOI Mod Maker
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            margin: "8px 0 0",
          }}
        >
          Hearts of Iron IV 可视化 Mod 编辑器
        </p>
      </div>

      {/* Action cards */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 700,
        }}
      >
        {/* New project */}
        <ActionCard
          icon="📁"
          title="新建 Mod 项目"
          description="创建完整的 Mod 目录结构（国策树/精神/事件等）"
          onClick={handleNewProject}
          loading={isCreating}
          primary
        />

        {/* Open project folder */}
        <ActionCard
          icon="📂"
          title="打开项目文件夹"
          description="打开已有的完整 Mod 项目，自动扫描所有文件"
          onClick={handleOpenProject}
        />

        {/* Open single file */}
        <ActionCard
          icon="📄"
          title="打开单个文件"
          description="仅打开一个 HOI4 脚本文件（.txt）"
          onClick={handleOpenFile}
        />
      </div>

      {/* Features preview */}
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: 600,
          marginTop: 16,
        }}
      >
        {[
          { icon: "🌲", text: "国策树可视化" },
          { icon: "💡", text: "精神编辑器" },
          { icon: "📜", text: "事件编辑器" },
          { icon: "✅", text: "语法验证" },
          { icon: "🌐", text: "本地化工具" },
        ].map((f) => (
          <div
            key={f.text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--color-text-secondary)",
            }}
          >
            <span>{f.icon}</span>
            <span>{f.text}</span>
          </div>
        ))}
      </div>

      {/* Name dialog */}
      {showNameDialog && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNameDialog(false); }}
        >
          <div
            style={{
              background: "#2a2a2a",
              border: "1px solid #3d3d3d",
              borderRadius: 12,
              padding: "24px 28px",
              minWidth: 360,
            }}
          >
            <h3 style={{ margin: "0 0 16px", color: "#c9a227", fontSize: 16 }}>
              📁 新建 Mod 项目
            </h3>
            <label style={{ fontSize: 12, color: "#a0a0a0", display: "block", marginBottom: 6 }}>
              项目名称
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmNewProject(); }}
              autoFocus
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                background: "#1a1a1a",
                color: "#e0e0e0",
                border: "1px solid #3d3d3d",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                onClick={() => setShowNameDialog(false)}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "transparent",
                  color: "#a0a0a0",
                  border: "1px solid #3d3d3d",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                onClick={confirmNewProject}
                style={{
                  padding: "6px 16px",
                  fontSize: 13,
                  background: "#c9a227",
                  color: "#1a1a1a",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ActionCardProps {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  loading?: boolean;
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  primary,
  loading,
}: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        width: 200,
        padding: "20px 16px",
        background: primary
          ? "var(--color-bg-secondary)"
          : "var(--color-bg-primary)",
        border: primary
          ? "1px solid var(--color-accent-gold)"
          : "1px solid var(--color-border)",
        borderRadius: 8,
        cursor: loading ? "wait" : "pointer",
        textAlign: "left",
        transition: "all 0.15s ease",
        color: "var(--color-text-primary)",
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.background = "var(--color-bg-tertiary)";
          e.currentTarget.style.borderColor = primary
            ? "var(--color-accent-gold-light)"
            : "var(--color-border-light)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = primary
          ? "var(--color-bg-secondary)"
          : "var(--color-bg-primary)";
        e.currentTarget.style.borderColor = primary
          ? "var(--color-accent-gold)"
          : "var(--color-border)";
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>
        {loading ? "⏳" : icon}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: primary
            ? "var(--color-accent-gold)"
            : "var(--color-text-primary)",
          marginBottom: 4,
        }}
      >
        {loading ? "创建中…" : title}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
        {description}
      </div>
    </button>
  );
}
