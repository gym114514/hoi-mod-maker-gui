// ============================================================
// Core data types for HOI4 Mod Maker GUI
// ============================================================

// ---------- Focus Tree ----------

export interface FocusTree {
  id: string;
  country?: CountryWeight[];
  default?: boolean;
  resetOnCivilwar?: boolean;
  initialShowPosition?: FocusShowPosition;
  continuousFocusPosition?: { x: number; y: number };
  sharedFocuses?: string[];
  inlayWindows?: InlayWindow[];
  shortcuts?: Shortcut[];
  focuses: FocusNode[];
}

export interface CountryWeight {
  factor?: number;
  modifier?: {
    add?: number;
    tag?: string;
    hasDlc?: string;
    [key: string]: unknown;
  };
}

export interface FocusShowPosition {
  focus?: string;
  x?: number;
  y?: number;
}

export interface InlayWindow {
  id: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface Shortcut {
  name: string;
  target: string;
  scrollWheelFactor?: number;
  trigger?: string;
}

// ---------- Block Instance (for visual block editor) ----------

export interface BlockInstance {
  id: string;
  defId: string;
  params: Record<string, string>;
  children?: BlockInstance[];
  slots?: Record<string, BlockInstance[]>;
}

export interface FocusNode {
  id: string;
  icon?: string;
  x: number;
  y: number;
  relativePositionId?: string;
  cost: number;
  prerequisite?: string[][];
  mutuallyExclusive?: string[];
  available?: string;
  bypass?: string;
  allowBranch?: string;
  cancelIfInvalid?: boolean;
  continueIfInvalid?: boolean;
  availableIfCapitulated?: boolean;
  completionReward?: string;
  selectEffect?: string;
  completeTooltip?: string;
  hiddenEffect?: string;
  aiWillDo?: AiWillDo;
  searchFilters: string[];
  offset?: FocusOffset[];
  dynamic?: boolean;
  innerCircle?: boolean;
  continuous?: boolean;
  modifier?: Record<string, number | string>;
  // Block editor data — source of truth for completionReward/available/bypass/selectEffect
  blocks?: {
    completionReward?: BlockInstance[];
    available?: BlockInstance[];
    bypass?: BlockInstance[];
    selectEffect?: BlockInstance[];
  };
}

export interface FocusOffset {
  id: string;
  x: number;
  y: number;
  trigger?: string;
}

export interface AiWillDo {
  base?: number;
  modifier?: AiModifier[];
}

// ---------- Ideas ----------

export interface IdeaCategory {
  type: IdeaCategoryType;
  ideas: Idea[];
}

export type IdeaCategoryType =
  | "country"
  | "army"
  | "navy"
  | "air"
  | "political_advisor"
  | "theorist"
  | "army_chief"
  | "navy_chief"
  | "air_chief"
  | "high_command"
  | "designer";

export interface Idea {
  id: string;
  categoryType: IdeaCategoryType;
  picture?: string;
  allowed?: string;
  allowedCivilWar?: string;
  removalCost?: number;
  modifier: Record<string, number>;
  targetedModifier?: TargetedModifier[];
  researchBonus?: Record<string, number>;
  // advisor-specific
  slot?: string;
  ideaToken?: string;
  traits?: string[];
  cost?: number;
  aiWillDo?: AiWillDo;
  // GUI display
  name: string;
  description: string;
}

export interface TargetedModifier {
  tag?: string;
  modifier: Record<string, number>;
}

// ---------- Events ----------

export interface GameEvent {
  namespace: string;
  id: number;
  type: "country_event" | "news_event" | "state_event";
  title: string;
  desc: string | string[];
  picture?: string;
  trigger?: string;
  meanTimeToHappen?: MTTH;
  isTriggeredOnly?: boolean;
  fireOnlyOnce?: boolean;
  options: EventOption[];
}

export interface EventOption {
  name: string;
  trigger?: string;
  aiWillDo?: AiWillDo;
  effect: string;
}

export interface MTTH {
  days?: number;
  modifier?: MTTHModifier[];
}

export interface MTTHModifier {
  add?: number;
  factor?: number;
  [key: string]: unknown;
}

// ---------- Characters ----------

export interface Character {
  token: string;
  name: string;
  portraits: Portraits;
  gender?: "male" | "female";
  countryLeader?: CountryLeaderRole;
  advisor?: AdvisorRole;
  corpsCommander?: CommanderRole;
  fieldMarshal?: CommanderRole;
  navyLeader?: NavyCommanderRole;
}

export interface Portraits {
  civilian?: { large?: string; small?: string };
  army?: { large?: string; small?: string };
  navy?: { large?: string; small?: string };
  [key: string]: { large?: string; small?: string } | undefined;
}

export interface CountryLeaderRole {
  ideology: string;
  traits?: string[];
  expire?: string;
  id?: number;
}

export interface AdvisorRole {
  slot: string;
  ideaToken?: string;
  traits: string[];
  cost?: number;
  available?: string;
}

export interface CommanderRole {
  traits: string[];
  skill?: number;
  attackSkill?: number;
  defenseSkill?: number;
  planningSkill?: number;
  logisticsSkill?: number;
}

export interface NavyCommanderRole extends CommanderRole {
  navalTrait?: string;
}

// ---------- Project ----------

export interface ModProject {
  path: string;
  name: string;
  version: string;
  supportedVersion: string;
  tags: string[];
  thumbnail?: string;
  dependencies: string[];
  files: ModFile[];
}

export interface ModFile {
  path: string;
  type: FileType;
  name?: string;
  content?: string;
  rawContent?: string;
}

export type FileType =
  | "focus_tree"
  | "ideas"
  | "events"
  | "characters"
  | "decisions"
  | "localisation"
  | "descriptor"
  | "other";

// ---------- Validation ----------

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationIssue {
  file?: string;
  line: number;
  column?: number;
  message: string;
  code: string;
  severity?: string;
}

export type ValidationError = ValidationIssue;
export type ValidationWarning = ValidationIssue;

// ---------- Shared ----------

export interface AiModifier {
  factor?: number;
  add?: number;
  [key: string]: unknown;
}

// ---------- React Flow ----------

export interface FlowNode {
  id: string;
  type: "focus";
  position: { x: number; y: number };
  data: FocusNode;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "prerequisite" | "mutuallyExclusive";
}

// ---------- UI State ----------

export type EditorTab =
  | "focus-tree"
  | "ideas"
  | "events"
  | "characters"
  | "decisions"
  | "localisation"
  | "code";

export interface EditorState {
  activeTab: EditorTab;
  selectedFileId: string | null;
  selectedFocusId: string | null;
  panelWidth: number;
  showMinimap: boolean;
  showGrid: boolean;
}