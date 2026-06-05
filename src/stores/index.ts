import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import type {
  FocusTree,
  FocusNode,
  ModProject,
  ModFile,
  EditorTab,
  EditorState,
  ValidationResult,
  FileType,
} from "@/data/types";

// ---------- Project Store ----------

interface ProjectState {
  project: ModProject | null;
  files: ModFile[];
  activeFile: ModFile | null;
  isDirty: boolean;
  isLoading: boolean;
  loadError: string | null;
  tempPath: string | null;

  openFile: (path: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  newProject: (name: string, path: string) => Promise<void>;
  setActiveFile: (file: ModFile | null) => Promise<void>;
  updateFileContent: (filePath: string, content: string) => void;
  addFile: (file: ModFile) => void;
  removeFile: (filePath: string) => void;
  renameFile: (oldPath: string, newName: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<void>;
  createNewFile: (dirPath: string, fileName: string, template?: string) => Promise<string>;
  markClean: () => void;
  openProjectFolder: (folderPath: string) => Promise<void>;
  setTempPath: (path: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  files: [],
  activeFile: null,
  isDirty: false,
  isLoading: false,
  loadError: null,
  tempPath: null,

  openFile: async (filePath: string) => {
    set({ isLoading: true, loadError: null });
    try {
      // Detect file type by content (reliable, not just filename)
      const fileType = await invoke<string>("detect_file_type", { path: filePath });
      const content = await invoke<string>("get_file_preview", { path: filePath });
      const fileName = filePath.split(/[\\/]/).pop() || "";

      // Create tmp copy for focus_tree files
      let tmpPath: string | null = null;
      if (fileType === "focus_tree") {
        try {
          const dir = await appDataDir();
          const tmpDir = dir + "tmp\\";
          try { await invoke("ensure_dir", { path: tmpDir }); } catch {}
          tmpPath = tmpDir + fileName;
          await invoke("write_text_file", { path: tmpPath, content });
        } catch (e) {
          console.error("Failed to create tmp copy:", e);
        }
      }

      const modFile: ModFile = {
        path: filePath,
        type: fileType as FileType,
        name: fileName,
        content,
      };

      set((state) => {
        const exists = state.files.some((f) => f.path === filePath);
        const base = exists
          ? { activeFile: modFile, files: state.files.map((f) => f.path === filePath ? modFile : f), isLoading: false }
          : { activeFile: modFile, files: [...state.files, modFile], isLoading: false };
        return tmpPath ? { ...base, tempPath: tmpPath } : base;
      });
    } catch (e) {
      set({ isLoading: false, loadError: String(e) });
      console.error("Failed to open file:", e);
    }
  },

  openProject: async (path: string) => {
    await get().openProjectFolder(path);
  },

  newProject: async (name: string, path: string) => {
    set({ isLoading: true, loadError: null });
    try {
      const fullPath = `${path}/${name.replace(/[\\/:*?"<>|]/g, "_")}`;
      // Call backend to create all directories
      const createdDirs: string[] = await invoke("create_project_dirs", {
        basePath: fullPath,
      });
      console.log("[ProjectStore] Created project at:", fullPath);
      console.log("[ProjectStore] Created items:", createdDirs);

      const project: ModProject = {
        path: fullPath,
        name,
        version: "1.0.0",
        supportedVersion: "1.14.*",
        tags: ["National Focus"],
        dependencies: [],
        files: [],
      };
      set({ project, files: [], activeFile: null, isDirty: false, isLoading: false });
    } catch (e) {
      set({ isLoading: false, loadError: String(e) });
      console.error("[ProjectStore] Failed to create project:", e);
      throw e;
    }
  },

  openProjectFolder: async (folderPath: string) => {
    set({ isLoading: true, loadError: null });
    try {
      // Recursively find all .txt files in the project
      const txtFiles: string[] = await invoke("read_dir_recursive", {
        dir: folderPath,
        extension: "txt",
      });
      console.log("[ProjectStore] Found files:", txtFiles.length);

      // Detect types for each file
      const detectedFiles: ModFile[] = [];
      for (const filePath of txtFiles) {
        try {
          const fileType = await invoke<string>("detect_file_type", { path: filePath });
          const fileName = filePath.split(/[/\\]/).pop() || "";
          detectedFiles.push({
            path: filePath,
            type: fileType as FileType,
            name: fileName,
          });
        } catch {
          const fileName = filePath.split(/[/\\]/).pop() || "";
          detectedFiles.push({ path: filePath, type: "other", name: fileName });
        }
      }

      const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
      const project: ModProject = {
        path: folderPath,
        name: folderName,
        version: "1.0.0",
        supportedVersion: "1.14.*",
        tags: [],
        dependencies: [],
        files: detectedFiles,
      };

      set({
        project,
        files: detectedFiles,
        activeFile: null,
        isDirty: false,
        isLoading: false,
      });
    } catch (e) {
      set({ isLoading: false, loadError: String(e) });
      console.error("[ProjectStore] Failed to open project folder:", e);
    }
  },

  setActiveFile: async (file) => {
    if (!file) {
      set({ activeFile: null });
      return;
    }
    // Just switch the active file. tmp is already created by openFile.
    // If content is missing, load it from source (for non-focus_tree files).
    if (!file.content) {
      try {
        const content = await invoke<string>("get_file_preview", { path: file.path });
        const updated = { ...file, content };
        set((state) => ({
          files: state.files.map((f) => (f.path === file.path ? updated : f)),
          activeFile: updated,
        }));
      } catch {
        set({ activeFile: file });
      }
    } else {
      set({ activeFile: file });
    }
  },

  updateFileContent: (filePath, content) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === filePath ? { ...f, content } : f
      ),
      activeFile:
        state.activeFile?.path === filePath
          ? { ...state.activeFile, content }
          : state.activeFile,
      isDirty: true,
    }));
  },

  addFile: (file) =>
    set((state) => ({ files: [...state.files, file], isDirty: true })),

  removeFile: (filePath) =>
    set((state) => ({
      files: state.files.filter((f) => f.path !== filePath),
      activeFile:
        state.activeFile?.path === filePath ? null : state.activeFile,
      isDirty: true,
    })),

  renameFile: async (oldPath, newName) => {
    const dir = oldPath.substring(0, oldPath.lastIndexOf(/[/\\]/.exec(oldPath)?.[0] || "/"));
    const sep = oldPath.includes("\\") ? "\\" : "/";
    const newPath = dir + sep + newName;
    await invoke("rename_file", { oldPath, newPath });
    set((state) => {
      const updatedFiles = state.files.map((f) =>
        f.path === oldPath ? { ...f, path: newPath, name: newName } : f
      );
      const updatedActive =
        state.activeFile?.path === oldPath
          ? { ...state.activeFile, path: newPath, name: newName }
          : state.activeFile;
      return { files: updatedFiles, activeFile: updatedActive };
    });
  },

  deleteFile: async (filePath) => {
    await invoke("delete_file", { path: filePath });
    set((state) => ({
      files: state.files.filter((f) => f.path !== filePath),
      activeFile:
        state.activeFile?.path === filePath ? null : state.activeFile,
    }));
  },

  createNewFile: async (dirPath, fileName, template) => {
    const sep = dirPath.includes("\\") ? "\\" : "/";
    const filePath = dirPath + sep + fileName;
    const content = template || "";
    await invoke("create_file", { path: filePath, content: content || null });
    await get().openFile(filePath);
    return filePath;
  },

  markClean: () => set({ isDirty: false }),
  setTempPath: (path: string | null) => set({ tempPath: path }),
}));

