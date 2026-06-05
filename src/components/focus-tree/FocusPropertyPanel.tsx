import { useState, useEffect } from "react";
import { FocusBlockEditor } from "./BlockEditor";
import type { FocusNode } from "@/data/types";


interface Props {
  focus: FocusNode | null;
  onUpdate: (id: string, updates: Partial<FocusNode>) => void;
  onDelete: (id: string) => void;
  onAddFocus?: (focus: FocusNode) => void;
  onClose: () => void;
  allFocusIds?: string[];
}

interface IconEntry {
  id: string;
  file: string;
  category: string;
}

import iconData from "@/data/icon_data.json";
const ALL_ICONS: Record<string, IconEntry> = iconData as any;

const ICON_CATEGORIES = [...new Set(Object.values(ALL_ICONS).map(i => i.category))];

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(100);

  const selected = ALL_ICONS[value];
  const isCustom = !!value && !selected;

  const filtered = Object.entries(ALL_ICONS).filter(([id, ic]) => {
    if (cat && ic.category !== cat) return false;
    if (search && !id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const displayed = filtered.slice(0, showCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Text input — always visible, supports custom strings */}
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="GFX_focus_generic_military"
          style={{
            flex: 1, padding: "6px 8px", fontSize: 12, background: "#1a1a1a",
            color: isCustom ? "#ffcc00" : selected ? "#ddd" : "#666",
            border: "1px solid #444", borderRadius: 4, outline: "none", fontFamily: "var(--font-mono)",
          }}
        />
        <button
          type="button"
          onClick={() => { setOpen(!open); setShowCount(100); }}
          style={{
            padding: "6px 10px", background: open ? "#2a2a5a" : "#1a1a1a",
            border: open ? "1px solid #6a6aff" : "1px solid #444", borderRadius: 4,
            color: "#888", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {open ? "收起 ▲" : "选择 ▼"}
        </button>
      </div>

      {/* Selected icon preview */}
      {selected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
          <img src={`/icons/${selected.file}`} style={{ width: 24, height: 21, objectFit: "contain" }} />
          <span style={{ fontSize: 11, color: "#aaa" }}>{selected.category}</span>
        </div>
      )}
      {isCustom && (
        <div style={{ fontSize: 10, color: "#666", padding: "2px 0" }}>自定义图标</div>
      )}

      {/* Dropdown grid */}
      {open && (
        <div style={{
          background: "#1a1a1a", border: "1px solid #444", borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)", maxHeight: 400, display: "flex", flexDirection: "column",
        }}>
          {/* Search + category filter */}
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #333", display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowCount(100); }}
              placeholder="搜索图标..."
              style={{
                width: "100%", padding: "4px 6px", fontSize: 11, background: "#0d0d0d",
                color: "#ddd", border: "1px solid #444", borderRadius: 3, outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { setCat(null); setShowCount(100); }} style={catBtnStyle(!cat)}>全部</button>
              {ICON_CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => { setCat(c === cat ? null : c); setShowCount(100); }} style={catBtnStyle(c === cat)}>{c}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#555" }}>{filtered.length} 个图标</div>
          </div>
          {/* Icon grid */}
          <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 2 }}>
              {displayed.map(([id, ic]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { onChange(id); setOpen(false); setSearch(""); }}
                  style={{
                    padding: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    background: value === id ? "#2a2a5a" : "transparent",
                    border: value === id ? "1px solid #6a6aff" : "1px solid transparent",
                    borderRadius: 4, cursor: "pointer",
                  }}
                >
                  <img src={`/icons/${ic.file}`} style={{ width: 48, height: 42, objectFit: "contain" }} loading="lazy" />
                  <span style={{ fontSize: 8, color: "#888", textAlign: "center", lineHeight: 1.1, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {id.replace("GFX_focus_", "").replace("GFX_goal_", "").slice(0, 15)}
                  </span>
                </button>
              ))}
              {displayed.length < filtered.length && (
                <button
                  type="button"
                  onClick={() => setShowCount(prev => prev + 200)}
                  style={{
                    gridColumn: "1/-1", padding: "8px", background: "transparent",
                    border: "1px dashed #444", borderRadius: 4, color: "#6a6aff", fontSize: 11, cursor: "pointer",
                  }}
                >
                  加载更多 ({filtered.length - showCount} 剩余)
                </button>
              )}
              {filtered.length === 0 && (
                <div style={{ gridColumn: "1/-1", color: "#555", fontSize: 11, padding: 12, textAlign: "center" }}>无匹配图标</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function catBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "2px 8px", fontSize: 10, borderRadius: 3, cursor: "pointer",
    background: active ? "#2a2a5a" : "transparent",
    border: active ? "1px solid #6a6aff" : "1px solid #333",
    color: active ? "#b0b0ff" : "#666",
  };
}

const SEARCH_FILTERS = [
  "FOCUS_FILTER_POLITICAL",
  "FOCUS_FILTER_RESEARCH",
  "FOCUS_FILTER_INDUSTRY",
  "FOCUS_FILTER_STABILITY",
  "FOCUS_FILTER_WAR_SUPPORT",
  "FOCUS_FILTER_MANPOWER",
  "FOCUS_FILTER_ANNEXATION",
  "FOCUS_FILTER_INTERNAL_AFFAIRS",
  "FOCUS_FILTER_ARMY_XP",
  "FOCUS_FILTER_NAVY_XP",
  "FOCUS_FILTER_AIR_XP",
  "FOCUS_FILTER_BALANCE_OF_POWER",
  "FOCUS_FILTER_POLITICAL_CHARACTER",
  "FOCUS_FILTER_MILITARY_CHARACTER",
  "FOCUS_FILTER_INTERNATIONAL_TRADE",
  "FOCUS_FILTER_HISTORICAL",
];

// ---------- Completion Reward Templates ----------

interface RewardTemplate {
  label: string;
  icon: string;
  code: string;
  category: string;
}

const REWARD_TEMPLATES: RewardTemplate[] = [
  // 政治
  { label: "政治点数", icon: "🏛️", category: "政治", code: `add_political_power = 50` },
  { label: "稳定度", icon: "⚖️", category: "政治", code: `add_stability = 0.1` },
  { label: "战争支持", icon: "🔥", category: "政治", code: `add_war_support = 0.1` },
  { label: "国家精神", icon: "💡", category: "政治", code: `add_ideas = {TAG}_spirit_name` },
  { label: "执政党", icon: "🏛️", category: "政治", code: `set_politics = {
    ruling_party = neutrality
    elections_allowed = no
}` },
  // 军事
  { label: "陆军经验", icon: "⚔️", category: "军事", code: `army_experience = 25` },
  { label: "海军经验", icon: "🚢", category: "军事", code: `navy_experience = 25` },
  { label: "空军经验", icon: "✈️", category: "军事", code: `air_experience = 25` },
  { label: "人力", icon: "👥", category: "军事", code: `add_manpower = 10000` },
  { label: "战争目标", icon: "🎯", category: "军事", code: `create_wargoal = {
    target = {TAG}_enemy
    type = annex_everything
}` },
  // 工业
  { label: "民用工厂×1", icon: "🏭", category: "工业", code: `random_owned_controlled_state = {
    limit = { free_building_slots = { building = industrial_complex size > 0 } }
    add_extra_state_shared_building_slots = 1
    add_building_construction = {
        type = industrial_complex
        level = 1
        instant_build = yes
    }
}` },
  { label: "军工×1", icon: "🔫", category: "工业", code: `random_owned_controlled_state = {
    limit = { free_building_slots = { building = arms_factory size > 0 } }
    add_extra_state_shared_building_slots = 1
    add_building_construction = {
        type = arms_factory
        level = 1
        instant_build = yes
    }
}` },
  { label: "科研槽", icon: "🔬", category: "工业", code: `add_research_slot = 1` },
  { label: "建造加速", icon: "🏗️", category: "工业", code: `add_ideas = {TAG}_construction_bonus` },
  // 外交
  { label: "傀儡", icon: "🤝", category: "外交", code: `puppet = { TAG = {TAG}_target }` },
  { label: "加入阵营", icon: "🌐", category: "外交", code: `{TAG}_faction_leader = {
    add_to_faction = ROOT
}` },
  { label: "建立阵营", icon: "🌐", category: "外交", code: `set_rule = { can_create_factions = yes }` },
  // 科技
  { label: "学说减费", icon: "📖", category: "科技", code: `add_doctrine_cost_reduction = {
    cost = 0.25
    name = land_doctrine
}` },
  { label: "科技加成", icon: "🔬", category: "科技", code: `add_tech_bonus = {
    name = industrial_bonus
    bonus = 0.5
    uses = 1
    ahead_reduction = 1
    category = industry
}` },
];

// ---------- Helper: generate unique ID ----------

function generateUniqueId(base: string, existingIds: string[]): string {
  let id = base;
  let counter = 1;
  while (existingIds.includes(id)) {
    counter++;
    id = `${base}_${counter}`;
  }
  return id;
}

// ---------- Reward Template Picker ----------

function RewardTemplatePicker({ onSelect }: { onSelect: (code: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(REWARD_TEMPLATES.map((t) => t.category)));
  const filtered = category
    ? REWARD_TEMPLATES.filter((t) => t.category === category)
    : REWARD_TEMPLATES;

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          fontSize: 10,
          padding: "3px 8px",
          background: "#2d2d2d",
          color: "#4a90d9",
          border: "1px solid #3d3d3d",
          borderRadius: 3,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>📋 效果模板（点击插入）</span>
        <span style={{ fontSize: 8 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{
          background: "#252525",
          border: "1px solid #3d3d3d",
          borderTop: "none",
          borderRadius: "0 0 3px 3px",
          padding: 6,
          maxHeight: 200,
          overflow: "auto",
        }}>
          {/* Category tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => setCategory(null)}
              style={{
                fontSize: 9,
                padding: "2px 6px",
                background: category === null ? "#c9a227" : "#2d2d2d",
                color: category === null ? "#1a1a1a" : "#707070",
                border: "none",
                borderRadius: 2,
                cursor: "pointer",
              }}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  fontSize: 9,
                  padding: "2px 6px",
                  background: category === cat ? "#c9a227" : "#2d2d2d",
                  color: category === cat ? "#1a1a1a" : "#707070",
                  border: "none",
                  borderRadius: 2,
                  cursor: "pointer",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          {/* Template buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {filtered.map((t) => (
              <button
                key={t.label}
                onClick={() => {
                  onSelect(t.code);
                  setExpanded(false);
                }}
                title={t.code}
                style={{
                  fontSize: 10,
                  padding: "3px 6px",
                  background: "#2d2d2d",
                  color: "#a0a0a0",
                  border: "1px solid #3d3d3d",
                  borderRadius: 3,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#c9a227";
                  e.currentTarget.style.color = "#c9a227";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#3d3d3d";
                  e.currentTarget.style.color = "#a0a0a0";
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Add Focus Form ----------

interface AddFocusFormProps {
  allFocusIds: string[];
  onAdd: (focus: FocusNode) => void;
  onCancel: () => void;
}


// ---------- Preset Focus Templates ----------

interface FocusPreset {
  label: string;
  icon: string;
  category: string;
  defaults: Partial<FocusNode>;
  description: string;
}

const FOCUS_PRESETS: FocusPreset[] = [
  // 政治
  {
    label: "政治基础",
    icon: "🏛️",
    category: "政治",
    description: "政治点数 + 稳定度",
    defaults: {
      icon: "GFX_focus_generic_political_pressure",
      cost: 5,
      searchFilters: ["FOCUS_FILTER_POLITICAL"],
      completionReward: "add_political_power = 50\nadd_stability = 0.05",
    },
  },
  {
    label: "政治路线",
    icon: "⚔️",
    category: "政治",
    description: "互斥政治分支（带精神）",
    defaults: {
      icon: "GFX_focus_generic_authoritarian",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_POLITICAL"],
      mutuallyExclusive: [],
      completionReward: "add_political_power = 100\nadd_ideas = TAG_political_spirit",
    },
  },
  {
    label: "战争支持",
    icon: "🔥",
    category: "政治",
    description: "提升战争支持度",
    defaults: {
      icon: "GFX_focus_generic_support_democracy",
      cost: 5,
      searchFilters: ["FOCUS_FILTER_WAR_SUPPORT"],
      completionReward: "add_war_support = 0.1",
    },
  },
  // 军事
  {
    label: "军事基础",
    icon: "⚔️",
    category: "军事",
    description: "陆军经验 + 人力",
    defaults: {
      icon: "GFX_focus_generic_military",
      cost: 5,
      searchFilters: ["FOCUS_FILTER_MANPOWER"],
      completionReward: "army_experience = 25\nadd_manpower = 5000",
    },
  },
  {
    label: "海军建设",
    icon: "🚢",
    category: "军事",
    description: "海军经验 + 船坞",
    defaults: {
      icon: "GFX_focus_generic_naval",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_NAVY_XP"],
      completionReward: "navy_experience = 25\n123 = {\n    add_extra_state_shared_building_slots = 1\n    add_building_construction = {\n        type = dockyard\n        level = 1\n        instant_build = yes\n    }\n}",
    },
  },
  {
    label: "空军建设",
    icon: "✈️",
    category: "军事",
    description: "空军经验",
    defaults: {
      icon: "GFX_focus_generic_air",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_AIR_XP"],
      completionReward: "air_experience = 25",
    },
  },
  {
    label: "军事演习",
    icon: "🎯",
    category: "军事",
    description: "学说减费",
    defaults: {
      icon: "GFX_focus_generic_army_xp",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_ARMY_XP"],
      completionReward: "add_doctrine_cost_reduction = {\n    cost = 0.25\n    name = land_doctrine\n}",
    },
  },
  // 工业
  {
    label: "民用工厂",
    icon: "🏭",
    category: "工业",
    description: "建造民用工厂",
    defaults: {
      icon: "GFX_focus_generic_construct_civ_factory",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_INDUSTRY"],
      completionReward: "random_owned_controlled_state = {\n    limit = { free_building_slots = { building = industrial_complex size > 0 } }\n    add_extra_state_shared_building_slots = 1\n    add_building_construction = {\n        type = industrial_complex\n        level = 1\n        instant_build = yes\n    }\n}",
    },
  },
  {
    label: "军工",
    icon: "🔫",
    category: "工业",
    description: "建造军工厂",
    defaults: {
      icon: "GFX_focus_generic_construct_mil_factory",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_INDUSTRY"],
      completionReward: "random_owned_controlled_state = {\n    limit = { free_building_slots = { building = arms_factory size > 0 } }\n    add_extra_state_shared_building_slots = 1\n    add_building_construction = {\n        type = arms_factory\n        level = 1\n        instant_build = yes\n    }\n}",
    },
  },
  {
    label: "科研槽",
    icon: "🔬",
    category: "工业",
    description: "增加一个科研槽",
    defaults: {
      icon: "GFX_focus_generic_research",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_RESEARCH"],
      completionReward: "add_research_slot = 1",
    },
  },
  // 外交
  {
    label: "宣战",
    icon: "💥",
    category: "外交",
    description: "创建战争目标",
    defaults: {
      icon: "GFX_focus_generic_demand_territory",
      cost: 10,
      searchFilters: ["FOCUS_FILTER_ANNEXATION"],
      completionReward: "create_wargoal = {\n    target = TAG_enemy\n    type = annex_everything\n}",
    },
  },
  {
    label: "组建阵营",
    icon: "🌐",
    category: "外交",
    description: "获得组建阵营能力",
    defaults: {
      icon: "GFX_focus_generic_allied_innovation",
      cost: 10,
      completionReward: "set_rule = { can_create_factions = yes }",
    },
  },
];

function FocusPresetPicker({ onSelect }: { onSelect: (preset: FocusPreset) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(FOCUS_PRESETS.map((p) => p.category)));
  const filtered = category
    ? FOCUS_PRESETS.filter((p) => p.category === category)
    : FOCUS_PRESETS;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "6px 10px",
          fontSize: 11,
          background: "#2a3a2a",
          color: "#6fcf6f",
          border: "1px solid #3d6a3d",
          borderRadius: 4,
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>📋 预设模板（点击选择）</span>
        <span style={{ fontSize: 8 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{
          background: "#252525",
          border: "1px solid #3d3d3d",
          borderTop: "none",
          borderRadius: "0 0 4px 4px",
          padding: 8,
        }}>
          {/* Category tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setCategory(null)}
              style={{
                fontSize: 9, padding: "2px 6px",
                background: category === null ? "#c9a227" : "#2d2d2d",
                color: category === null ? "#1a1a1a" : "#707070",
                border: "none", borderRadius: 2, cursor: "pointer",
              }}
            >
              全部
            </button>
            {categories.map((cat) => (
              <button
                type="button"
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  fontSize: 9, padding: "2px 6px",
                  background: category === cat ? "#c9a227" : "#2d2d2d",
                  color: category === cat ? "#1a1a1a" : "#707070",
                  border: "none", borderRadius: 2, cursor: "pointer",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          {/* Preset buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {filtered.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => { onSelect(p); setExpanded(false); }}
                style={{
                  padding: "6px 8px",
                  background: "#2d2d2d",
                  color: "#a0a0a0",
                  border: "1px solid #3d3d3d",
                  borderRadius: 3,
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#c9a227";
                  e.currentTarget.style.color = "#c9a227";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#3d3d3d";
                  e.currentTarget.style.color = "#a0a0a0";
                }}
              >
                <span style={{ fontSize: 14 }}>{p.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 9, color: "#606060" }}>{p.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Add Focus Form ----------

interface AddFocusFormProps {
  allFocusIds: string[];
  onAdd: (focus: FocusNode) => void;
  onCancel: () => void;
}

function AddFocusForm({ allFocusIds, onAdd, onCancel }: AddFocusFormProps) {
  const [id, setId] = useState(() => generateUniqueId("new_focus", allFocusIds));
  const [icon, setIcon] = useState("GFX_focus_generic_military");
  const [cost, setCost] = useState(10);
  const [x, setX] = useState(1);
  const [y, setY] = useState(1);
  const [prerequisite, setPrerequisite] = useState<string[]>([]);
  const [mutuallyExclusive, setMutuallyExclusive] = useState<string[]>([]);
  const [searchFilters, setSearchFilters] = useState<string[]>([]);
  const [completionReward, setCompletionReward] = useState("");
  const [available, setAvailable] = useState("");

  // Apply preset
  const applyPreset = (preset: FocusPreset) => {
    if (preset.defaults.icon) setIcon(preset.defaults.icon);
    if (preset.defaults.cost) setCost(preset.defaults.cost);
    if (preset.defaults.searchFilters) setSearchFilters(preset.defaults.searchFilters);
    if (preset.defaults.completionReward) setCompletionReward(preset.defaults.completionReward);
    if (preset.defaults.mutuallyExclusive !== undefined) setMutuallyExclusive(preset.defaults.mutuallyExclusive);
    if (preset.defaults.prerequisite) setPrerequisite(preset.defaults.prerequisite.flat());
  };

  // Toggle search filter
  const toggleFilter = (filter: string) => {
    setSearchFilters((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) { alert("ID 不能为空"); return; }
    const newFocus: FocusNode = {
      id: id.trim(),
      icon,
      cost,
      x,
      y,
      prerequisite: prerequisite.length > 0 ? [prerequisite] : [],
      mutuallyExclusive,
      searchFilters,
      completionReward,
      available: available || undefined,
    };
    onAdd(newFocus);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #3d3d3d",
          background: "#2d4a2d",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "#6fcf6f" }}>
          ➕ 新建焦点
        </span>
        <button
          onClick={onCancel}
          style={{
            background: "transparent", border: "none", color: "#707070",
            fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {/* Presets */}
        <FocusPresetPicker onSelect={applyPreset} />

        {/* ID */}
        <div className="form-group">
          <label className="form-label">焦点 ID *</label>
          <input
            className="form-input"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="例如: TAG_new_focus"
            autoFocus
            required
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>

        {/* Icon */}
        <div className="form-group">
          <label className="form-label">图标</label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        {/* Cost */}
        <div className="form-group">
          <label className="form-label">成本 (实际天数 = cost × 7)</label>
          <input
            type="number" className="form-input" value={cost}
            onChange={(e) => setCost(parseInt(e.target.value) || 1)} min={1}
          />
          <div style={{ fontSize: 11, color: "#707070", marginTop: 4 }}>{cost * 7} 天</div>
        </div>

        {/* Position */}
        <div style={{ display: "flex", gap: 8 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">X</label>
            <input type="number" className="form-input" value={x} onChange={(e) => setX(parseInt(e.target.value) || 0)} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Y</label>
            <input type="number" className="form-input" value={y} onChange={(e) => setY(parseInt(e.target.value) || 0)} />
          </div>
        </div>

        {/* Prerequisite */}
        <div className="form-group">
          <label className="form-label">前置国策</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            {prerequisite.map((pid) => (
              <span key={pid} style={{
                fontSize: 10, padding: "2px 6px", background: "#1a3a5a",
                color: "#7ab8e8", borderRadius: 3, display: "flex", alignItems: "center", gap: 4,
              }}>
                {pid}
                <button
                  type="button"
                  onClick={() => setPrerequisite((p) => p.filter((i) => i !== pid))}
                  style={{ background: "transparent", border: "none", color: "#7ab8e8", fontSize: 10, cursor: "pointer", padding: 0 }}
                >×</button>
              </span>
            ))}
          </div>
          <select
            className="form-input"
            value=""
            onChange={(e) => { if (e.target.value && !prerequisite.includes(e.target.value)) setPrerequisite((p) => [...p, e.target.value]); e.currentTarget.value = ""; }}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            <option value="">+ 添加前置...</option>
            {allFocusIds.filter((fid) => fid !== id && !prerequisite.includes(fid)).map((fid) => (
              <option key={fid} value={fid}>{fid}</option>
            ))}
          </select>
        </div>

        {/* Mutually Exclusive */}
        <div className="form-group">
          <label className="form-label">互斥国策</label>
          {mutuallyExclusive.map((mid, idx) => (
            <div key={idx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <select
                className="form-input"
                value={mid}
                onChange={(e) => {
                  const n = [...mutuallyExclusive]; n[idx] = e.target.value;
                  setMutuallyExclusive(n.filter((v) => v !== ""));
                }}
                style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <option value="">-- 无 --</option>
                {allFocusIds.filter((fid) => fid !== id).map((fid) => (
                  <option key={fid} value={fid}>{fid}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setMutuallyExclusive((m) => m.filter((_, i) => i !== idx))}
                style={{ background: "#3a2a2a", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMutuallyExclusive((m) => [...m, ""]) }
            style={{
              fontSize: 11, padding: "2px 8px", background: "#2d2d2d",
              color: "#e74c3c", border: "1px solid #3d3d3d", borderRadius: 3, cursor: "pointer",
            }}
          >
            ➕ 添加互斥
          </button>
        </div>

        {/* Search Filters */}
        <div className="form-group">
          <label className="form-label">搜索过滤器</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {SEARCH_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter}
                onClick={() => toggleFilter(filter)}
                style={{
                  fontSize: 10, padding: "3px 6px",
                  background: searchFilters.includes(filter) ? "#c9a227" : "#2d2d2d",
                  color: searchFilters.includes(filter) ? "#1a1a1a" : "#a0a0a0",
                  border: "none", borderRadius: 3, cursor: "pointer",
                }}
              >
                {filter.replace("FOCUS_FILTER_", "")}
              </button>
            ))}
          </div>
        </div>

        {/* Completion Reward */}
        <div className="form-group">
          <label className="form-label">完成效果 (completion_reward)</label>
          <RewardTemplatePicker onSelect={(code) => setCompletionReward((prev) => prev.trim() ? prev + "\n" + code : code)} />
          <textarea
            className="form-input"
            value={completionReward}
            onChange={(e) => setCompletionReward(e.target.value)}
            placeholder="effect 代码..."
            rows={6}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, resize: "vertical" }}
          />
        </div>

        {/* Available */}
        <div className="form-group">
          <label className="form-label">解锁条件 (available)</label>
          <textarea
            className="form-input"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
            placeholder="trigger 条件..."
            rows={3}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, resize: "vertical" }}
          />
        </div>

        {/* Tips */}
        <div style={{
          background: "#2d2d2d", border: "1px solid #3d3d3d", borderRadius: 4,
          padding: "8px 10px", fontSize: 11, color: "#707070", marginTop: 8,
        }}>
          💡 <strong style={{ color: "#a0a0a0" }}>提示</strong><br />
          新节点将显示在坐标 ({x}, {y})。创建后可在图中拖动调整。
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="submit"
            style={{
              flex: 1, padding: "8px 12px", background: "#2d4a2d",
              color: "#6fcf6f", border: "1px solid #3d6a3d", borderRadius: 4, cursor: "pointer", fontSize: 13,
            }}
          >
            ✅ 创建
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1, padding: "8px 12px", background: "transparent",
              color: "#a0a0a0", border: "1px solid #3d3d3d", borderRadius: 4, cursor: "pointer", fontSize: 13,
            }}
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Main Component ----------

export function FocusPropertyPanel({
  focus,
  onUpdate,
  onDelete,
  onAddFocus,
  onClose,
  allFocusIds = [],
}: Props) {
  const [formData, setFormData] = useState<FocusNode | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"properties" | "blocks">("properties");

  useEffect(() => {
    setFormData(focus);
  }, [focus]);

  // When no focus selected — show add button or empty state
  if (!focus || !formData) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
        }}
      >
        <div style={{ color: "#707070", fontSize: 13, textAlign: "center" }}>
          选择一个焦点节点进行编辑
          <br />
          <span style={{ fontSize: 11 }}>或点击下方按钮新建节点</span>
        </div>

        {onAddFocus && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: "10px 24px",
              background: "#2d4a2d",
              color: "#6fcf6f",
              border: "1px solid #3d6a3d",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ➕ 新建国策节点
          </button>
        )}

        {showAddForm && onAddFocus && (
          <AddFocusForm
            allFocusIds={allFocusIds}
            onAdd={(focus) => {
              onAddFocus(focus);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>
    );
  }

  const handleChange = (field: keyof FocusNode, value: unknown) => {
    if (!formData) return;
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    onUpdate(focus.id, { [field]: value });
  };

  // Keep ref in sync

  const toggleSearchFilter = (filter: string) => {
    const current = formData.searchFilters || [];
    const newFilters = current.includes(filter)
      ? current.filter((f) => f !== filter)
      : [...current, filter];
    handleChange("searchFilters", newFilters);
  };

  // HOI4 prerequisite logic:
  // - Each prerequisite = { } block is an OR group (any one focus in the group satisfies it)
  // - Multiple prerequisite blocks are ANDed together (all must be satisfied)
  
  const addPrerequisiteGroup = () => {
    handleChange("prerequisite", [...(formData.prerequisite || []), []]);
  };

  const removePrerequisiteGroup = (groupIndex: number) => {
    const pre = [...(formData.prerequisite || [])];
    pre.splice(groupIndex, 1);
    handleChange("prerequisite", pre);
  };

  const addFocusToGroup = (groupIndex: number, focusId: string) => {
    const pre = [...(formData.prerequisite || [])];
    if (!pre[groupIndex].includes(focusId)) {
      pre[groupIndex] = [...pre[groupIndex], focusId];
      handleChange("prerequisite", pre);
    }
  };

  const removeFocusFromGroup = (groupIndex: number, focusId: string) => {
    const pre = [...(formData.prerequisite || [])];
    pre[groupIndex] = pre[groupIndex].filter((id) => id !== focusId);
    // Remove empty groups
    const filtered = pre.filter((g) => g.length > 0);
    handleChange("prerequisite", filtered);
  };

  const handleMutualExclusiveChange = (values: string[]) => {
    const filtered = values.filter((v) => v !== "");
    handleChange("mutuallyExclusive", filtered);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #3d3d3d",
          background: "#2d2d2d",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "#c9a227" }}>
          📝 编辑焦点
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {/* Add New button */}
          {onAddFocus && (
            <button
              onClick={() => setShowAddForm(true)}
              title="新建节点"
              style={{
                background: "transparent",
                border: "none",
                color: "#6fcf6f",
                fontSize: 16,
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              ➕
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#707070",
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #3d3d3d", flexShrink: 0 }}>
        <button
          onClick={() => setActiveTab("properties")}
          style={{
            flex: 1, padding: "7px 0", fontSize: 12, fontWeight: activeTab === "properties" ? 600 : 400,
            background: activeTab === "properties" ? "#1e1e1e" : "transparent",
            color: activeTab === "properties" ? "#c9a227" : "#707070",
            border: "none", borderBottom: activeTab === "properties" ? "2px solid #c9a227" : "2px solid transparent",
            cursor: "pointer",
          }}
        >
          📝 属性
        </button>
        <button
          onClick={() => setActiveTab("blocks")}
          style={{
            flex: 1, padding: "7px 0", fontSize: 12, fontWeight: activeTab === "blocks" ? 600 : 400,
            background: activeTab === "blocks" ? "#1e1e1e" : "transparent",
            color: activeTab === "blocks" ? "#c9a227" : "#707070",
            border: "none", borderBottom: activeTab === "blocks" ? "2px solid #c9a227" : "2px solid transparent",
            cursor: "pointer",
          }}
        >
          🧱 积木
        </button>
      </div>

      {/* Add Form Overlay */}
      {showAddForm && onAddFocus && (
        <AddFocusForm
          allFocusIds={allFocusIds}
          onAdd={(newFocus) => {
            onAddFocus(newFocus);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Content - Tab-based */}
      {activeTab === "properties" && (
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {/* ID */}
        <div className="form-group">
          <label className="form-label">ID</label>
          <input
            className="form-input"
            value={formData.id}
            onChange={(e) => handleChange("id", e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>

        {/* Icon */}
        <div className="form-group">
          <label className="form-label">图标</label>
          <IconPicker value={formData.icon || ""} onChange={(v) => handleChange("icon", v)} />
        </div>

        {/* Position */}
        <div style={{ display: "flex", gap: 8 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">X 坐标</label>
            <input
              type="number"
              className="form-input"
              value={formData.x}
              onChange={(e) => handleChange("x", parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Y 坐标</label>
            <input
              type="number"
              className="form-input"
              value={formData.y}
              onChange={(e) => handleChange("y", parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Cost */}
        <div className="form-group">
          <label className="form-label">
            成本 (实际天数 = cost × 7)
          </label>
          <input
            type="number"
            className="form-input"
            value={formData.cost}
            onChange={(e) => handleChange("cost", parseInt(e.target.value) || 1)}
            min={1}
          />
          <div style={{ fontSize: 11, color: "#707070", marginTop: 4 }}>
            实际天数: {formData.cost * 7} 天
          </div>
        </div>

        {/* Relative Position */}
        <div className="form-group">
          <label className="form-label">相对位置 ID</label>
          <input
            className="form-input"
            value={formData.relativePositionId || ""}
            onChange={(e) => handleChange("relativePositionId", e.target.value)}
            placeholder="用于相对定位"
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
        </div>

        {/* Prerequisites - HOI4 Style: OR groups within blocks, AND between blocks */}
        <div className="form-group">
          <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            前置国策
            <span style={{ fontSize: 10, color: "#707070", fontWeight: "normal" }}>
              (每组内为OR，组之间为AND)
            </span>
          </label>
          
          {(formData.prerequisite || []).length === 0 && (
            <div style={{ fontSize: 11, color: "#707070", marginBottom: 8 }}>
              无前置条件
            </div>
          )}
          
          {(formData.prerequisite || []).map((group, groupIdx) => (
            <div
              key={groupIdx}
              style={{
                background: "#2a2a2a",
                border: "1px solid #3d3d3d",
                borderRadius: 4,
                padding: 8,
                marginBottom: 8,
              }}
            >
              {/* Group header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: "1px solid #3d3d3d",
                }}
              >
                <span style={{ fontSize: 11, color: "#4a90d9" }}>
                  组 {groupIdx + 1} {group.length > 1 ? "(OR)" : ""}
                </span>
                <button
                  onClick={() => removePrerequisiteGroup(groupIdx)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#e74c3c",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                  title="删除此组"
                >
                  ×
                </button>
              </div>
              
              {/* Focuses in this group */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {group.map((focusId) => (
                  <span
                    key={focusId}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      background: "#1a3a5a",
                      color: "#7ab8e8",
                      borderRadius: 3,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {focusId}
                    <button
                      onClick={() => removeFocusFromGroup(groupIdx, focusId)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#7ab8e8",
                        fontSize: 10,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              
              {/* Add focus to group */}
              <select
                className="form-input"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addFocusToGroup(groupIdx, e.target.value);
                    e.target.value = "";
                  }
                }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <option value="">+ 添加国策到此组...</option>
                {allFocusIds
                  .filter((id) => id !== formData.id && !group.includes(id))
                  .map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
              </select>
            </div>
          ))}
          
          <button
            onClick={addPrerequisiteGroup}
            style={{
              fontSize: 11,
              padding: "4px 12px",
              background: "#1a3a3a",
              color: "#6fcf6f",
              border: "1px solid #3d6a3d",
              borderRadius: 3,
              cursor: "pointer",
              width: "100%",
            }}
          >
            ➕ 添加前置组 (AND)
          </button>
        </div>

        {/* Mutually Exclusive */}
        <div className="form-group">
          <label className="form-label">互斥国策</label>
          {(formData.mutuallyExclusive || []).map((exId, idx) => (
            <div key={idx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <select
                className="form-input"
                value={exId}
                onChange={(e) => {
                  const newEx = [...(formData.mutuallyExclusive || [])];
                  newEx[idx] = e.target.value;
                  handleMutualExclusiveChange(newEx);
                }}
                style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                <option value="">-- 无 --</option>
                {allFocusIds
                  .filter((id) => id !== formData.id)
                  .filter((id) => {
                    // Can't be mutually exclusive with a prerequisite
                    const prereqIds = (formData.prerequisite || []).flat();
                    if (prereqIds.includes(id)) return false;
                    return true;
                  })
                  .map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => {
                  const newEx = (formData.mutuallyExclusive || []).filter(
                    (_, i) => i !== idx
                  );
                  handleMutualExclusiveChange(newEx);
                }}
                style={{
                  background: "#3a2a2a",
                  border: "none",
                  color: "#e74c3c",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              handleChange("mutuallyExclusive", [
                ...(formData.mutuallyExclusive || []),
                "",
              ])
            }
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "#2d2d2d",
              color: "#e74c3c",
              border: "1px solid #3d3d3d",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            ➕ 添加互斥
          </button>
        </div>

        {/* Checkboxes */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={formData.innerCircle || false}
              onChange={(e) => handleChange("innerCircle", e.target.checked)}
            />
            内圈焦点
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={formData.continuous || false}
              onChange={(e) => handleChange("continuous", e.target.checked)}
            />
            连续焦点
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={formData.cancelIfInvalid ?? true}
              onChange={(e) => handleChange("cancelIfInvalid", e.target.checked)}
            />
            无效时取消
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={formData.continueIfInvalid || false}
              onChange={(e) => handleChange("continueIfInvalid", e.target.checked)}
            />
            无效时继续
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={formData.availableIfCapitulated || false}
              onChange={(e) => handleChange("availableIfCapitulated", e.target.checked)}
            />
            投降时可用
          </label>
        </div>

        {/* Search Filters */}
        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label">搜索过滤器</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {SEARCH_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => toggleSearchFilter(filter)}
                style={{
                  fontSize: 10,
                  padding: "3px 6px",
                  background: formData.searchFilters?.includes(filter)
                    ? "#c9a227"
                    : "#2d2d2d",
                  color: formData.searchFilters?.includes(filter)
                    ? "#1a1a1a"
                    : "#a0a0a0",
                  border: "none",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                {filter.replace("FOCUS_FILTER_", "")}
              </button>
            ))}
          </div>
        </div>

        {/* Code Editor for complex fields */}
        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label">分支条件 (allow_branch)</label>
          <textarea
            className="form-input"
            value={formData.allowBranch || ""}
            onChange={(e) => handleChange("allowBranch", e.target.value)}
            placeholder="allow_branch 条件代码..."
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">可用条件 (available)</label>
          <textarea
            className="form-input"
            value={formData.available || ""}
            onChange={(e) => handleChange("available", e.target.value)}
            placeholder="trigger 条件代码..."
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">完成效果 (completion_reward)</label>
          <textarea
            className="form-input"
            value={formData.completionReward || ""}
            onChange={(e) => handleChange("completionReward", e.target.value)}
            placeholder="effect 代码..."
            rows={5}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">隐藏效果 (hidden_effect)</label>
          <textarea
            className="form-input"
            value={formData.hiddenEffect || ""}
            onChange={(e) => handleChange("hiddenEffect", e.target.value)}
            placeholder="只在后台执行的 effect..."
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">跳过条件 (bypass)</label>
          <textarea
            className="form-input"
            value={formData.bypass || ""}
            onChange={(e) => handleChange("bypass", e.target.value)}
            placeholder="bypass 条件代码..."
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">选择效果 (select_effect)</label>
          <textarea
            className="form-input"
            value={formData.selectEffect || ""}
            onChange={(e) => handleChange("selectEffect", e.target.value)}
            placeholder="选择国策时立即执行的 effect..."
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">AI 决策 (ai_will_do)</label>
          <textarea
            className="form-input"
            value={formData.aiWillDo ? JSON.stringify(formData.aiWillDo, null, 2) : ""}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                handleChange("aiWillDo", parsed);
              } catch {
                // 保持原文本，等用户修正
              }
            }}
            placeholder='{ "base": 1, "modifier": [...] }'
            rows={3}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              resize: "vertical",
              whiteSpace: "pre",
              overflowX: "auto",
            }}
          />
        </div>

        {/* Delete button */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #3d3d3d" }}>
          <button
            onClick={() => onDelete(focus.id)}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "#3a2a2a",
              color: "#e74c3c",
              border: "1px solid #e74c3c",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            🗑️ 删除此焦点
          </button>
        </div>
      </div>
      )}




      {/* Blocks Tab — Inline block editor */}
      {activeTab === "blocks" && focus && (
        (() => {
          console.log("[PropertyPanel] Rendering blocks tab for:", focus.id, "blocks=", !!focus.blocks, "cr=", (focus.completionReward || "").slice(0, 30));
          return <FocusBlockEditor focus={focus} onUpdate={onUpdate} />;
        })()
      )}
    </div>
  );
}
