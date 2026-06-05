# 积木编辑器重构 + Monaco 修复

## 目标
1. 修复 Monaco Editor CDN 加载错误
2. 积木编辑器从弹窗改为内嵌面板，给更大编辑空间

## 关键改动
- **CodePanel.tsx**: Monaco CDN 从 jsdelivr 切换到 unpkg
- **FocusTreePanel.tsx**: 右侧面板 320px → 480px
- **FocusPropertyPanel.tsx**: Tab 切换（属性/积木），BlockEditor 直接嵌入积木 tab
- **BlockEditor.tsx**: 62 个积木定义，顶层国策结构容器 + 槽位类型限制

## 状态
TS:0 通过，exe 打包成功