// ---------- Focus Tree Store ----------

interface FocusTreeState {
  focusTrees: FocusTree[];
  activeFocusTree: FocusTree | null;
  selectedFocusId: string | null;
  // Cache for treeData across mount/unmount cycles

  setFocusTrees: (trees: FocusTree[]) => void;
  setActiveFocusTree: (tree: FocusTree | null) => void;
  addFocus: (node: FocusNode) => void;
  updateFocus: (id: string, updates: Partial<FocusNode>) => void;
  removeFocus: (id: string) => void;
  selectFocus: (id: string | null) => void;
}

export const useFocusTreeStore = create<FocusTreeState>((set, get) => ({
  focusTrees: [],
  activeFocusTree: null,
  selectedFocusId: null,

  setFocusTrees: (trees) => set({ focusTrees: trees }),

  setActiveFocusTree: (tree) => set({ activeFocusTree: tree }),

  addFocus: (node) => {
    const { activeFocusTree } = get();
    if (!activeFocusTree) return;
    set({
      activeFocusTree: {
        ...activeFocusTree,
        focuses: [...activeFocusTree.focuses, node],
      },
    });
  },

  updateFocus: (id, updates) => {
    const { activeFocusTree } = get();
    if (!activeFocusTree) return;
    set({
      activeFocusTree: {
        ...activeFocusTree,
        focuses: activeFocusTree.focuses.map((f) =>
          f.id === id ? { ...f, ...updates } : f
        ),
      },
    });
  },

  removeFocus: (id) => {
    const { activeFocusTree } = get();
    if (!activeFocusTree) return;
    set({
      activeFocusTree: {
        ...activeFocusTree,
        focuses: activeFocusTree.focuses.filter((f) => f.id !== id),
      },
    });
  },

  selectFocus: (id) => set({ selectedFocusId: id }),

}));

// ---------- Editor UI Store ----------

interface EditorUIState extends EditorState {
  showValidationPanel: boolean;
  validationResult: ValidationResult | null;
  goToLine: { line: number; timestamp: number } | null;
  sidebarWidth: number;
  rightPanelWidth: number;

  setActiveTab: (tab: EditorTab) => void;
  setPanelWidth: (width: number) => void;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  toggleMinimap: () => void;
  toggleGrid: () => void;
  setValidationResult: (result: ValidationResult | null) => void;
  toggleValidationPanel: () => void;
  jumpToLine: (line: number) => void;
}

export const useEditorUIStore = create<EditorUIState>((set) => ({
  activeTab: "focus-tree",
  selectedFileId: null,
  selectedFocusId: null,
  panelWidth: 320,
  showMinimap: true,
  showGrid: true,
  showValidationPanel: false,
  validationResult: null,
  goToLine: null,
  sidebarWidth: 240,
  rightPanelWidth: 480,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setPanelWidth: (width) => set({ panelWidth: width }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  setValidationResult: (result) => set({ validationResult: result }),
  toggleValidationPanel: () =>
    set((s) => ({ showValidationPanel: !s.showValidationPanel })),
  jumpToLine: (line) => set({ goToLine: { line, timestamp: Date.now() }, activeTab: "code" }),
}));

// ---------- Settings Store ----------

interface SettingsState {
  hoi4Path: string;
  modOutputPath: string;
  theme: "dark" | "light";
  language: "english" | "simp_chinese";

  setHoi4Path: (path: string) => void;
  setModOutputPath: (path: string) => void;
  setTheme: (theme: "dark" | "light") => void;
  setLanguage: (lang: "english" | "simp_chinese") => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hoi4Path: "",
  modOutputPath: "",
  theme: "dark",
  language: "english",

  setHoi4Path: (path) => set({ hoi4Path: path }),
  setModOutputPath: (path) => set({ modOutputPath: path }),
  setTheme: (theme) => set({ theme }),
  setLanguage: (lang) => set({ language: lang }),
}));
