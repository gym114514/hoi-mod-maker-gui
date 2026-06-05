import { useEffect, useRef, useState } from "react";
import { useProjectStore, useFocusTreeStore, useEditorUIStore } from "@/stores";

// ---------- Log Entry ----------

interface LogEntry {
  id: number;
  level: "log" | "warn" | "error" | "info" | "rust";
  args: string[];
  timestamp: Date;
}

// ---------- Global Log Store (singleton) ----------

const MAX_LOGS = 200;

class DebugLogStore {
  logs: LogEntry[] = [];
  listeners: Set<() => void> = new Set();
  nextId = 1;

  add(level: LogEntry["level"], args: string[]) {
    this.logs.push({
      id: this.nextId++,
      level,
      args,
      timestamp: new Date(),
    });
    if (this.logs.length > MAX_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_LOGS);
    }
    this.notify();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
  }

  unsubscribe(fn: () => void) {
    this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach((fn) => fn());
  }

  clear() {
    this.logs = [];
    this.notify();
  }
}

export const debugLogStore = new DebugLogStore();

// Override window.console to capture all logs
(function overrideConsole() {
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  function capture(level: "log" | "warn" | "error" | "info", args: unknown[]) {
    const strs = args.map((a) => {
      if (a === null) return "null";
      if (a === undefined) return "undefined";
      if (typeof a === "object") {
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      }
      return String(a);
    });
    debugLogStore.add(level, strs);
    orig[level](...args);
  }

  console.log = (...args: unknown[]) => capture("log", args);
  console.warn = (...args: unknown[]) => capture("warn", args);
  console.error = (...args: unknown[]) => capture("error", args);
  console.info = (...args: unknown[]) => capture("info", args);

  // Capture uncaught errors
  window.addEventListener("error", (e) => {
    debugLogStore.add("error", [`[UNCAUGHT] ${e.message} (${e.filename}:${e.lineno})`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    debugLogStore.add("error", [`[UNHANDLED] ${String(e.reason)}`]);
  });
})();

// ---------- Rust Command Wrapper ----------

let invokeCallId = 0;

export async function debugInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const callId = ++invokeCallId;
  const start = Date.now();
  debugLogStore.add("rust", [
    `[→] #${callId} ${cmd}${args ? " " + JSON.stringify(args) : ""}`,
  ]);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<T>(cmd, args);
    const ms = Date.now() - start;
    debugLogStore.add("rust", [`[✓] #${callId} ${cmd} (${ms}ms)`]);
    return res;
  } catch (err: unknown) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    debugLogStore.add("error", [`[✗] #${callId} ${cmd} (${ms}ms): ${msg}`]);
    throw err;
  }
}

