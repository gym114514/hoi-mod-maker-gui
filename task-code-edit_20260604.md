# 属性面板代码编辑

## 目标
属性 tab 提供手动代码编辑 textarea

## 改动
- completion_reward → textarea 直接编辑（去掉 BlockModeToggle 弹窗按钮）
- 新增 bypass / select_effect textarea
- 删除 BlockModeToggle + BlockEditorModal 组件
- 积木 tab 保留 BlockEditor 可视化编辑

## 状态
TS:0，exe 打包成功
