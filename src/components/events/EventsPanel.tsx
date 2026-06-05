export function EventsPanel() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: "var(--color-bg-secondary)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
          }}
        >
          <option value="country_event">国家事件</option>
          <option value="news_event">新闻事件</option>
          <option value="state_event">州事件</option>
        </select>
        <button
          style={{
            padding: "6px 16px",
            fontSize: 12,
            background: "var(--color-accent-gold)",
            color: "#1a1a1a",
            border: "none",
            borderRadius: 4,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ➕ 添加事件
        </button>
      </div>

      <div
        style={{
          fontSize: 12,
          color: "#707070",
          fontStyle: "italic",
          textAlign: "center",
          padding: 40,
        }}
      >
        📜 事件编辑器 — 从 HOI4 游戏文件导入事件后可编辑
      </div>
    </div>
  );
}