// ---------- DebugPanel Component ----------

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"console" | "state" | "rpc">("console");
  const [logs, setLogs] = useState<LogEntry[]>(debugLogStore.logs);
  const [filter, setFilter] = useState<"all" | "log" | "warn" | "error" | "rust">("all");
  const [inspectKey, setInspectKey] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const fn = () => setLogs([...debugLogStore.logs]);
    debugLogStore.subscribe(fn);
    return () => debugLogStore.unsubscribe(fn);
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const filtered = logs.filter((l) => filter === "all" || l.level === filter);

  const levelColor: Record<string, string> = {
    log: "#aaa",
    warn: "#f5c542",
    error: "#f55151",
    info: "#4af0ff",
    rust: "#9b9bff",
  };
  const levelBg: Record<string, string> = {
    log: "transparent",
    warn: "rgba(245,197,66,0.05)",
    error: "rgba(245,81,81,0.08)",
    info: "rgba(74,240,255,0.05)",
    rust: "rgba(155,155,255,0.05)",
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="调试面板"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 10,
          background: "#1a1a2e",
          border: "1px solid #444",
          color: "#9b9bff",
          fontSize: 18,
          cursor: "pointer",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        }}
      >
        🐛
        {logs.filter((l) => l.level === "error").length > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#f55151",
              color: "#fff",
              fontSize: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
            }}
          >
            {logs.filter((l) => l.level === "error").length}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 72,
            right: 16,
            width: 640,
            height: 440,
            background: "#0d0d1a",
            border: "1px solid #333",
            borderRadius: 10,
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 28px rgba(0,0,0,0.7)",
            overflow: "hidden",
          }}
        >
          {/* Title bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 12px",
              background: "#14142a",
              borderBottom: "1px solid #333",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ color: "#9b9bff", fontSize: 13, fontWeight: "bold" }}>
              🐛 Debug Panel
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {(["console", "state", "rpc"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "2px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    background: tab === t ? "#2a2a5a" : "transparent",
                    border: "1px solid",
                    borderColor: tab === t ? "#6a6aff" : "#333",
                    color: tab === t ? "#b0b0ff" : "#666",
                    cursor: "pointer",
                  }}
                >
                  {t === "console" ? "Console" : t === "state" ? "Store" : "RPC"}
                </button>
              ))}
            </div>
            {tab === "console" && (
              <button
                onClick={() =>
                  setFilter(
                    filter === "all" ? "error" :
                    filter === "error" ? "warn" :
                    filter === "warn" ? "rust" : "all"
                  )
                }
                title="循环过滤级别"
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "transparent",
                  border: "1px solid #444",
                  color: "#888",
                  cursor: "pointer",
                }}
              >
                🔍 {filter === "all" ? "全部" : filter}
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                onClick={() => debugLogStore.clear()}
                title="清空日志"
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "transparent",
                  border: "1px solid #444",
                  color: "#666",
                  cursor: "pointer",
                }}
              >
                🗑 清空
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "transparent",
                  border: "1px solid #444",
                  color: "#666",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {tab === "console" && (
              <ConsoleTab
                filtered={filtered}
                bottomRef={bottomRef}
                levelColor={levelColor}
                levelBg={levelBg}
                onScroll={(el) =>
                  setAutoScroll(el.scrollTop + el.clientHeight >= el.scrollHeight - 20)
                }
              />
            )}
            {tab === "state" && (
              <StoreInspector
                inspectKey={inspectKey}
                onInspectKey={setInspectKey}
              />
            )}
            {tab === "rpc" && <RpcHistory />}
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Console Tab ----------

function ConsoleTab({
  filtered,
  bottomRef,
  levelColor,
  levelBg,
  onScroll,
}: {
  filtered: LogEntry[];
  bottomRef: React.RefObject<HTMLDivElement>;
  levelColor: Record<string, string>;
  levelBg: Record<string, string>;
  onScroll: (el: HTMLDivElement) => void;
}) {
  const [cmd, setCmd] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const executeCmd = () => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setCmdHistory(prev => [...prev, trimmed]);
    setHistoryIdx(-1);
    try {
      const result = (0, eval)(trimmed);
      if (result !== undefined) {
        debugLogStore.add("info", [">>> " + trimmed]);
        if (result instanceof Promise) {
          result.then(r => debugLogStore.add("info", ["[Promise] " + JSON.stringify(r, null, 2)])).catch(e => debugLogStore.add("error", ["[Promise Error] " + String(e)]));
        } else {
          debugLogStore.add("info", [typeof result === "object" ? JSON.stringify(result, null, 2) : String(result)]);
        }
      } else {
        debugLogStore.add("info", [">>> " + trimmed + " => undefined"]);
      }
    } catch (e) {
      debugLogStore.add("error", [">>> " + trimmed + " => Error: " + String(e)]);
    }
    setCmd("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{ flex: 1, overflowY: "scroll", fontFamily: "monospace", fontSize: 11, minHeight: 0 }}
        onScroll={(e) => onScroll(e.currentTarget)}
      >
        {filtered.length === 0 && (
          <div style={{ color: "#444", padding: "12px 16px", fontSize: 11 }}>
            无日志（打开/切换文件后会有记录）
          </div>
        )}
        {filtered.map((log) => (
          <div
            key={log.id}
            style={{
              padding: "2px 12px",
              borderLeft: `3px solid ${levelColor[log.level]}`,
              background: levelBg[log.level],
              color: levelColor[log.level],
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: "#444", fontSize: 10, marginRight: 8 }}>
              {log.timestamp.toLocaleTimeString("zh-CN", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
              .{String(log.timestamp.getMilliseconds()).padStart(3, "0")}
            </span>
            <span style={{ textTransform: "uppercase", fontSize: 9, marginRight: 6 }}>
              [{log.level}]
            </span>
            {log.args.map((arg, i) => (
              <span key={i}>{i > 0 ? " " : ""}{arg}</span>
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {/* Command input */}
      <div style={{ display: "flex", borderTop: "1px solid #333", background: "#0a0a1a", flexShrink: 0 }}>
        <span style={{ color: "#6a6aff", padding: "6px 8px", fontFamily: "monospace", fontSize: 12 }}>{">"}</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") executeCmd();
            if (e.key === "ArrowUp" && cmdHistory.length > 0) {
              const idx = historyIdx < 0 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
              setHistoryIdx(idx);
              setCmd(cmdHistory[idx]);
            }
            if (e.key === "ArrowDown") {
              const idx = historyIdx < 0 ? -1 : historyIdx + 1;
              setHistoryIdx(idx);
              setCmd(idx >= cmdHistory.length ? "" : cmdHistory[idx]);
            }
          }}
          placeholder="输入 JS 表达式，如 __treeDebug.listFocuses()"
          style={{
            flex: 1, background: "transparent", border: "none", color: "#ddd",
            fontFamily: "monospace", fontSize: 12, padding: "6px 4px", outline: "none",
          }}
        />
        <button onClick={executeCmd} style={{ padding: "4px 12px", background: "#2a2a5a", color: "#b0b0ff", border: "none", borderLeft: "1px solid #333", cursor: "pointer", fontSize: 11 }}>运行</button>
      </div>
    </div>
  );
}

