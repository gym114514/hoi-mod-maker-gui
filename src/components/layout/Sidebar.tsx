import { useState, useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "@/stores";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { FileType, ModFile } from "@/data/types";

const FILE_TYPE_ICONS: Record<FileType, string> = {
  focus_tree: "🌲",
  ideas: "💡",
  events: "📜",
  characters: "👤",
  decisions: "📋",
  localisation: "🌐",
  descriptor: "⚙️",
  other: "📄",
};

// ---------- Context Menu ----------

interface ContextMenuState {
  x: number;
  y: number;
  type: "file" | "folder" | "empty";
  filePath?: string;
  dirPath?: string;
}

function ContextMenu({
  menu,
  onClose,
  onNewFile,
  onRename,
  onDelete,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewFile: (dir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: { label: string; icon: string; action: () => void; danger?: boolean }[] = [];

  if (menu.type === "file" && menu.filePath) {
    items.push(
      { label: "重命名", icon: "✏️", action: () => { onRename(menu.filePath!); onClose(); } },
      { label: "删除", icon: "🗑️", action: () => { onDelete(menu.filePath!); onClose(); }, danger: true },
    );
  } else if (menu.type === "folder" && menu.dirPath) {
    items.push(
      { label: "新建文件", icon: "📄", action: () => { onNewFile(menu.dirPath!); onClose(); } },
    );
  } else if (menu.type === "empty") {
    items.push(
      { label: "新建文件", icon: "📄", action: () => { onNewFile(menu.dirPath!); onClose(); } },
    );
  }

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 10000,
        background: "#252525",
        border: "1px solid #3d3d3d",
        borderRadius: 6,
        padding: 4,
        minWidth: 140,
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
      }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          onClick={item.action}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: item.danger ? "#e74c3c" : "#d0d0d0",
            cursor: "pointer",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ fontSize: 11 }}>{item.icon}</span>
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ---------- Inline Rename ----------

function InlineRename({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onConfirm(value);
        if (e.key === "Escape") onCancel();
      }}
      style={{
        width: "100%",
        fontSize: 11,
        padding: "1px 4px",
        background: "#1a1a1a",
        color: "#e0e0e0",
        border: "1px solid #c9a227",
        borderRadius: 3,
        outline: "none",
      }}
    />
  );
}

// ---------- New File Input ----------

function NewFileInput({
  dirPath,
  onCreated,
  onCancel,
}: {
  dirPath: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { createNewFile } = useProjectStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = async () => {
    const fileName = name.trim();
    if (!fileName) { onCancel(); return; }
    const finalName = fileName.endsWith(".txt") ? fileName : fileName + ".txt";
    try {
      await createNewFile(dirPath, finalName);
      onCreated();
    } catch (e) {
      alert("创建失败: " + e);
    }
  };

  return (
    <div style={{ padding: "2px 16px 2px 28px", display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10 }}>📄</span>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleConfirm}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleConfirm();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="文件名.txt"
        style={{
          flex: 1,
          fontSize: 11,
          padding: "2px 4px",
          background: "#1a1a1a",
          color: "#e0e0e0",
          border: "1px solid #c9a227",
          borderRadius: 3,
          outline: "none",
        }}
      />
    </div>
  );
}

// ---------- File Tree Node ----------

