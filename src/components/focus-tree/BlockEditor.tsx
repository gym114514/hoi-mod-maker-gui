import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { FocusNode } from "@/data/types";

// ============ Block Definitions ============

type BlockCategory = "条件" | "效果" | "控制流" | "其他";

interface BlockParam {
  key: string;
  label: string;
  type: "number" | "string" | "select" | "boolean" | "textarea";
  default: string;
  options?: string[];
  placeholder?: string;
}

interface BlockSlot {
  key: string;
  label: string;
  acceptedChildren: string[];
}

interface BlockDef {
  id: string;
  label: string;
  icon: string;
  category: BlockCategory;
  subcategory: string;
  color: string;
  params: BlockParam[];
  isContainer?: boolean;
  slots?: BlockSlot[];
  acceptedChildren?: string[];
  childLabel?: string;
  generate: (params: Record<string, string>, slotCode: Record<string, string>, indent: number) => string;
  desc: string;
}

// ============ 缩进工具 ============

function indent(code: string, level: number): string {
  const pad = " ".repeat(level);
  return code.split("\n").map((l) => pad + l).join("\n");
}

function block(body: string, indentLevel: number): string {
  const pad = " ".repeat(indentLevel);
  return `{\n${body}\n${pad}}`;
}

// ============ 积木 ID 集合（供容器槽位引用） ============

const COND_IDS = [
  // 政治条件
  "has_government", "has_war", "has_stability_gt", "has_war_support_gt",
  "has_country_flag", "has_political_power", "is_ai", "is_historical_focus_on",
  "has_country_leader", "has_idea", "is_major_power", "threat_level",
  // 外交条件
  "is_subject", "is_puppet", "is_in_faction", "has_war_with",
  "tag_is", "original_tag_is", "has_opinion", "is_neighbor_of",
  "controls_state", "any_owned_state_has",
  // 科技/工业条件
  "has_tech", "has_completed_focus", "num_of_factories",
  "num_of_military_factories", "num_of_civilian_factories",
  "surrender_progress", "has_capitulated", "num_divisions",
  "has_army_experience", "has_navy_experience", "has_manpower",
  "has_army_manpower", "has_political_power",
  "raw_text",
];

const EFFECT_IDS = [
  // 政治效果
  "add_political_power", "add_stability", "add_war_support",
  "set_politics", "add_country_leader_trait", "set_country_flag", "clr_country_flag",
  // 精神
  "add_ideas", "remove_ideas",
  // 军事效果
  "army_experience", "navy_experience", "air_experience",
  "add_manpower", "add_command_power", "add_doctrine_cost_reduction",
  "add_war_support_stability", "add_legitimacy",
  // 外交效果
  "create_wargoal", "puppet_effect", "annex_country", "set_rule",
  "declare_war_on", "add_to_faction", "give_guarantee", "add_opinion",
  // 工业效果
  "add_research_slot", "add_tech_bonus", "add_resource",
  // 其他效果
  "custom_effect_tooltip", "swap_ideas",
  "set_popularities", "set_party_name",
  "raw_text",
];

const STATE_EFFECT_IDS = [
  "state_build_civ", "state_build_mil", "state_build_dockyard",
  "state_build_infra", "state_build_air", "state_build_bunker",
  "state_add_slots", "state_set_flag", "state_clr_flag",
  "state_set_province_controller",
];

const CONTAINER_IDS = [
  "random_owned_controlled_state", "every_owned_state",
];

const COND_CONTAINER_IDS = [
  "if_limit_condition",
];

// ============ Block Library ============

