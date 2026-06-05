# HOI Mod Maker GUI — Bug Report
Generated: 2026-05-21 | Updated: 2026-05-21

## 修复状态总览

| # | 严重度 | 描述 | 状态 |
|---|--------|------|------|
| 1 | 🔴 严重 | validator ai_will_do 状态机无法重置 | ✅ 已修复 |
| 2 | 🔴 严重 | FocusTreeEditor childrenOf 变量遮蔽 | ✅ 已修复 |
| 3 | 🟡 中等 | Rust Lexer § 颜色代码未处理 | ✅ 已修复 |
| 4 | 🟡 中等 | 流式解析器 focus_lines 残留风险 | ⏭️ 跳过（风险极低） |
| 5 | 🟡 中等 | UTF-8 BOM 检测/跳过 | ✅ 已修复 |
| 6 | 🟢 轻微 | 拖拽 onNodeMove 过度调用 | ✅ 已修复 |
| 7 | 🟢 轻微 | IdeasPanel/EventsPanel 纯静态 UI | ⏳ 功能缺失，需大量开发 |
| 8 | 🟢 轻微 | Sidebar 模板 ID 重复 | ⏳ 低优先级 |
| - | 🔍 技术债 | useCallback nodes 依赖项冗余 | ✅ 已修复 |

---

## 已修复 Bug 详情

### ✅ Bug #1：Rust validator — `ai_will_do` 块状态机无法重置

**文件：** `src-tauri/src/validator.rs`

**根因：** 两个问题叠加：
1. 退出条件 `brace_depth <= 0` 永远不会为 true（应改为 `brace_depth <= ai_brace_start`）
2. `factor = 0` 解析时 `parts[1]` 取到的是 `=` 而非值（HOI4 格式 `factor = 0`，空格分割后 `["factor", "=", "0", "}"]`）

**修复：**
- 退出条件改为 `brace_depth <= ai_brace_start`（记录进入时的深度）
- 解析值时跳过等号：`let value_idx = if parts[1] == "=" { 2 } else { 1 };`
- 跳过注释行避免干扰状态机

**验证：** 3 个 Rust 单元测试全部通过

### ✅ Bug #2：FocusTreeEditor — `childrenOf` 变量遮蔽

**文件：** `src/components/focus-tree/FocusTreeEditor.tsx`

**修复：** Pass 2 中将 `childrenOf` 重命名为 `childrenByPrereq`，消除与 Pass 1 的 shadowing

### ✅ Bug #3：Rust Lexer — § 颜色代码未处理

**文件：** `src-tauri/src/parser.rs`

**修复：** 在 `read_string` 中将 `§`(U+00A7) 和 `©`(U+00A9) 作为普通字符处理，不再触发转义逻辑

### ✅ Bug #5：UTF-8 BOM 检测/跳过

**文件：** `src-tauri/src/parser.rs`

**修复：** Lexer 添加 BOM 跳过（`self.input.first() == Some(&'\u{feff}')`）

### ✅ Bug #6：拖拽 onNodeMove 过度调用

**文件：** `src/components/focus-tree/FocusTreeEditor.tsx`

**修复：** 只在 `change.dragging === false` 时调用 `onNodeMove`

### ✅ 技术债：useCallback nodes 依赖项冗余

**文件：** `src/components/focus-tree/FocusTreeEditor.tsx`

**修复：** 从 `handleNodesChange` 的 useCallback 依赖数组中移除 `nodes`（使用 setNodes 函数式更新，无需依赖 nodes）

---

## 未修复项

### ⏭️ Bug #4：focus_lines 残留风险（跳过）

`capture_sub_block_lines` 中 `inner` 是局部变量，每次调用重新创建，实际残留风险极低。

### ⏳ Bug #7：IdeasPanel/EventsPanel 纯静态 UI

功能缺失而非 bug，需要完整的状态管理、Rust 后端命令、UI 交互逻辑开发。

### ⏳ Bug #8：Sidebar 模板 ID 重复

`focus_tree_id = XXX_focus` 和 `id = XXX_focus_1` 使用相同前缀，仅模板质量问题。

### 🔍 其他技术债务

| 问题 | 描述 |
|------|------|
| 动态导入冲突 | `DebugPanel.tsx` 动态导入 `@tauri-apps/api/core`，同时 `plugin-dialog` 静态导入它 |
| 未使用的 `serialize_ast` | `parser.rs` 中 `serialize_ast` 将 `Empty` 序列化为 `""`，HOI4 中空值应为 `{}` |
| `serde_json::to_string_pretty` vs `to_string` | `parse_ideas_cmd` 输出格式不一致 |
| FocusTreeOutput 命名冲突 | Rust 发送 `{focuses: []}`，TS 有 `FocusTree` 和 `FocusTreeOutput` 两个相似类型 |
