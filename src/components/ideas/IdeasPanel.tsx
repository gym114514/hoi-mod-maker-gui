export function IdeasPanel() {
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
          <option value="country">国家精神</option>
          <option value="political_advisor">政治顾问</option>
          <option value="army_chief">陆军将领</option>
          <option value="navy_chief">海军将领</option>
          <option value="air_chief">空军将领</option>
          <option value="theorist">理论家</option>
          <option value="high_command">最高指挥部</option>
          <option value="designer">设计商</option>
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
          ➕ 添加精神
        </button>
      </div>

      {/* Ideas list */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          <IdeaCard
            id="POL_authoritarian_regime"
            name="专制政权"
            category="country"
            description="政治 power +15%, 稳定度 +5%"
          />
          <IdeaCard
            id="POL_military_buildup"
            name="军事建设"
            category="country"
            description="陆军经验 +25, 适役人口 +5000"
          />
          <IdeaCard
            id="POL_western_alignment"
            name="西方联盟"
            category="country"
            description="与民主国家关系 +50"
          />
        </div>
      </div>
    </div>
  );
}

function IdeaCard({
  id,
  name,
  category,
  description,
}: {
  id: string;
  name: string;
  category: string;
  description: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, color: "#c9a227", fontFamily: "var(--font-mono)" }}>
          {id}
        </span>
        <span
          style={{
            fontSize: 9,
            padding: "1px 5px",
            background: "#2d2d2d",
            color: "#707070",
            borderRadius: 3,
          }}
        >
          {category}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{description}</div>
    </div>
  );
}