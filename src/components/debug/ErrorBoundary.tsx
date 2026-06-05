import { Component, type ErrorInfo, type ReactNode } from "react";
import { debugLogStore } from "./DebugPanel";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, info: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = `${error.message}\n\nComponent stack:\n${errorInfo.componentStack}`;
    debugLogStore.add("error", [
      `[ErrorBoundary] ${error.name}: ${error.message}`,
      errorInfo.componentStack ?? "",
    ]);
    this.setState((s) => ({ ...s, info: msg }));
    console.error("[ErrorBoundary caught]", error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null, info: "" });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: 32,
            background: "#0d0d1a",
            color: "#f5c6cb",
            gap: 16,
          }}
        >
          <div style={{ fontSize: 48 }}>💥</div>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#f55151" }}>
            组件崩溃
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#f5c6cb",
              background: "#1a0a0a",
              border: "1px solid #4a1010",
              borderRadius: 8,
              padding: "12px 20px",
              maxWidth: 600,
              maxHeight: 300,
              overflow: "auto",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ color: "#f55151", fontWeight: "bold", marginBottom: 8 }}>
              {this.state.error?.name}: {this.state.error?.message}
            </div>
            <div style={{ color: "#888", fontSize: 11 }}>
              {this.state.info.split("\n").slice(1).join("\n")}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#666" }}>
            错误已记录到调试面板（右下角 🐛）
          </div>
          <button
            onClick={this.reset}
            style={{
              padding: "8px 24px",
              borderRadius: 6,
              background: "#2a2a5a",
              border: "1px solid #6a6aff",
              color: "#b0b0ff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
