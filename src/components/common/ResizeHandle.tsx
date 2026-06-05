import { useCallback, useRef, useEffect } from "react";

interface ResizeHandleProps {
  /** 拖拽方向：left = 左侧边框（向左拖增大），right = 右侧边框（向右拖增大） */
  direction: "left" | "right";
  /** 当前宽度 */
  width: number;
  /** 宽度变化回调 */
  onResize: (newWidth: number) => void;
  /** 最小宽度 */
  min?: number;
  /** 最大宽度 */
  max?: number;
}

export function ResizeHandle({ direction, width, onResize, min = 150, max = 600 }: ResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      const newWidth =
        direction === "left"
          ? startWidth.current + dx   // 向右拖 → 增大
          : startWidth.current - dx;  // 向左拖 → 增大
      onResize(Math.max(min, Math.min(max, newWidth)));
    };

    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [direction, onResize, min, max]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: 5,
        cursor: "col-resize",
        background: "transparent",
        flexShrink: 0,
        position: "relative",
        zIndex: 100,
        transition: dragging.current ? "none" : "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,39,0.4)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    />
  );
}