// ---------- Store Inspector ----------

function StoreInspector({
  inspectKey,
  onInspectKey,
}: {
  inspectKey: string;
  onInspectKey: (k: string) => void;
}) {
  const [selected, setSelected] = useState<"project" | "focusTree" | "editorUI">("project");

  const getData = () => {
    switch (selected) {
      case "project": return useProjectStore.getState();
      case "focusTree": return useFocusTreeStore.getState();
      case "editorUI": return useEditorUIStore.getState();
    }
  };

  const data = getData();
  const entries = Object.entries(data).filter(([k]) => {
    if (!inspectKey) return true;
    return k.toLowerCase().includes(inspectKey.toLowerCase());
  });

  const labelMap = {
    project: "ProjectStore",
    focusTree: "FocusTreeStore",
    editorUI: "EditorUIStore",
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Selector row */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 8px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        {(Object.keys(labelMap) as Array<keyof typeof labelMap>).map((key) => (
          <button
            key={key}
            onClick={() => setSelected(key)}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 10,
              background: selected === key ? "#2a2a5a" : "transparent",
              border: "1px solid",
              borderColor: selected === key ? "#6a6aff" : "#333",
              color: selected === key ? "#b0b0ff" : "#666",
              cursor: "pointer",
            }}
          >
            {labelMap[key]}
          </button>
        ))}
        <input
          placeholder="过滤字段..."
          value={inspectKey}
          onChange={(e) => onInspectKey(e.target.value)}
          style={{
            marginLeft: 8,
            background: "#111",
            border: "1px solid #333",
            borderRadius: 4,
            color: "#aaa",
            fontSize: 10,
            padding: "1px 6px",
            width: 130,
          }}
        />
      </div>
      {/* Data list */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 12px" }}>
        <div style={{ color: "#444", marginBottom: 6, fontSize: 10 }}>
          {labelMap[selected]} · {entries.length} 个字段
        </div>
        {entries.map(([key, val]) => {
          const valStr =
            val === null ? "null" :
            val === undefined ? "undefined" :
            typeof val === "object" ? JSON.stringify(val, null, 2) :
            String(val);
          const preview = valStr.split("\n").slice(0, 3).join("\n");
          return (
            <div
              key={key}
              style={{
                padding: "2px 0",
                borderBottom: "1px solid #1a1a2e",
              }}
            >
              <span style={{ color: "#f5c542" }}>{key}</span>
              <span style={{ color: "#555" }}>: </span>
              <span
                style={{ color: "#aaa", whiteSpace: "pre-wrap", fontSize: 10 }}
                title={valStr}
              >
                {preview}
                {valStr.length > 120 ? " ..." : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- RPC History Tab ----------

function RpcHistory() {
  const [history, setHistory] = useState<
    Array<{
      id: number;
      cmd: string;
      args?: unknown;
      status: "pending" | "ok" | "err";
      ms?: number;
      error?: string;
    }>
  >([]);

  useEffect(() => {
    const fn = () => {
      const rpcLogs = debugLogStore.logs
        .filter((l) => l.level === "rust" || l.level === "error")
        .slice(-60);
      const events: typeof history[number][] = [];
      let cur: typeof history[number] | null = null;

      for (const log of rpcLogs) {
        const text = log.args.join(" ");
        if (text.startsWith("[→]")) {
          if (cur) events.push(cur);
          const match = text.match(/\[→\] #(\d+) (\S+)(.*)/);
          if (match) {
            cur = {
              id: Number(match[1]),
              cmd: match[2],
              args: match[3] ? tryJson(match[3]) : undefined,
              status: "pending",
            };
          }
        } else if (text.startsWith("[✓]")) {
          if (cur) {
            cur.status = "ok";
            const ms = text.match(/\((\d+)ms\)/);
            if (ms) cur.ms = Number(ms[1]);
            events.push(cur);
            cur = null;
          }
        } else if (text.startsWith("[✗]")) {
          if (cur) {
            cur.status = "err";
            const errMatch = text.match(/\[✗\] .*?: (.*)/);
            if (errMatch) cur.error = errMatch[1];
            events.push(cur);
            cur = null;
          }
        }
      }
      if (cur) events.push(cur);
      setHistory([...events.slice(-20).reverse()]);
    };
    debugLogStore.subscribe(fn);
    return () => debugLogStore.unsubscribe(fn);
  }, []);

  const statusColor = (s: string) =>
    s === "ok" ? "#4ade80" : s === "err" ? "#f55151" : "#f5c542";

  return (
    <div style={{ flex: 1, overflow: "auto", fontFamily: "monospace", fontSize: 11 }}>
      {history.length === 0 && (
        <div style={{ color: "#444", padding: "12px 16px", fontSize: 11 }}>
          无 RPC 调用记录（打开/保存文件后会显示）
        </div>
      )}
      {history.map((h) => (
        <div
          key={h.id}
          style={{
            padding: "4px 12px",
            borderBottom: "1px solid #1a1a2e",
            borderLeft: `3px solid ${statusColor(h.status)}`,
          }}
        >
          <div style={{ color: "#9b9bff" }}>
            #{h.id}{" "}
            <span style={{ color: "#f5c542" }}>{h.cmd}</span>
            {h.ms !== undefined && (
              <span style={{ color: "#555", marginLeft: 8 }}>{h.ms}ms</span>
            )}
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                color: statusColor(h.status),
                textTransform: "uppercase",
              }}
            >
              {h.status}
            </span>
          </div>
          {h.args !== undefined && (
            <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
              {String(JSON.stringify(h.args))}
            </div>
          )}
          {h.error && (
            <div style={{ color: "#f55151", fontSize: 10, marginTop: 2 }}>
              {h.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Helpers ----------

function tryJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s.trim());
  } catch {
    return undefined;
  }
}
