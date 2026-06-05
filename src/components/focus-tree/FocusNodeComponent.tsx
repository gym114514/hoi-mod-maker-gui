import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { FocusNode } from "@/data/types";

interface Props extends NodeProps<FocusNode> {}

// Fixed node dimensions - MUST match focusToNode in FocusTreeEditor.tsx
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 100;

import iconData from "@/data/icon_data.json";
const ALL_ICONS: Record<string, { file: string; category: string }> = iconData as any;

export const FocusNodeComponent = memo(function FocusNodeComponent({
  data,
  selected,
}: Props) {
  const iconEntry = ALL_ICONS[data.icon || ""];
  const iconFile = iconEntry?.file;
  
  // Calculate actual days (cost × 7)
  const days = data.cost * 7;

  return (
    <div
      className="focus-node"
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        padding: "8px 12px",
        background: selected ? "#2d3a4a" : "#242424",
        border: selected
          ? "2px solid #c9a227"
          : "1px solid #3d3d3d",
        borderRadius: 6,
        boxShadow: selected ? "0 0 12px rgba(201, 162, 39, 0.4)" : "0 2px 8px rgba(0,0,0,0.4)",
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      {/* Input handle for prerequisites (top center) */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{
          background: "#4a90d9",
          width: 8,
          height: 8,
          border: "none",
          left: "50%",
        }}
      />

      {/* Handle for mutual exclusive (left center) */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{
          background: "#d94a4a",
          width: 6,
          height: 6,
          border: "none",
          top: "50%",
        }}
      />

      {/* Handle for mutual exclusive (right center) */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{
          background: "#d94a4a",
          width: 6,
          height: 6,
          border: "none",
          top: "50%",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        {/* Icon */}
        <div
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: selected ? "#c9a227" : "#2d2d2d",
            borderRadius: 4,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {iconFile ? (
            <img src={`/icons/${iconFile}`} style={{ width: 44, height: 40, objectFit: "contain" }} />
          ) : (
            <span style={{ fontSize: 14, color: "#666" }}>🎯</span>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: selected ? "#c9a227" : "#e8e8e8",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={data.id}
          >
            {data.id}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#707070",
              display: "flex",
              gap: 6,
              marginTop: 2,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span>📅 {days}天</span>
            {data.prerequisite && data.prerequisite.length > 0 && (
              <span
                style={{
                  background: "#1a2a3a",
                  color: "#7ab8e8",
                  borderRadius: 3,
                  padding: "0 3px",
                  fontSize: 9,
                  fontWeight: 600,
                }}
                title={`${data.prerequisite.length}个前置组`}
              >
                📎{data.prerequisite.length}
              </span>
            )}
            {data.allowBranch && (
              <span
                style={{
                  background: "#2a1a0a",
                  color: "#e8a030",
                  borderRadius: 3,
                  padding: "0 3px",
                  fontSize: 9,
                  fontWeight: 600,
                }}
                title={`分支条件: ${data.allowBranch.slice(0, 60)}...`}
              >
                🌿分支
              </span>
            )}
            {data.bypass && (
              <span
                style={{
                  background: "#1a1a2a",
                  color: "#a0a0c0",
                  borderRadius: 3,
                  padding: "0 3px",
                  fontSize: 9,
                }}
                title={`可绕过: ${data.bypass.slice(0, 60)}`}
              >
                ⏭️绕过
              </span>
            )}
            {data.innerCircle && (
              <span style={{ color: "#c9a227", fontSize: 9 }}>⭕内圈</span>
            )}
            {data.continuous && (
              <span style={{ color: "#4a90d9", fontSize: 9 }}>🔄连续</span>
            )}
          </div>
        </div>
      </div>

      {/* Search filters badges */}
      {data.searchFilters && data.searchFilters.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginTop: 4,
            overflow: "hidden",
          }}
        >
          {data.searchFilters.slice(0, 2).map((filter) => (
            <span
              key={filter}
              style={{
                fontSize: 8,
                padding: "1px 4px",
                background: "#2d2d2d",
                color: "#707070",
                borderRadius: 2,
              }}
            >
              {filter.replace("FOCUS_FILTER_", "")}
            </span>
          ))}
          {data.searchFilters.length > 2 && (
            <span style={{ fontSize: 8, color: "#707070" }}>
              +{data.searchFilters.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Output handle for dependents (bottom center) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{
          background: "#4a90d9",
          width: 8,
          height: 8,
          border: "none",
          left: "50%",
        }}
      />
    </div>
  );
});

// CSS for focus-node class (also defined in global.css)
const styles = `
.focus-node:hover {
  border-color: #5a5a5a;
  box-shadow: 0 0 12px rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.4);
}
.react-flow__edge:hover .react-flow__edge-path {
  stroke-width: 3 !important;
  filter: drop-shadow(0 0 4px rgba(255,255,255,0.2));
}
.react-flow__handle:hover {
  transform: scale(1.4);
  box-shadow: 0 0 8px rgba(74,144,217,0.6);
}
`

// Inject styles
if (typeof document !== "undefined") {
  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
}
