# HOI Mod Maker GUI

基于 Tauri + React 的 Hearts of Iron IV 国策树可视化编辑器。

## 功能

- 🌳 **可视化国策树编辑** — 拖拽节点、连线、实时预览
- 🧱 **积木式代码编辑器** — 无需手写代码，拖拽积木生成国策效果
- 📝 **代码编辑器** — Monaco Editor，支持语法高亮
- 🎨 **真实图标预览** — 内置 2800+ 原版国策图标
- 📁 **文件管理** — 侧边栏文件树，支持导入/导出
- 💾 **临时文件机制** — 编辑不直接修改源文件，显式保存才写回

## 技术栈

- **前端**: React + TypeScript + Vite + React Flow
- **后端**: Rust (Tauri)
- **编辑器**: Monaco Editor
- **图标**: 原版 HOI4 国策图标 (DDS → PNG)

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建
npm run build
npx tauri build
```

## 构建要求

- Node.js 18+
- Rust (MSVC)
- Windows 10/11

## 截图

![截图](screenshot.png)

## License

MIT
