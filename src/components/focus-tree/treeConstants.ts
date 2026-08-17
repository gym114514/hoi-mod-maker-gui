/**
 * 树渲染共享常量 —— 布局尺寸与颜色单一来源。
 * 画布（FocusTreeEditor）、节点（FocusNodeComponent）、连线（BrokenLineEdge）、
 * 右栏面板（FocusPropertyPanel）统一从这里取值，避免跨文件硬编码漂移。
 */

// ---------- 布局尺寸 ----------

// 网格间距（像素）：节点中心点之间的水平/垂直距离
export const GRID_X = 180;
export const GRID_Y = 180;

// 节点固定尺寸 —— 必须与 focusToNode 的像素换算保持一致
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 100;

// ---------- 高亮颜色 ----------

export const SELECTED_HL_COLOR = "#c9a227"; // 选中金
export const PREREQ_HL_COLORS = ["#4a9de0", "#3fbf8f", "#9d6de0", "#e8930c"]; // 前置组循环色
export const EXCLUSIVE_HL_COLOR = "#d94a4a"; // 互斥红
export const SEARCH_HL_COLOR = "#2ac3de"; // 搜索青

// ---------- 连线颜色（贴近原版：前置灰线、互斥红线） ----------

export const PREREQ_LINE_COLOR = "#9a9a9a";
export const PREREQ_OR_LINE_COLOR = "#808080";