const BLOCK_LIBRARY: BlockDef[] = [

  // ══════════════════════════════════════════════════
  //  兜底：原始代码块
  // ══════════════════════════════════════════════════

  { id: "raw_text", label: "原始代码", icon: "📝", category: "其他", subcategory: "兜底", color: "#888888",
    params: [{ key: "code", label: "代码", type: "textarea", default: "" }],
    generate: (p) => p.code || "",
    desc: "无法识别的代码原样保留，可手动编辑" },

  // ══════════════════════════════════════════════════
  //  顶层结构（国策树块）
  // ══════════════════════════════════════════════════

  { id: "completion_reward", label: "完成奖励", icon: "🎁", category: "效果", subcategory: "国策结构", color: "#c9a227",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "⚡ 效果:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => `completion_reward = ${block(sc.body || "", i + 4)}`,
    desc: "国策完成时执行的效果" },
  { id: "available_block", label: "前置条件", icon: "🔍", category: "条件", subcategory: "国策结构", color: "#c9a227",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "🔍 条件:", acceptedChildren: [...COND_IDS, ...COND_CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => `available = ${block(sc.body || "", i + 4)}`,
    desc: "国策可被选择的前置条件" },
  { id: "bypass_block", label: "跳过条件", icon: "⏭️", category: "条件", subcategory: "国策结构", color: "#c9a227",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "🔍 跳过条件:", acceptedChildren: [...COND_IDS, ...COND_CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => `bypass = ${block(sc.body || "", i + 4)}`,
    desc: "满足时自动跳过该国策" },
  { id: "cancel_block", label: "取消条件", icon: "❌", category: "条件", subcategory: "国策结构", color: "#c9a227",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "🔍 取消条件:", acceptedChildren: [...COND_IDS, ...COND_CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => `cancel = ${block(sc.body || "", i + 4)}`,
    desc: "满足时取消正在进行的国策" },
  { id: "select_effect_block", label: "选择效果", icon: "🎯", category: "效果", subcategory: "国策结构", color: "#c9a227",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "⚡ 效果:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => `select_effect = ${block(sc.body || "", i + 4)}`,
    desc: "选择国策时立即执行的效果" },

  // ══════════════════════════════════════════════════
  //  条件 (Conditions)
  // ══════════════════════════════════════════════════

  // ── 政治条件 ──
  { id: "has_government", label: "执政党", icon: "🏛️", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "party", label: "政党", type: "select", default: "neutrality", options: ["neutrality", "democratic", "fascism", "communism"] }],
    generate: (p) => `has_government = ${p.party}`,
    desc: "检查执政党" },
  { id: "has_war", label: "在战争中", icon: "⚔️", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [],
    generate: () => `has_war = yes`,
    desc: "是否处于战争状态" },
  { id: "has_stability_gt", label: "稳定度 >", icon: "⚖️", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "value", label: "阈值", type: "number", default: "0.5" }],
    generate: (p) => `has_stability > ${p.value}`,
    desc: "稳定度大于指定值" },
  { id: "has_war_support_gt", label: "战争支持 >", icon: "🔥", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "value", label: "阈值", type: "number", default: "0.5" }],
    generate: (p) => `has_war_support > ${p.value}`,
    desc: "战争支持度大于指定值" },
  { id: "has_country_flag", label: "国家旗标", icon: "🚩", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "flag", label: "旗标名", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `has_country_flag = ${p.flag}`,
    desc: "是否拥有指定国家旗标" },
  { id: "has_political_power", label: "政治点数 >", icon: "🏛️", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "amount", label: "数量", type: "number", default: "100" }],
    generate: (p) => `has_political_power > ${p.amount}`,
    desc: "政治点数大于指定值" },
  { id: "is_ai", label: "是AI", icon: "🤖", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [],
    generate: () => `is_ai = yes`,
    desc: "是否由AI控制" },
  { id: "is_historical_focus_on", label: "史实路线", icon: "📜", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [],
    generate: () => `is_historical_focus_on = yes`,
    desc: "是否开启史实国策路线" },
  { id: "has_country_leader", label: "拥有领袖", icon: "👑", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "leader", label: "领袖ID", type: "string", default: "", placeholder: "leader_name" }],
    generate: (p, _sc, i) => `has_country_leader = ${block(`name = "${p.leader}"`, i + 4)}`,
    desc: "是否拥有指定领袖" },
  { id: "has_idea", label: "拥有精神", icon: "💡", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "idea", label: "精神ID", type: "string", default: "", placeholder: "idea_name" }],
    generate: (p) => `has_idea = ${p.idea}`,
    desc: "是否拥有指定国家精神" },
  { id: "is_major_power", label: "是主要国家", icon: "🌍", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [],
    generate: () => `is_major_power = yes`,
    desc: "是否为主要国家" },
  { id: "threat_level", label: "紧张度 >", icon: "⚠️", category: "条件", subcategory: "政治条件", color: "#3498db",
    params: [{ key: "value", label: "阈值", type: "number", default: "0.5" }],
    generate: (p) => `threat > ${p.value}`,
    desc: "世界紧张度大于指定值" },

  // ── 外交条件 ──
  { id: "is_subject", label: "是附庸", icon: "🔗", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [],
    generate: () => `is_subject = yes`,
    desc: "是否为附庸国" },
  { id: "is_puppet", label: "是傀儡", icon: "🔗", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [],
    generate: () => `is_puppet = yes`,
    desc: "是否为傀儡国" },
  { id: "is_in_faction", label: "在阵营中", icon: "🤝", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [],
    generate: () => `is_in_faction = yes`,
    desc: "是否加入了阵营" },
  { id: "has_war_with", label: "与…交战", icon: "⚔️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" }],
    generate: (p) => `has_war_with = ${p.target}`,
    desc: "是否与指定国家交战" },
  { id: "tag_is", label: "国家标签", icon: "🏷️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "tag", label: "标签", type: "string", default: "", placeholder: "GER" }],
    generate: (p) => `tag = ${p.tag}`,
    desc: "检查当前国家标签" },
  { id: "original_tag_is", label: "原始标签", icon: "🏷️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "tag", label: "标签", type: "string", default: "", placeholder: "GER" }],
    generate: (p) => `original_tag = ${p.tag}`,
    desc: "检查原始国家标签" },
  { id: "has_opinion", label: "关系值 >", icon: "💬", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [
      { key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" },
      { key: "value", label: "阈值", type: "number", default: "0" },
    ],
    generate: (p) => `has_opinion = { target = ${p.target} value > ${p.value} }`,
    desc: "对指定国家关系值大于阈值" },
  { id: "is_neighbor_of", label: "是邻国", icon: "🗺️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" }],
    generate: (p) => `is_neighbor_of = ${p.target}`,
    desc: "是否与指定国家接壤" },
  { id: "controls_state", label: "控制州", icon: "🏘️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "state", label: "州ID", type: "number", default: "0" }],
    generate: (p) => `controls_state = ${p.state}`,
    desc: "是否控制指定州" },
  { id: "any_owned_state_has", label: "任意州满足", icon: "🏘️", category: "条件", subcategory: "外交条件", color: "#2ecc71",
    params: [{ key: "flag", label: "州旗标", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `any_owned_state = { has_state_flag = ${p.flag} }`,
    desc: "任意拥有的州是否有指定旗标" },

  // ── 科技/工业条件 ──
  { id: "has_tech", label: "拥有科技", icon: "🔬", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "tech", label: "科技", type: "string", default: "", placeholder: "tech_name" }],
    generate: (p) => `has_tech = ${p.tech}`,
    desc: "是否已研究指定科技" },
  { id: "has_completed_focus", label: "完成国策", icon: "🌳", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "focus", label: "国策ID", type: "string", default: "", placeholder: "TAG_focus_name" }],
    generate: (p) => `has_completed_focus = ${p.focus}`,
    desc: "是否已完成指定国策" },
  { id: "num_of_factories", label: "工厂总数 >", icon: "🏭", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "50" }],
    generate: (p) => `num_of_factories > ${p.amount}`,
    desc: "工厂数量大于指定值" },
  { id: "num_of_military_factories", label: "军工厂数 >", icon: "🔫", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "10" }],
    generate: (p) => `num_of_military_factories > ${p.amount}`,
    desc: "军工厂大于指定值" },
  { id: "num_of_civilian_factories", label: "民工厂数 >", icon: "🏗️", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "20" }],
    generate: (p) => `num_of_civilian_factories > ${p.amount}`,
    desc: "民工厂大于指定值" },
  { id: "num_divisions", label: "师数量 >", icon: "⚔️", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "24" }],
    generate: (p) => `num_divisions > ${p.amount}`,
    desc: "陆军师数量大于指定值" },
  { id: "surrender_progress", label: "投降进度", icon: "🏳️", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "value", label: "阈值", type: "number", default: "0.5" }],
    generate: (p) => `surrender_progress > ${p.value}`,
    desc: "投降进度大于指定值" },
  { id: "has_capitulated", label: "已投降", icon: "🏳️", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [],
    generate: () => `has_capitulated = yes`,
    desc: "是否已投降" },
  { id: "has_army_experience", label: "陆军经验 >", icon: "⚔️", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "经验", type: "number", default: "50" }],
    generate: (p) => `has_army_experience > ${p.amount}`,
    desc: "陆军经验大于指定值" },
  { id: "has_navy_experience", label: "海军经验 >", icon: "🚢", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "经验", type: "number", default: "50" }],
    generate: (p) => `has_navy_experience > ${p.amount}`,
    desc: "海军经验大于指定值" },
  { id: "has_manpower", label: "人力 >", icon: "👥", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "100000" }],
    generate: (p) => `has_manpower > ${p.amount}`,
    desc: "人力大于指定值" },
  { id: "has_army_manpower", label: "陆军人力 >", icon: "👥", category: "条件", subcategory: "科技条件", color: "#9b59b6",
    params: [{ key: "amount", label: "数量", type: "number", default: "100000" }],
    generate: (p) => `has_army_manpower > ${p.amount}`,
    desc: "陆军人力大于指定值" },

  // ══════════════════════════════════════════════════
  //  效果 (Effects)
  // ══════════════════════════════════════════════════

  // ── 政治效果 ──
  { id: "add_political_power", label: "政治点数", icon: "🏛️", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "amount", label: "数量", type: "number", default: "50" }],
    generate: (p) => `add_political_power = ${p.amount}`,
    desc: "增加政治点数" },
  { id: "add_stability", label: "稳定度", icon: "⚖️", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "amount", label: "数值", type: "number", default: "0.1" }],
    generate: (p) => `add_stability = ${p.amount}`,
    desc: "增加稳定度 (0~1)" },
  { id: "add_war_support", label: "战争支持", icon: "🔥", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "amount", label: "数值", type: "number", default: "0.1" }],
    generate: (p) => `add_war_support = ${p.amount}`,
    desc: "增加战争支持度 (0~1)" },
  { id: "add_war_support_stability", label: "战争支持+稳定", icon: "🔥⚖️", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [
      { key: "ws", label: "战争支持", type: "number", default: "0.1" },
      { key: "st", label: "稳定度", type: "number", default: "0.1" },
    ],
    generate: (p) => `add_war_support = ${p.ws}\nadd_stability = ${p.st}`,
    desc: "同时增加战争支持和稳定度" },
  { id: "set_politics", label: "设置执政党", icon: "🏛️", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [
      { key: "party", label: "政党", type: "select", default: "neutrality", options: ["neutrality", "democratic", "fascism", "communism"] },
      { key: "elections", label: "允许选举", type: "select", default: "no", options: ["yes", "no"] },
    ],
    generate: (p, _sc, i) => `set_politics = ${block(`ruling_party = ${p.party}\nelections_allowed = ${p.elections}`, i + 4)}`,
    desc: "设置执政党和选举" },
  { id: "add_country_leader_trait", label: "领袖特质", icon: "👑", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "trait", label: "特质", type: "string", default: "", placeholder: "trait_name" }],
    generate: (p) => `add_country_leader_trait = ${p.trait}`,
    desc: "添加领袖特质" },
  { id: "set_country_flag", label: "设置旗标", icon: "🚩", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "flag", label: "旗标名", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `set_country_flag = ${p.flag}`,
    desc: "设置国家旗标" },
  { id: "clr_country_flag", label: "清除旗标", icon: "🚫", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "flag", label: "旗标名", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `clr_country_flag = ${p.flag}`,
    desc: "清除国家旗标" },
  { id: "set_popularities", label: "设置支持率", icon: "📊", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [
      { key: "democratic", label: "民主", type: "number", default: "25" },
      { key: "fascism", label: "法西斯", type: "number", default: "25" },
      { key: "communism", label: "共产", type: "number", default: "25" },
      { key: "neutrality", label: "中立", type: "number", default: "25" },
    ],
    generate: (p, _sc, i) => `set_popularities = ${block(`democratic = ${p.democratic}\nfascism = ${p.fascism}\ncommunism = ${p.communism}\nneutrality = ${p.neutrality}`, i + 4)}`,
    desc: "设置各政党支持率" },
  { id: "set_party_name", label: "设置党名", icon: "🏷️", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [
      { key: "party", label: "政党", type: "select", default: "neutrality", options: ["neutrality", "democratic", "fascism", "communism"] },
      { key: "name", label: "名称", type: "string", default: "", placeholder: "党派名称" },
    ],
    generate: (p) => `set_party_name = { ideology = ${p.party} name = "${p.name}" }`,
    desc: "设置政党名称" },
  { id: "add_legitimacy", label: "合法性", icon: "👑", category: "效果", subcategory: "政治效果", color: "#4a90d9",
    params: [{ key: "amount", label: "数值", type: "number", default: "10" }],
    generate: (p) => `add_legitimacy = ${p.amount}`,
    desc: "增加流亡政府合法性" },

  // ── 精神管理 ──
  { id: "add_ideas", label: "添加精神", icon: "💡", category: "效果", subcategory: "精神管理", color: "#f39c12",
    params: [{ key: "idea", label: "精神ID", type: "string", default: "", placeholder: "TAG_spirit" }],
    generate: (p) => `add_ideas = ${p.idea}`,
    desc: "添加国家精神" },
  { id: "remove_ideas", label: "移除精神", icon: "🚫", category: "效果", subcategory: "精神管理", color: "#f39c12",
    params: [{ key: "idea", label: "精神ID", type: "string", default: "", placeholder: "TAG_spirit" }],
    generate: (p) => `remove_ideas = ${p.idea}`,
    desc: "移除国家精神" },
  { id: "swap_ideas", label: "替换精神", icon: "🔄", category: "效果", subcategory: "精神管理", color: "#f39c12",
    params: [
      { key: "remove", label: "移除", type: "string", default: "", placeholder: "old_idea" },
      { key: "add", label: "添加", type: "string", default: "", placeholder: "new_idea" },
    ],
    generate: (p, _sc, i) => `swap_idea = ${block(`remove_idea = ${p.remove}\nadd_idea = ${p.add}`, i + 4)}`,
    desc: "替换一个国家精神为另一个" },

  // ── 军事效果 ──
  { id: "army_experience", label: "陆军经验", icon: "⚔️", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [{ key: "amount", label: "经验", type: "number", default: "25" }],
    generate: (p) => `army_experience = ${p.amount}`,
    desc: "增加陆军经验" },
  { id: "navy_experience", label: "海军经验", icon: "🚢", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [{ key: "amount", label: "经验", type: "number", default: "25" }],
    generate: (p) => `navy_experience = ${p.amount}`,
    desc: "增加海军经验" },
  { id: "air_experience", label: "空军经验", icon: "✈️", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [{ key: "amount", label: "经验", type: "number", default: "25" }],
    generate: (p) => `air_experience = ${p.amount}`,
    desc: "增加空军经验" },
  { id: "add_manpower", label: "人力", icon: "👥", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [{ key: "amount", label: "数量", type: "number", default: "10000" }],
    generate: (p) => `add_manpower = ${p.amount}`,
    desc: "增加人力" },
  { id: "add_command_power", label: "指挥点数", icon: "⭐", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [{ key: "amount", label: "数量", type: "number", default: "25" }],
    generate: (p) => `add_command_power = ${p.amount}`,
    desc: "增加指挥点数" },
  { id: "add_doctrine_cost_reduction", label: "学说减费", icon: "📖", category: "效果", subcategory: "军事效果", color: "#d94a4a",
    params: [
      { key: "amount", label: "减免", type: "number", default: "0.25" },
      { key: "name", label: "名称", type: "string", default: "land_doctrine" },
    ],
    generate: (p, _sc, i) => `add_doctrine_cost_reduction = ${block(`cost = ${p.amount}\nname = ${p.name}`, i + 4)}`,
    desc: "学说研究减费" },

  // ── 外交效果 ──
  { id: "create_wargoal", label: "战争目标", icon: "💥", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [
      { key: "target", label: "目标", type: "string", default: "", placeholder: "TAG_enemy" },
      { key: "type", label: "类型", type: "select", default: "annex_everything", options: ["annex_everything", "puppet", "take_state", "liberate"] },
    ],
    generate: (p, _sc, i) => `create_wargoal = ${block(`target = ${p.target}\ntype = ${p.type}`, i + 4)}`,
    desc: "创建战争目标" },
  { id: "puppet_effect", label: "傀儡化", icon: "🤝", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG_target" }],
    generate: (p) => `puppet = ${p.target}`,
    desc: "将目标变为傀儡" },
  { id: "annex_country", label: "吞并", icon: "🗺️", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG_target" }],
    generate: (p, _sc, i) => `annex_country = ${block(`target = ${p.target}`, i + 4)}`,
    desc: "吞并目标国家" },
  { id: "set_rule", label: "设置规则", icon: "📜", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [
      { key: "rule", label: "规则", type: "select", default: "can_create_factions", options: ["can_create_factions", "can_send_volunteers", "can_join_factions", "can_declare_war"] },
      { key: "value", label: "值", type: "select", default: "yes", options: ["yes", "no"] },
    ],
    generate: (p, _sc, i) => `set_rule = ${block(`${p.rule} = ${p.value}`, i + 4)}`,
    desc: "设置国家规则" },
  { id: "declare_war_on", label: "宣战", icon: "⚔️", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [
      { key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" },
      { key: "type", label: "类型", type: "select", default: "annex_everything", options: ["annex_everything", "puppet", "take_state"] },
    ],
    generate: (p, _sc, i) => `declare_war_on = ${block(`target = ${p.target}\ntype = ${p.type}`, i + 4)}`,
    desc: "向目标国家宣战" },
  { id: "add_to_faction", label: "加入阵营", icon: "🤝", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" }],
    generate: (p) => `add_to_faction = ${p.target}`,
    desc: "将目标加入己方阵营" },
  { id: "give_guarantee", label: "提供保证", icon: "🛡️", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [{ key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" }],
    generate: (p) => `give_guarantee = ${p.target}`,
    desc: "向目标提供独立保证" },
  { id: "add_opinion", label: "修改关系", icon: "💬", category: "效果", subcategory: "外交效果", color: "#2ecc71",
    params: [
      { key: "target", label: "目标", type: "string", default: "", placeholder: "TAG" },
      { key: "modifier", label: "修正值", type: "number", default: "20" },
    ],
    generate: (p) => `add_opinion_modifier = { target = ${p.target} modifier = ${p.modifier} }`,
    desc: "修改对目标国家的关系" },

  // ── 工业/科技效果 ──
  { id: "add_research_slot", label: "科研槽", icon: "🔬", category: "效果", subcategory: "工业效果", color: "#d9a44a",
    params: [{ key: "amount", label: "数量", type: "number", default: "1" }],
    generate: (p) => `add_research_slot = ${p.amount}`,
    desc: "增加科研槽" },
  { id: "add_tech_bonus", label: "科技加成", icon: "🔬", category: "效果", subcategory: "工业效果", color: "#d9a44a",
    params: [
      { key: "bonus", label: "加成", type: "number", default: "0.5" },
      { key: "uses", label: "次数", type: "number", default: "1" },
      { key: "category", label: "类别", type: "string", default: "industry", placeholder: "industry" },
    ],
    generate: (p, _sc, i) => `add_tech_bonus = ${block(`name = industrial_bonus\nbonus = ${p.bonus}\nuses = ${p.uses}\ncategory = ${p.category}`, i + 4)}`,
    desc: "科技研究加成" },
  { id: "add_resource", label: "资源开采", icon: "⛏️", category: "效果", subcategory: "工业效果", color: "#d9a44a",
    params: [
      { key: "state", label: "州ID", type: "number", default: "0" },
      { key: "type", label: "资源", type: "select", default: "steel", options: ["steel", "aluminium", "rubber", "oil", "chromium", "tungsten", "manganese"] },
      { key: "amount", label: "数量", type: "number", default: "8" },
    ],
    generate: (p) => `add_resource = { type = ${p.type} amount = ${p.amount} state = ${p.state} }`,
    desc: "在指定州增加资源开采" },

  // ── 州内建筑（州作用域专属）──
  { id: "state_build_civ", label: "建造民工", icon: "🏭", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "level", label: "数量", type: "number", default: "1" }],
    generate: (p, _sc, i) => {
      const b = block(`type = industrial_complex\nlevel = ${p.level}\ninstant_build = yes`, i + 4);
      return `add_extra_state_shared_building_slots = ${p.level}\nadd_building_construction = ${b}`;
    },
    desc: "在州内建造民用工厂" },
  { id: "state_build_mil", label: "建造军工", icon: "🔫", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "level", label: "数量", type: "number", default: "1" }],
    generate: (p, _sc, i) => {
      const b = block(`type = arms_factory\nlevel = ${p.level}\ninstant_build = yes`, i + 4);
      return `add_extra_state_shared_building_slots = ${p.level}\nadd_building_construction = ${b}`;
    },
    desc: "在州内建造军工厂" },
  { id: "state_build_dockyard", label: "建造船坞", icon: "🚢", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "level", label: "数量", type: "number", default: "1" }],
    generate: (p, _sc, i) => {
      const b = block(`type = dockyard\nlevel = ${p.level}\ninstant_build = yes`, i + 4);
      return `add_extra_state_shared_building_slots = ${p.level}\nadd_building_construction = ${b}`;
    },
    desc: "在州内建造船坞" },
  { id: "state_build_infra", label: "建造基建", icon: "🛤️", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "level", label: "等级", type: "number", default: "1" }],
    generate: (p, _sc, i) => `add_building_construction = ${block(`type = infrastructure\nlevel = ${p.level}\ninstant_build = yes`, i + 4)}`,
    desc: "在州内建造基础设施" },
  { id: "state_build_air", label: "建造机场", icon: "✈️", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "level", label: "等级", type: "number", default: "1" }],
    generate: (p, _sc, i) => `add_building_construction = ${block(`type = air_base\nlevel = ${p.level}\ninstant_build = yes`, i + 4)}`,
    desc: "在州内建造机场" },
  { id: "state_build_bunker", label: "建造碉堡", icon: "🏰", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [
      { key: "level", label: "等级", type: "number", default: "1" },
      { key: "province", label: "省份ID", type: "string", default: "", placeholder: "可选" },
    ],
    generate: (p, _sc, i) => `add_building_construction = ${block(`type = bunker\nlevel = ${p.level}\ninstant_build = yes`, i + 4)}`,
    desc: "在州内建造碉堡" },
  { id: "state_add_slots", label: "增加槽位", icon: "📦", category: "效果", subcategory: "州内建筑", color: "#e67e22",
    params: [{ key: "amount", label: "数量", type: "number", default: "1" }],
    generate: (p) => `add_extra_state_shared_building_slots = ${p.amount}`,
    desc: "增加州的建筑槽位" },
  { id: "state_set_flag", label: "设置州旗标", icon: "🚩", category: "效果", subcategory: "州内效果", color: "#e67e22",
    params: [{ key: "flag", label: "旗标名", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `set_state_flag = ${p.flag}`,
    desc: "在州上设置标记旗标" },
  { id: "state_clr_flag", label: "清除州旗标", icon: "🚫", category: "效果", subcategory: "州内效果", color: "#e67e22",
    params: [{ key: "flag", label: "旗标名", type: "string", default: "", placeholder: "my_flag" }],
    generate: (p) => `clr_state_flag = ${p.flag}`,
    desc: "清除州上的标记旗标" },
  { id: "state_set_province_controller", label: "设置省份控制", icon: "🗺️", category: "效果", subcategory: "州内效果", color: "#e67e22",
    params: [
      { key: "province", label: "省份ID", type: "string", default: "", placeholder: "1234" },
      { key: "controller", label: "控制者", type: "string", default: "", placeholder: "TAG" },
    ],
    generate: (p) => `set_province_controller = { province = ${p.province} controller = ${p.controller} }`,
    desc: "设置省份的控制者" },

  // ══════════════════════════════════════════════════
  //  控制流 (Containers)
  // ══════════════════════════════════════════════════

  // ── 条件分支（效果作用域内）──
  { id: "if_limit", label: "如果…则", icon: "❓", category: "控制流", subcategory: "条件分支", color: "#95a5a6",
    params: [],
    isContainer: true,
    slots: [
      { key: "limit", label: "🔍 条件（limit）:", acceptedChildren: COND_IDS },
      { key: "body", label: "⚡ 满足时执行:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => {
      const limitCode = sc.limit ? indent(sc.limit, i + 8) : "";
      const bodyCode = sc.body ? indent(sc.body, i + 4) : "";
      return `if = ${block(`limit = ${block(limitCode, i + 8)}\n${bodyCode}`, i)}`;
    },
    desc: "条件执行 — limit 内放条件，外面放效果" },
  { id: "else_block", label: "否则", icon: "↩️", category: "控制流", subcategory: "条件分支", color: "#95a5a6",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "⚡ 否则执行:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (_p, sc, i) => {
      const bodyCode = sc.body ? indent(sc.body, i + 4) : "";
      return `else = ${block(bodyCode, i)}`;
    },
    desc: "if 的 else 分支" },
  { id: "random_list", label: "随机列表", icon: "🎲", category: "控制流", subcategory: "条件分支", color: "#95a5a6",
    params: [
      { key: "weight1", label: "权重1", type: "number", default: "50" },
      { key: "weight2", label: "权重2", type: "number", default: "50" },
    ],
    isContainer: true,
    slots: [
      { key: "option1", label: "🎲 结果1:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
      { key: "option2", label: "🎲 结果2:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (p, sc, i) => {
      const o1 = sc.option1 ? indent(sc.option1, i + 8) : "";
      const o2 = sc.option2 ? indent(sc.option2, i + 8) : "";
      return `random_list = ${block(`${p.weight1} = ${block(o1, i + 8)}\n${p.weight2} = ${block(o2, i + 8)}`, i + 4)}`;
    },
    desc: "按权重随机执行" },
  { id: "custom_tooltip", label: "自定义提示", icon: "💬", category: "控制流", subcategory: "其他", color: "#95a5a6",
    params: [{ key: "text", label: "文本", type: "string", default: "", placeholder: "显示给玩家的说明" }],
    isContainer: true,
    slots: [
      { key: "body", label: "⚡ 实际效果:", acceptedChildren: [...EFFECT_IDS, ...CONTAINER_IDS] },
    ],
    generate: (p, sc, _i) => `custom_effect_tooltip = ${p.text}\n# ${(sc.body || "").split("\n").join("\n# ")}`,
    desc: "自定义效果提示文本" },

  // ── 条件分支（条件作用域内）──
  { id: "if_limit_condition", label: "如果…（条件内）", icon: "❓", category: "控制流", subcategory: "条件容器", color: "#95a5a6",
    params: [],
    isContainer: true,
    slots: [
      { key: "limit", label: "🔍 嵌套条件:", acceptedChildren: COND_IDS },
    ],
    generate: (_p, sc, i) => {
      const limitCode = sc.limit ? indent(sc.limit, i + 4) : "";
      return `if = ${block(limitCode, i)}`;
    },
    desc: "条件作用域内的嵌套 if" },

  // ── 州作用域容器 ──
  { id: "random_owned_controlled_state", label: "随机州", icon: "🏘️", category: "控制流", subcategory: "州作用域", color: "#e67e22",
    params: [{ key: "prioritize", label: "优先州ID", type: "string", default: "", placeholder: "123 124 125" }],
    isContainer: true,
    slots: [
      { key: "body", label: "🏘️ 在随机州内执行:", acceptedChildren: STATE_EFFECT_IDS },
    ],
    generate: (p, sc, i) => {
      const lines = ["random_owned_controlled_state = {"];
      if (p.prioritize) lines.push(`${" ".repeat(i + 4)}prioritize = { ${p.prioritize} }`);
      lines.push(indent(sc.body || "", i + 4));
      lines.push(`${" ".repeat(i)}}`);
      return lines.join("\n");
    },
    desc: "随机选择一个拥有的州执行" },
  { id: "every_owned_state", label: "遍历所有州", icon: "🌐", category: "控制流", subcategory: "州作用域", color: "#e67e22",
    params: [],
    isContainer: true,
    slots: [
      { key: "body", label: "🌐 对每个州执行:", acceptedChildren: STATE_EFFECT_IDS },
    ],
    generate: (_p, sc, i) => {
      const limit = block(`free_building_slots = ${block("building = industrial_complex\nsize > 0", i + 12)}`, i + 8);
      return `every_owned_state = ${block(`limit = ${limit}\n${indent(sc.body || "", i + 4)}`, i)}`;
    },
    desc: "遍历所有符合条件的州" },
];

// ============ Block Instance ============

export interface BlockInstance {
  id: string;
  defId: string;
  params: Record<string, string>;
  children?: BlockInstance[];
  slots?: Record<string, BlockInstance[]>;
}

let instanceCounter = 0;
function newInstanceId(): string {
  return `blk_${++instanceCounter}_${Date.now()}`;
}


// Parse code lines into BlockInstance children for a container slot
function consolidateLines(code: string): string[] {
  // Consolidate multi-line blocks into single "virtual lines"
  // e.g. "random_owned_controlled_state = {\n    limit = ...\n}" -> one string
  const rawLines = code.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const result: string[] = [];
  let buffer = "";
  let braceDepth = 0;

  for (const line of rawLines) {
    if (braceDepth === 0) {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      if (opens > closes) {
        buffer = line;
        braceDepth = opens - closes;
      } else {
        result.push(line);
      }
    } else {
      buffer += " " + line;
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        result.push(buffer);
        buffer = "";
        braceDepth = 0;
      }
    }
  }
  if (buffer) result.push(buffer);
  return result;
}

function parseCodeToChildren(code: string): BlockInstance[] {
  if (!code.trim()) return [];
  const lines = consolidateLines(code);
  const children: BlockInstance[] = [];

  for (const line of lines) {
    // Try to match each block definition
    let matched = false;
    for (const def of BLOCK_LIBRARY) {
      if (def.isContainer) continue; // skip structure containers
      if (def.id === "raw_text") continue; // skip raw_text, only used as fallback
      const result = tryMatchBlock(def, line);
      if (result) {
        children.push({ id: newInstanceId(), defId: def.id, params: result.params });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Unknown code — wrap as raw_text block to preserve it
      children.push({ id: newInstanceId(), defId: "raw_text", params: { code: line } });
    }
  }
  return children;
}

// Try to match a single code line against a block definition
function tryMatchBlock(def: BlockDef, line: string): { params: Record<string, string> } | null {
  // Generate with defaults to understand the pattern
  const defaultCode = def.generate(
    Object.fromEntries(def.params.map((p: any) => [p.key, p.default])),
    {}, 0
  ).trim();

  // Strategy: use the default code to identify the pattern, then extract params from actual line
  // Simple approach: split by "=" or " " and compare structure

  // 1. No-param blocks: exact match (case insensitive for = yes/no)
  if (def.params.length === 0) {
    const normDefault = defaultCode.replace(/\s+/g, " ").toLowerCase();
    const normLine = line.replace(/\s+/g, " ").toLowerCase();
    if (normLine === normDefault) return { params: {} };
    // Also try without "= yes" suffix
    if (normDefault.endsWith("= yes") && normLine === normDefault.replace("= yes", "").trim()) return { params: {} };
    return null;
  }

  // 2. Simple key=value blocks (no braces)
  // Pattern: "keyword = {param}" or "keyword > {param}" or "keyword = { ... }"
  const hasBraces = defaultCode.includes("{");

  if (!hasBraces) {
    // Extract the operator and keyword from default code
    // e.g., "has_stability > 0.5" -> keyword="has_stability", op=">", defaultVal="0.5"
    const opMatch = defaultCode.match(/^(.+?)\s*([>=<]+)\s*(.+)$/);
    const lineMatch = line.match(/^(.+?)\s*([>=<]+)\s*(.+)$/);
    if (!opMatch || !lineMatch) return null;

    const defKeyword = opMatch[1].trim();
    const defOp = opMatch[2].trim();
    const lineKeyword = lineMatch[1].trim();
    const lineOp = lineMatch[2].trim();
    const lineVal = lineMatch[3].trim();

    if (defKeyword.toLowerCase() !== lineKeyword.toLowerCase()) return null;
    if (defOp !== lineOp) return null;

    // Extract param: compare default vs actual to find which param
    // Simple: if def has 1 param, the value is that param
    if (def.params.length === 1) {
      return { params: { [def.params[0].key]: lineVal } };
    }

    // Multiple params: try to match by generating with each param
    // For now, assume single param for non-brace blocks
    return { params: { [def.params[0].key]: lineVal } };
  }

  // 3. Blocks with braces: "keyword = { ... }"
  const braceMatch = defaultCode.match(/^(.+?)\s*=\s*\{/);
  const lineBraceMatch = line.match(/^(.+?)\s*=\s*\{/);
  if (!braceMatch || !lineBraceMatch) return null;

  const defKeyword2 = braceMatch[1].trim();
  const lineKeyword2 = lineBraceMatch[1].trim();
  if (defKeyword2.toLowerCase() !== lineKeyword2.toLowerCase()) return null;

  // Extract inner content
  const openIdx = line.indexOf("{");
  if (openIdx < 0) return null;
  let depth = 1, closeIdx = -1;
  for (let i = openIdx + 1; i < line.length; i++) {
    if (line[i] === "{") depth++;
    else if (line[i] === "}") { depth--; if (depth === 0) { closeIdx = i; break; } }
  }
  if (closeIdx < 0) return null;
  const inner = line.slice(openIdx + 1, closeIdx).trim();

  // Parse inner as key=value pairs
  const params: Record<string, string> = {};
  for (const p of def.params) {
    // Try to extract "key = value" from inner
    const kvMatch = inner.match(new RegExp(p.key + '\\s*=\\s*("?[^"}]+"?)'));
    if (kvMatch) {
      params[p.key] = kvMatch[1].replace(/^"|"$/g, "");
    } else {
      params[p.key] = p.default;
    }
  }
  return { params };
}

function createBlockInstance(defId: string): BlockInstance {
  const def = BLOCK_LIBRARY.find((b) => b.id === defId);
  if (!def) return { id: newInstanceId(), defId, params: {} };
  const params: Record<string, string> = {};
  for (const p of def.params) params[p.key] = p.default;
  const inst: BlockInstance = { id: newInstanceId(), defId, params };
  if (def.isContainer) {
    if (def.slots) {
      inst.slots = {};
      for (const s of def.slots) inst.slots[s.key] = [];
    } else {
      inst.children = [];
    }
  }
  return inst;
}

// ============ Code Generation ============

function generateCode(b: BlockInstance, indentLevel: number = 4): string {
  const def = BLOCK_LIBRARY.find((d) => d.id === b.defId);
  if (!def) return "";
  const slotCode: Record<string, string> = {};
  if (def.slots && b.slots) {
    for (const s of def.slots) {
      const kids = b.slots[s.key] || [];
      slotCode[s.key] = kids.map((c) => generateCode(c, indentLevel + 4)).join("\n");
    }
  } else if (b.children) {
    slotCode["_default"] = b.children.map((c) => generateCode(c, indentLevel + 4)).join("\n");
  }
  return indent(def.generate(b.params, slotCode, indentLevel), indentLevel);
}

function generateAllCode(blocks: BlockInstance[]): string {
  return blocks.map((b) => generateCode(b, 4)).join("\n");
}

// ============ Palette ============

function groupBySubcategory(defs: BlockDef[]): { subcategory: string; defs: BlockDef[] }[] {
  const groups = new Map<string, BlockDef[]>();
  for (const d of defs) {
    if (!groups.has(d.subcategory)) groups.set(d.subcategory, []);
    groups.get(d.subcategory)!.push(d);
  }
  return Array.from(groups.entries()).map(([subcategory, defs]) => ({ subcategory, defs }));
}

// ============ Visual Block ============

function VisualBlock({
  block, onUpdate, onDelete, onAddSlotChild, depth = 0, locked = false,
}: {
  block: BlockInstance;
  onUpdate: (id: string, updates: Partial<BlockInstance>) => void;
  onDelete: (id: string) => void;
  onAddSlotChild?: (parentId: string, slotKey: string) => void;
  depth?: number;
  locked?: boolean;
}) {
  const def = BLOCK_LIBRARY.find((b) => b.id === block.defId);
  if (!def) return null;
  const [collapsed, setCollapsed] = useState(false);

  const handleParamChange = (key: string, value: string) => {
    onUpdate(block.id, { params: { ...block.params, [key]: value } });
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0, marginBottom: 4, borderLeft: `3px solid ${def.color}`, background: `${def.color}11`, borderRadius: "0 6px 6px 0", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: `${def.color}22`, cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed(!collapsed)}>
        <span style={{ fontSize: 8, color: def.color, transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
        <span style={{ fontSize: 13 }}>{def.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: def.color }}>{def.label}</span>
        <span style={{ flex: 1 }} />
        {!locked && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(block.id); }}
            style={{ background: "transparent", border: "none", color: "#e74c3c", fontSize: 12, cursor: "pointer", padding: "0 2px", opacity: 0.6 }} title="删除">×</button>
        )}
      </div>
      {!collapsed && (
        <div style={{ padding: "4px 8px 6px" }}>
          {def.params.map((p) => (
            <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <label style={{ fontSize: 10, color: "#888", minWidth: 40 }}>{p.label}</label>
              {p.type === "select" ? (
                <select value={block.params[p.key] ?? p.default} onChange={(e) => handleParamChange(p.key, e.target.value)}
                  style={{ flex: 1, fontSize: 11, padding: "2px 4px", background: "#1a1a1a", color: "#ddd", border: "1px solid #444", borderRadius: 3 }}>
                  {(p.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : p.type === "textarea" ? (
                <textarea value={block.params[p.key] ?? p.default}
                  onChange={(e) => handleParamChange(p.key, e.target.value)} placeholder={p.placeholder}
                  rows={3}
                  style={{ flex: 1, fontSize: 11, padding: "4px 6px", background: "#1a1a1a", color: "#ddd", border: "1px solid #444", borderRadius: 3, fontFamily: "monospace", resize: "vertical" }} />
              ) : (
                <input type={p.type === "number" ? "number" : "text"} value={block.params[p.key] ?? p.default}
                  onChange={(e) => handleParamChange(p.key, e.target.value)} placeholder={p.placeholder}
                  style={{ flex: 1, fontSize: 11, padding: "2px 4px", background: "#1a1a1a", color: "#ddd", border: "1px solid #444", borderRadius: 3, fontFamily: "monospace" }} />
              )}
            </div>
          ))}
          {def.slots && block.slots && def.slots.map((slotDef) => {
            const kids = block.slots![slotDef.key] || [];
            return (
              <div key={slotDef.key} style={{ marginTop: 4, paddingLeft: 4, borderLeft: `2px dashed ${def.color}66` }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>{slotDef.label}</div>
                {kids.map((child) => (
                  <VisualBlock key={child.id} block={child} onUpdate={onUpdate} onDelete={onDelete} onAddSlotChild={onAddSlotChild} depth={depth + 1} />
                ))}
                {kids.length === 0 && (
                  <div style={{ fontSize: 10, color: "#555", padding: "4px 0", fontStyle: "italic" }}>空 — 点击添加</div>
                )}
                {onAddSlotChild && (
                  <button onClick={() => onAddSlotChild(block.id, slotDef.key)}
                    style={{ fontSize: 10, padding: "3px 8px", marginTop: 4, background: "#2d2d2d", color: "#6fcf6f", border: "1px solid #3d6a3d", borderRadius: 3, cursor: "pointer" }}>
                    + 添加积木
                  </button>
                )}
              </div>
            );
          })}
          {def.isContainer && !def.slots && (
            <div style={{ marginTop: 4, paddingLeft: 4, borderLeft: "2px dashed #444" }}>
              {def.childLabel && <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>{def.childLabel}</div>}
              {(block.children || []).map((child) => (
                <VisualBlock key={child.id} block={child} onUpdate={onUpdate} onDelete={onDelete} onAddSlotChild={onAddSlotChild} depth={depth + 1} />
              ))}
              {(block.children || []).length === 0 && !def.childLabel && (
                <div style={{ fontSize: 10, color: "#555", padding: "4px 0", fontStyle: "italic" }}>空</div>
              )}
              {onAddSlotChild && (
                <button onClick={() => onAddSlotChild(block.id, "_default")}
                  style={{ fontSize: 10, padding: "3px 8px", marginTop: 4, background: "#2d2d2d", color: "#6fcf6f", border: "1px solid #3d6a3d", borderRadius: 3, cursor: "pointer" }}>
                  + 添加积木
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Block Palette ============

function BlockPalette({ onAdd, filterIds }: { onAdd: (defId: string) => void; filterIds?: string[] }) {
  const [category, setCategory] = useState<BlockCategory | null>(null);
  const categories: { key: BlockCategory; icon: string; color: string }[] = [
    { key: "条件", icon: "🔍", color: "#3498db" },
    { key: "效果", icon: "⚡", color: "#e67e22" },
    { key: "控制流", icon: "🔀", color: "#95a5a6" },
  ];
  const library = filterIds ? BLOCK_LIBRARY.filter((b) => filterIds.includes(b.id)) : BLOCK_LIBRARY;
  const filtered = category ? library.filter((b) => b.category === category) : library;
  const groups = groupBySubcategory(filtered);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
        <button onClick={() => setCategory(null)}
          style={{ fontSize: 10, padding: "3px 10px", background: category === null ? "#c9a227" : "#2d2d2d", color: category === null ? "#1a1a1a" : "#707070", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: category === null ? 600 : 400 }}>全部</button>
        {categories.map((cat) => (
          <button key={cat.key} onClick={() => setCategory(cat.key)}
            style={{ fontSize: 10, padding: "3px 10px", background: category === cat.key ? cat.color : "#2d2d2d", color: category === cat.key ? "#fff" : "#707070", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: category === cat.key ? 600 : 400 }}>
            {cat.icon} {cat.key}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g.subcategory} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#666", marginBottom: 4, paddingLeft: 2, borderBottom: "1px solid #2a2a2a", paddingBottom: 2 }}>{g.subcategory}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {g.defs.map((def) => (
              <button key={def.id} onClick={() => onAdd(def.id)} title={def.desc}
                style={{ fontSize: 10, padding: "3px 6px", background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}44`, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = def.color; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${def.color}44`; }}>
                {def.icon} {def.label}
                {def.isContainer && <span style={{ fontSize: 8, opacity: 0.6 }}>▪▪</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ fontSize: 10, color: "#555", padding: "4px 0" }}>此容器不接受更多积木类型</div>
      )}
    </div>
  );
}

// ============ Focus Structure Editor (fixed layout) ============

function createFocusStructureBlocks(): BlockInstance[] {
  return [
    createBlockInstance("available_block"),
    createBlockInstance("bypass_block"),
    createBlockInstance("completion_reward"),
    createBlockInstance("select_effect_block"),
    createBlockInstance("cancel_block"),
  ];
}

// Extract code strings from container blocks (for syncing to FocusNode code fields)
export function extractBlockCode(containers: BlockInstance[]): { completionReward?: string; available?: string; bypass?: string; selectEffect?: string } {
  const result: Record<string, string> = {};
  for (const b of containers) {
    const def = BLOCK_LIBRARY.find((d) => d.id === b.defId);
    if (!def || !def.slots) continue;
    const slotCode: Record<string, string> = {};
    for (const s of def.slots) {
      const kids = b.slots?.[s.key] || [];
      // Generate children at indentLevel=0, since the wrapper (completion_reward = {...}) will be stripped
      slotCode[s.key] = kids.map((c) => generateCode(c, 0)).join("\n");
    }
    const code = def.generate(b.params, slotCode, 0);
    const openIdx = code.indexOf("{");
    if (openIdx >= 0) {
      let depth = 1;
      let closeIdx = -1;
      for (let i = openIdx + 1; i < code.length; i++) {
        if (code[i] === "{") depth++;
        else if (code[i] === "}") depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
      const inner = closeIdx > openIdx ? code.slice(openIdx + 1, closeIdx).trim() : "";
      if (b.defId === "completion_reward") result.completionReward = inner;
      else if (b.defId === "available_block") result.available = inner;
      else if (b.defId === "bypass_block") result.bypass = inner;
      else if (b.defId === "select_effect_block") result.selectEffect = inner;
    }
  }
  return result as any;
}

// Initialize containers from FocusNode (blocks field takes priority, fallback to code strings)
function initContainersFromFocus(focus: FocusNode): BlockInstance[] {
  const containers = createFocusStructureBlocks();
  const blocksData = focus.blocks;
  console.log("[BlockEditor] initContainersFromFocus:", focus.id, "hasBlocks=", !!blocksData, "completionReward=", (focus.completionReward || "").slice(0, 50));

  // If blocks already exist in treeData, use them directly
  if (blocksData) {
    const fieldMap: Record<string, string> = {
      completionReward: "completion_reward",
      available: "available_block",
      bypass: "bypass_block",
      selectEffect: "select_effect_block",
    };
    for (const [field, containerDefId] of Object.entries(fieldMap)) {
      const blockInstances = (blocksData as any)[field] as BlockInstance[] | undefined;
      if (!blockInstances || blockInstances.length === 0) continue;
      const container = containers.find(c => c.defId === containerDefId);
      if (container && container.slots) {
        container.slots["body"] = blockInstances;
      }
    }
    console.log("[BlockEditor] Using stored blocks:", containers.map(c => `${c.defId}(${(c.slots?.body || []).length} children)`));
    return containers;
  }

  // Fallback: parse from code strings
  const codeFields: Record<string, string | undefined> = {
    completionReward: focus.completionReward,
    available: focus.available,
    bypass: focus.bypass,
    selectEffect: focus.selectEffect,
  };
  const fieldMap: Record<string, string> = {
    completionReward: "completion_reward",
    available: "available_block",
    bypass: "bypass_block",
    selectEffect: "select_effect_block",
  };
  for (const [field, containerDefId] of Object.entries(fieldMap)) {
    const code = codeFields[field];
    if (!code) continue;
    const container = containers.find(c => c.defId === containerDefId);
    if (!container) continue;
    const children = parseCodeToChildren(code);
    console.log("[BlockEditor] Parsed code for", field, ":", children.length, "children", children.map(c => c.defId));
    if (children.length > 0 && container.slots) {
      container.slots["body"] = children;
    }
  }
  console.log("[BlockEditor] Final containers:", containers.map(c => `${c.defId}(${(c.slots?.body || []).length} children)`));
  return containers;
}

export interface FocusBlockEditorProps {
  focus: FocusNode;
  onUpdate: (id: string, updates: Partial<FocusNode>) => void;
}

export function FocusBlockEditor({ focus, onUpdate }: FocusBlockEditorProps) {
  const [blocks, setBlocks] = useState<BlockInstance[]>(() => initContainersFromFocus(focus));
  const prevFocusIdRef = useRef(focus.id);
  const [addingTo, setAddingTo] = useState<{ parentId: string; slotKey: string; acceptedIds: string[] } | null>(null);

  // Expose debug info on window
  useEffect(() => {
    (window as any).__blockDebug = {
      focus,
      blocks,
      onUpdate,
      refresh: () => setBlocks(initContainersFromFocus(focus)),
    };
    console.log("[BlockEditor] Mounted for:", focus.id, "blocks=", blocks.length);
  }, [focus.id, blocks]);

  // Reset when focus changes
  if (focus.id !== prevFocusIdRef.current) {
    prevFocusIdRef.current = focus.id;
    setBlocks(initContainersFromFocus(focus));
  }

  // Sync changes back to treeData (blocks + code strings)
  const notifyChange = useCallback(
    (newBlocks: BlockInstance[]) => {
      setBlocks(newBlocks);
      const code = extractBlockCode(newBlocks);
      onUpdate(focus.id, {
        blocks: {
          completionReward: findContainerChildren(newBlocks, "completion_reward"),
          available: findContainerChildren(newBlocks, "available_block"),
          bypass: findContainerChildren(newBlocks, "bypass_block"),
          selectEffect: findContainerChildren(newBlocks, "select_effect_block"),
        },
        ...code,
      });
    },
    [focus.id, onUpdate]
  );

  const handleAddFromPalette = useCallback(
    (defId: string) => {
      const instance = createBlockInstance(defId);
      if (addingTo) {
        const addToSlot = (list: BlockInstance[]): BlockInstance[] =>
          list.map((b) => {
            if (b.id === addingTo.parentId && b.slots) {
              return { ...b, slots: { ...b.slots, [addingTo.slotKey]: [...(b.slots[addingTo.slotKey] || []), instance] } };
            }
            if (b.slots) {
              const newSlots: Record<string, BlockInstance[]> = {};
              for (const [k, v] of Object.entries(b.slots)) newSlots[k] = addToSlot(v);
              return { ...b, slots: newSlots };
            }
            return b;
          });
        notifyChange(addToSlot(blocks));
      }
      setAddingTo(null);
    },
    [blocks, notifyChange, addingTo]
  );

  const handleAddSlotChild = useCallback(
    (parentId: string, slotKey: string) => {
      const findBlock = (list: BlockInstance[]): BlockInstance | undefined => {
        for (const b of list) {
          if (b.id === parentId) return b;
          if (b.slots) {
            for (const kids of Object.values(b.slots)) {
              const found = findBlock(kids);
              if (found) return found;
            }
          }
        }
        return undefined;
      };
      const parent = findBlock(blocks);
      const def = parent ? BLOCK_LIBRARY.find((d) => d.id === parent.defId) : undefined;
      const slotDef = def?.slots?.find((s) => s.key === slotKey);
      const acceptedIds = slotDef?.acceptedChildren || def?.acceptedChildren || [];
      setAddingTo({ parentId, slotKey, acceptedIds });
    },
    [blocks]
  );

  const handleUpdate = useCallback(
    (id: string, updates: Partial<BlockInstance>) => {
      const updateInList = (list: BlockInstance[]): BlockInstance[] =>
        list.map((b) => {
          if (b.id === id) return { ...b, ...updates };
          if (b.slots) {
            const newSlots: Record<string, BlockInstance[]> = {};
            for (const [k, v] of Object.entries(b.slots)) newSlots[k] = updateInList(v);
            return { ...b, slots: newSlots };
          }
          return b;
        });
      notifyChange(updateInList(blocks));
    },
    [blocks, notifyChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const removeFromList = (list: BlockInstance[]): BlockInstance[] =>
        list.filter((b) => b.id !== id).map((b) => {
          if (b.slots) {
            const newSlots: Record<string, BlockInstance[]> = {};
            for (const [k, v] of Object.entries(b.slots)) newSlots[k] = removeFromList(v);
            return { ...b, slots: newSlots };
          }
          return b;
        });
      notifyChange(removeFromList(blocks));
    },
    [blocks, notifyChange]
  );

  const codePreview = useMemo(() => generateAllCode(blocks), [blocks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Info bar */}
      <div style={{ fontSize: 10, color: "#888", padding: "6px 10px", background: "#1a2a1a", borderBottom: "1px solid #2a3a2a", flexShrink: 0 }}>
        🏗️ 国策结构 — 点击 "+ 添加积木" 在槽位中插入效果/条件
      </div>
      {/* Block tree */}
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {blocks.map((block) => (
          <VisualBlock key={block.id} block={block} onUpdate={handleUpdate} onDelete={handleDelete} onAddSlotChild={handleAddSlotChild} locked={true} />
        ))}
      </div>
      {/* Palette */}
      <div style={{ borderTop: "1px solid #2a2a2a", padding: 12, background: "#141414", maxHeight: "40%", overflow: "auto" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#c9a227", marginBottom: 8 }}>📦 积木库</div>
        {addingTo && (
          <div style={{ fontSize: 10, color: "#4a90d9", marginBottom: 8, padding: "4px 8px", background: "#1a2a3a", borderRadius: 4 }}>
            📦 添加到容器槽位
            <button onClick={() => setAddingTo(null)}
              style={{ marginLeft: 8, fontSize: 9, background: "transparent", color: "#707070", border: "none", cursor: "pointer" }}>取消</button>
          </div>
        )}
        <BlockPalette onAdd={handleAddFromPalette} filterIds={addingTo?.acceptedIds} />
      </div>
      {/* Code Preview */}
      <details style={{ borderTop: "1px solid #2a2a2a", background: "#111", flexShrink: 0 }}>
        <summary style={{ fontSize: 11, color: "#707070", cursor: "pointer", padding: "6px 12px" }}>📄 查看生成的代码</summary>
        <pre style={{ fontSize: 11, fontFamily: "var(--font-mono)", background: "#1a1a1a", color: "#aaa", padding: 8, margin: 0, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap" }}>
          {codePreview}
        </pre>
      </details>
    </div>
  );
}

// Helper: find children of a container block by defId
function findContainerChildren(blocks: BlockInstance[], containerDefId: string): BlockInstance[] {
  const container = blocks.find(b => b.defId === containerDefId);
  if (!container || !container.slots) return [];
  return container.slots["body"] || [];
}

// ============ Main Editor ============

export interface BlockEditorProps {
  initialCode?: string;
  initialBlocks?: BlockInstance[];
  onChange: (code: string) => void;
  mode?: "effect" | "condition";
  locked?: boolean; // if true, top-level blocks can't be deleted
}

export function BlockEditor({ initialCode, initialBlocks, onChange, mode = "effect", locked = false }: BlockEditorProps) {
  // @ts-ignore - TODO: parse initialCode into blocks
  void initialCode; void mode;
  const [blocks, setBlocks] = useState<BlockInstance[]>(initialBlocks || []);
  const [addingTo, setAddingTo] = useState<{ parentId: string; slotKey: string; acceptedIds: string[] } | null>(null);

  const notifyChange = useCallback(
    (newBlocks: BlockInstance[]) => { setBlocks(newBlocks); onChange(generateAllCode(newBlocks)); },
    [onChange]
  );

  const handleAddFromPalette = useCallback(
    (defId: string) => {
      const instance = createBlockInstance(defId);
      if (addingTo) {
        const addToSlot = (list: BlockInstance[]): BlockInstance[] =>
          list.map((b) => {
            if (b.id === addingTo.parentId && b.slots) {
              return { ...b, slots: { ...b.slots, [addingTo.slotKey]: [...(b.slots[addingTo.slotKey] || []), instance] } };
            }
            if (b.id === addingTo.parentId && b.children !== undefined) {
              return { ...b, children: [...b.children, instance] };
            }
            if (b.slots) {
              const newSlots: Record<string, BlockInstance[]> = {};
              for (const [k, v] of Object.entries(b.slots)) newSlots[k] = addToSlot(v);
              return { ...b, slots: newSlots };
            }
            if (b.children) return { ...b, children: addToSlot(b.children) };
            return b;
          });
        notifyChange(addToSlot(blocks));
      } else {
        notifyChange([...blocks, instance]);
      }
      setAddingTo(null);
    },
    [blocks, notifyChange, addingTo]
  );

  const handleAddSlotChild = useCallback(
    (parentId: string, slotKey: string) => {
      const findBlock = (list: BlockInstance[]): BlockInstance | undefined => {
        for (const b of list) {
          if (b.id === parentId) return b;
          if (b.slots) {
            for (const kids of Object.values(b.slots)) {
              const found = findBlock(kids);
              if (found) return found;
            }
          }
          if (b.children) {
            const found = findBlock(b.children);
            if (found) return found;
          }
        }
        return undefined;
      };
      const parent = findBlock(blocks);
      const def = parent ? BLOCK_LIBRARY.find((d) => d.id === parent.defId) : undefined;
      const slotDef = def?.slots?.find((s) => s.key === slotKey);
      const acceptedIds = slotDef?.acceptedChildren || def?.acceptedChildren || [];
      setAddingTo({ parentId, slotKey, acceptedIds });
      
    },
    [blocks]
  );

  const handleUpdate = useCallback(
    (id: string, updates: Partial<BlockInstance>) => {
      const updateInList = (list: BlockInstance[]): BlockInstance[] =>
        list.map((b) => {
          if (b.id === id) return { ...b, ...updates };
          if (b.slots) {
            const newSlots: Record<string, BlockInstance[]> = {};
            for (const [k, v] of Object.entries(b.slots)) newSlots[k] = updateInList(v);
            return { ...b, slots: newSlots };
          }
          if (b.children) return { ...b, children: updateInList(b.children) };
          return b;
        });
      notifyChange(updateInList(blocks));
    },
    [blocks, notifyChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const removeFromList = (list: BlockInstance[]): BlockInstance[] =>
        list.filter((b) => b.id !== id).map((b) => {
          if (b.slots) {
            const newSlots: Record<string, BlockInstance[]> = {};
            for (const [k, v] of Object.entries(b.slots)) newSlots[k] = removeFromList(v);
            return { ...b, slots: newSlots };
          }
          if (b.children) return { ...b, children: removeFromList(b.children) };
          return b;
        });
      notifyChange(removeFromList(blocks));
    },
    [blocks, notifyChange]
  );

  const codePreview = useMemo(() => generateAllCode(blocks), [blocks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {blocks.map((block) => (
        <VisualBlock key={block.id} block={block} onUpdate={handleUpdate} onDelete={locked ? () => {} : handleDelete} onAddSlotChild={handleAddSlotChild} locked={locked} />
      ))}
      {blocks.length === 0 && (
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", padding: "12px 0", fontStyle: "italic" }}>点击下方添加积木</div>
      )}
      <div>
        {addingTo && (
          <div style={{ fontSize: 10, color: "#4a90d9", marginBottom: 6 }}>
            📦 添加到容器槽位
            <button onClick={() => setAddingTo(null)}
              style={{ marginLeft: 8, fontSize: 9, background: "transparent", color: "#707070", border: "none", cursor: "pointer" }}>取消</button>
          </div>
        )}
        <BlockPalette onAdd={handleAddFromPalette} filterIds={addingTo?.acceptedIds} />
      </div>
      {codePreview.trim() && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 10, color: "#707070", cursor: "pointer" }}>📄 查看生成的代码</summary>
          <pre style={{ fontSize: 11, fontFamily: "var(--font-mono)", background: "#1a1a1a", color: "#aaa", padding: 8, borderRadius: 4, marginTop: 4, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap" }}>
            {codePreview}
          </pre>
        </details>
      )}
    </div>
  );
}
