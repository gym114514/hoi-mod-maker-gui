/**
 * BrokenLineEdge — 直线连接（参考 C++ focustree.cpp 的 BrokenLine/SolidLine/DotLine/ExclusiveLine）
 *
 * 前置连线（SolidLine）：垂直→水平→垂直，转弯点由 yQuery 计算
 * 互斥连线（ExclusiveLine）：水平虚线
 */
import { type EdgeProps } from "reactflow";

/**
 * yQuery — 垂直障碍扫描（等价 C++ yQuery）
 * 从 y1 到 y2 扫描列 x，返回第一个空行位置。
 * 如果中间有障碍，返回障碍上方的空行；否则返回 y2。
 */
function yQuery(
  y1: number,
  y2: number,
  x: number,
  occupiedGrid: Set<string>,
): number {
  if (y1 > y2) [y1, y2] = [y2, y1];
  for (let row = y1 + 1; row < y2; row++) {
    if (!occupiedGrid.has(`${x},${row}`)) {
      return row;
    }
  }
  return y2;
}

export default function BrokenLineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  markerStart,
  data,
}: EdgeProps) {
  const occupiedGrid: Set<string> = data?.occupiedGrid ?? new Set();
  const sourceGridY: number = data?.sourceGridY ?? 0;
  const targetGridY: number = data?.targetGridY ?? 0;
  const sourceGridX: number = data?.sourceGridX ?? 0;
  const isExclusive: boolean = data?.isExclusive ?? false;

  const sx = sourceX;
  const sy = sourceY;
  const tx = targetX;
  const ty = targetY;

  let pathD: string;
  let strokeDasharray: string | undefined;

  if (isExclusive) {
    // 互斥连线：水平虚线（参考 ExclusiveLine）
    const midY = (sy + ty) / 2;
    pathD = `M ${sx} ${midY} L ${tx} ${midY}`;
    strokeDasharray = "6 4";
  } else if (Math.abs(sy - ty) < 5) {
    // 同行：直接水平线
    pathD = `M ${sx} ${sy} L ${tx} ${ty}`;
  } else if (sy < ty) {
    // 正常方向（上→下）：参考 SolidLine 的 BrokenLine 路由
    const turnRow = yQuery(sourceGridY, targetGridY, sourceGridX, occupiedGrid);
    const totalRows = Math.max(targetGridY - sourceGridY, 1);
    const turnOffset = turnRow - sourceGridY;
    const turnY = sy + (ty - sy) * (turnOffset / totalRows);

    // 三段折线：垂直向下 → 水平 → 垂直向下
    pathD = `M ${sx} ${sy} L ${sx} ${turnY} L ${tx} ${turnY} L ${tx} ${ty}`;
  } else {
    // 反向（下→下）：绕行
    const midY = (sy + ty) / 2;
    pathD = `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
  }

  // 互斥用红色，前置用蓝色
  const edgeColor = isExclusive ? "#d94a4a" : "#4a90d9";
  const finalStyle = {
    ...style,
    stroke: style?.stroke || edgeColor,
    strokeWidth: isExclusive ? 2 : style?.strokeWidth || 2,
    strokeDasharray,
  };

  return (
    <>
      {/* 隐形宽路径用于点击选中 */}
      <path
        id={`${id}-interaction`}
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ cursor: "pointer" }}
      />
      {/* 可见连线 */}
      <path
        id={id}
        d={pathD}
        fill="none"
        style={finalStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
    </>
  );
}
