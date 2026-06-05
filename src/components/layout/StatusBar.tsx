import { useProjectStore } from "@/stores";

export function StatusBar() {
  const { project, isDirty } = useProjectStore();

  return (
    <div
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        background: "#1a1a1a",
        borderTop: "1px solid #2d2d2d",
        fontSize: 10,
        color: "#707070",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ display: "flex", gap: 16 }}>
        {project ? (
          <>
            <span>
              📁 {project.path || "未保存"}
            </span>
            <span>v{project.version}</span>
            <span>支持 {project.supportedVersion}</span>
          </>
        ) : (
          <span>未打开项目</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <span>HOI4 Mod Maker v0.1.0</span>
        {isDirty && (
          <span style={{ color: "var(--color-accent-gold)" }}>● 已修改</span>
        )}
      </div>
    </div>
  );
}