function FileNode({
  file,
  isActive,
  renamingPath,
  onSelect,
  onContextMenu,
  onRenameCancel,
}: {
  file: ModFile;
  isActive: boolean;
  renamingPath: string | null;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCancel: () => void;
}) {
  const { renameFile } = useProjectStore();
  const isRenaming = renamingPath === file.path;

  const handleRenameConfirm = async (newName: string) => {
    const trimmed = newName.trim();
    const currentName = file.name || file.path.split(/[\\/]/).pop() || "";
    if (trimmed && trimmed !== currentName) {
      try {
        await renameFile(file.path, trimmed);
      } catch (e) {
        alert("重命名失败: " + e);
      }
    }
    onRenameCancel();
  };

  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      style={{
        padding: "4px 16px 4px 28px",
        fontSize: 11,
        color: isActive ? "#c9a227" : "#b0b0b0",
        background: isActive ? "rgba(212,175,55,0.1)" : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderLeft: isActive ? "2px solid #c9a227" : "2px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 10, flexShrink: 0 }}>{FILE_TYPE_ICONS[file.type] || "📄"}</span>
      {isRenaming ? (
        <InlineRename
          name={file.name || file.path.split(/[\\/]/).pop() || ""}
          onConfirm={handleRenameConfirm}
          onCancel={onRenameCancel}
        />
      ) : (
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={file.path}
        >
          {file.name}
        </span>
      )}
    </div>
  );
}

// ---------- Main Sidebar ----------

export function Sidebar() {
  const { project, files, activeFile, openFile, loadError, deleteFile } = useProjectStore();
  const [showError, setShowError] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newFileDir, setNewFileDir] = useState<string | null>(null);

  useEffect(() => {
    if (loadError) setShowError(true);
  }, [loadError]);

  // Group files by directory structure
  const buildTree = useCallback(() => {
    if (!project) return { rootFiles: files, folders: {} };

    const root = project.path;
    const sep = root.includes("\\") ? "\\" : "/";
    const folders: Record<string, ModFile[]> = {};
    const rootFiles: ModFile[] = [];

    for (const file of files) {
      const rel = file.path.substring(root.length);
      const parts = rel.split(/[/\\]/).filter(Boolean);
      if (parts.length <= 1) {
        rootFiles.push(file);
      } else {
        const folder = parts.slice(0, -1).join(sep);
        const fullPath = root + sep + folder;
        if (!folders[fullPath]) folders[fullPath] = [];
        folders[fullPath].push(file);
      }
    }

    return { rootFiles, folders };
  }, [project, files]);

  const { rootFiles, folders } = buildTree();

  // Get project root dir
  const rootDir = project?.path || "";

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, type: ContextMenuState["type"], filePath?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const dir = filePath
      ? filePath.substring(0, filePath.lastIndexOf(/[/\\]/.exec(filePath)?.[0] || "/"))
      : rootDir;
    setContextMenu({ x: e.clientX, y: e.clientY, type, filePath, dirPath: dir });
  };

  const handleEmptyAreaContextMenu = (e: React.MouseEvent) => {
    if (!rootDir) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "empty", dirPath: rootDir });
  };

  // Open file
  const handleOpen = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "HOI4 Script Files", extensions: ["txt"] }],
        title: "打开 HOI4 文件",
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected[0];
      setShowError(false);
      await useProjectStore.getState().openFile(filePath);
    } catch (e: unknown) {
      alert("❌ 打开文件失败: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  // New file
  const handleNew = useCallback(async () => {
    try {
      const savePath = await save({
        defaultPath: "new_focus.txt",
        filters: [{ name: "HOI4 Script Files", extensions: ["txt"] }],
        title: "新建 HOI4 文件",
      });
      if (!savePath) return;
      const fileName = savePath.split(/[/\\]/).pop() || "new_focus";
      const isIdeas = fileName.toLowerCase().includes("idea");
      const template = isIdeas ? DEFAULT_IDEAS_TEMPLATE(fileName) : DEFAULT_FOCUS_TREE_TEMPLATE(fileName);
      await invoke("write_text_file", { path: savePath, content: template });
      setShowError(false);
      await useProjectStore.getState().openFile(savePath);
    } catch (e: unknown) {
      alert("❌ 新建文件失败: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  // Open project folder
  const handleOpenProjectFolder = useCallback(async () => {
    try {
      const folder = await open({ directory: true, title: "选择 HOI4 Mod 项目文件夹" });
      if (!folder) return;
      setShowError(false);
      await useProjectStore.getState().openProjectFolder(folder as string);
    } catch (e: unknown) {
      alert("❌ 打开项目失败: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  // Delete file
  const handleDelete = async (path: string) => {
    const name = path.split(/[/\\]/).pop() || path;
    if (!confirm(`确定删除 "${name}"？此操作不可撤销。`)) return;
    try {
      await deleteFile(path);
    } catch (e) {
      alert("删除失败: " + e);
    }
  };

  // Sort files alphabetically
  const sortFiles = (a: ModFile, b: ModFile) => (a.name || "").localeCompare(b.name || "");
  const sortedRoot = [...rootFiles].sort(sortFiles);
  const sortedFolders = Object.entries(folders)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, fls]) => [dir, [...fls].sort(sortFiles)] as [string, ModFile[]]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Project name */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border)",
          fontWeight: 600,
          fontSize: 13,
          color: "#c9a227",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        📁 {project?.name || "未打开项目"}
      </div>

      {/* File tree */}
      <div
        style={{ flex: 1, overflow: "auto", padding: "4px 0" }}
        onContextMenu={handleEmptyAreaContextMenu}
      >
        {/* Folders */}
        {sortedFolders.map(([dirPath, dirFiles]) => {
          const folderName = dirPath.split(/[/\\]/).pop() || dirPath;
          return (
            <div key={dirPath} style={{ marginBottom: 2 }}>
              {/* Folder header */}
              <div
                onContextMenu={(e) => handleContextMenu(e, "folder", undefined)}
                style={{
                  padding: "4px 16px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#808080",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 10 }}>📂</span>
                {folderName}
              </div>
              {/* Files in folder */}
              {dirFiles.map((file) => (
                <FileNode
                  key={file.path}
                  file={file}
                  isActive={activeFile?.path === file.path}
                  renamingPath={renamingPath}
                  onSelect={() => openFile(file.path)}
                  onContextMenu={(e) => handleContextMenu(e, "file", file.path)}
                  onRenameCancel={() => setRenamingPath(null)}
                />
              ))}
            </div>
          );
        })}

        {/* Root files */}
        {sortedRoot.map((file) => (
          <FileNode
            key={file.path}
            file={file}
            isActive={activeFile?.path === file.path}
            renamingPath={renamingPath}
            onSelect={() => openFile(file.path)}
            onContextMenu={(e) => handleContextMenu(e, "file", file.path)}
            onRenameCancel={() => setRenamingPath(null)}
          />
        ))}

        {/* New file input */}
        {newFileDir && (
          <NewFileInput
            dirPath={newFileDir}
            onCreated={() => setNewFileDir(null)}
            onCancel={() => setNewFileDir(null)}
          />
        )}

        {/* Empty state */}
        {files.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: "#606060",
              fontSize: 12,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>📂</div>
            <div>打开一个文件开始编辑</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>或新建一个国策树文件</div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {showError && loadError && (
        <div
          style={{
            margin: "0 8px 4px",
            padding: "6px 8px",
            background: "rgba(220,50,50,0.15)",
            border: "1px solid rgba(220,50,50,0.4)",
            borderRadius: 4,
            fontSize: 10,
            color: "#e55",
            cursor: "pointer",
          }}
          onClick={() => setShowError(false)}
        >
          ⚠️ 加载失败: {loadError}
        </div>
      )}

      {/* Quick actions */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          gap: 6,
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={handleOpen} style={actionBtnStyle} title="打开文件">
            📂 打开
          </button>
          <button onClick={handleNew} style={actionBtnStyle} title="新建文件">
            ➕ 新建
          </button>
        </div>
        {project && (
          <button
            onClick={handleOpenProjectFolder}
            style={{ ...actionBtnStyle, color: "#c9a227", borderColor: "rgba(212,175,55,0.3)" }}
            title="打开整个 Mod 项目文件夹"
          >
            📂 打开项目
          </button>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewFile={(dir) => { setNewFileDir(dir); setContextMenu(null); }}
          onRename={(path) => { setRenamingPath(path); setContextMenu(null); }}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ---------- Templates ----------

const DEFAULT_FOCUS_TREE_TEMPLATE = (name: string) => `# === 新建国策树 ===
# 文件: ${name}

focus_tree = {
    country = {
        tag = XXX
    }

    continuous_focus_position = { x = 2150 y = 500 }
    focus_tree_id = XXX_focus

    focus = {
        id = XXX_focus_1
        icon = GFX_goal_generic_propaganda
        x = 5
        y = 0
        cost = 5

        completion_reward = {
            log = "[GetDateText]: {long} @TODO 完成国策 XXX_focus_1"
        }
    }
}
`;

const DEFAULT_IDEAS_TEMPLATE = (name: string) => `# === 新建国家精神 ===
# 文件: ${name}

XXX = {
    name = "TODO: 填写精神名称"
    picture = generic_political_power
    allowed = { tag = XXX }
    modifier = { }
}
`;

// ---------- Style ----------

const actionBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  fontSize: 11,
  background: "var(--color-bg-tertiary)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  cursor: "pointer",
};
