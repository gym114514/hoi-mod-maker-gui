import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore, useEditorUIStore } from "@/stores";
import type { ValidationResult } from "@/data/types";



export function ValidationPanel() {
  const { toggleValidationPanel } = useEditorUIStore();
  const { project, activeFile } = useProjectStore();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasValidated, setHasValidated] = useState(false);

  // Auto-validate when panel opens with an active file
  useEffect(() => {
    if (!project || !activeFile) {
      setResult(null);
      setHasValidated(false);
      return;
    }
    if (!result && !isLoading && !hasValidated) {
      runValidation();
    }
  }, [project, activeFile?.path]);

  const runValidation = useCallback(async () => {
    if (!activeFile || isLoading) return;
    setIsLoading(true);
    setHasValidated(true);
    try {
      const res = await invoke<ValidationResult>("validate_file", {
        path: activeFile.path,
      });
      setResult(res);
    } catch (e) {
      setResult({
        valid: false,
        errors: [
          {
            line: 1,
            column: 1,
            message: `验证失败: ${String(e)}`,
            code: "VALIDATION_ERROR",
            severity: "error",
          },
        ],
        warnings: [],
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeFile, isLoading]);

  const allIssues = [
    ...(result?.errors || []),
    ...(result?.warnings || []),
  ];

  const errorCount = result?.errors.length ?? 0;
  const warnCount = result?.warnings.length ?? 0;

  return (
    <div
      style={{
        height: 200,
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-secondary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-tertiary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-primary)",
              fontWeight: 600,
            }}
          >
            {errorCount > 0 ? "❌" : warnCount > 0 ? "⚠️" : "✅"}{" "}
            验证结果
          </span>
          {result && (
            <span
              style={{ fontSize: 10, color: "#707070" }}
              title={activeFile?.path}
            >
              {errorCount > 0 ? (
                <span style={{ color: "#e74c3c" }}>{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
              ) : (
                <span>0 errors</span>
              )}
              {", "}
              {warnCount > 0 ? (
                <span style={{ color: "#f39c12" }}>{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>
              ) : (
                <span>0 warnings</span>
              )}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={runValidation}
            disabled={isLoading || !activeFile}
            title="重新验证"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: isLoading ? "#505050" : "var(--color-text-secondary)",
              fontSize: 10,
              cursor: isLoading ? "not-allowed" : "pointer",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {isLoading ? "↻ 验证中…" : "↻ 重新验证"}
          </button>
          <button
            onClick={toggleValidationPanel}
            style={{
              background: "transparent",
              border: "none",
              color: "#707070",
              fontSize: 16,
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* No file selected */}
      {!project && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#707070",
            fontSize: 12,
          }}
        >
          打开一个项目以开始验证
        </div>
      )}

      {/* No active file */}
      {project && !activeFile && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#707070",
            fontSize: 12,
          }}
        >
          在左侧选择一个文件以验证
        </div>
      )}

      {/* Loading */}
      {isLoading && project && activeFile && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#707070",
            fontSize: 12,
          }}
        >
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>
            ↻
          </span>{" "}
          正在验证…
        </div>
      )}

      {/* Results */}
      {!isLoading && allIssues.length === 0 && result && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#5a9",
            fontSize: 12,
          }}
        >
          ✅ 未发现问题 — {activeFile?.path.split(/[/\\]/).pop()}
        </div>
      )}

      {!isLoading && allIssues.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {allIssues.map((issue, i) => (
            <div
              key={i}
              onClick={() => useEditorUIStore.getState().jumpToLine(issue.line)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "5px 12px",
                fontSize: 11,
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                color:
                  issue.severity === "error"
                    ? "#e74c3c"
                    : issue.severity === "warning"
                    ? "#f39c12"
                    : "#707070",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              title={`点击跳转到第 ${issue.line} 行`}
            >
              <span style={{ flexShrink: 0 }}>
                {issue.severity === "error"
                  ? "❌"
                  : issue.severity === "warning"
                  ? "⚠️"
                  : "ℹ️"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#4a90d9",
                  flexShrink: 0,
                  minWidth: 36,
                }}
              >
                L{issue.line}
              </span>
              <span style={{ flex: 1 }}>{issue.message}</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#505050",
                  flexShrink: 0,
                }}
              >
                [{issue.code}]
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}