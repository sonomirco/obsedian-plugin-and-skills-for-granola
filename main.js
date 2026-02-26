var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GranolaSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var DEFAULT_SETTINGS = {
  outputDir: "Granola",
  syncOnLoad: true,
  syncDays: 365,
  showNotifications: true
};
var GranolaSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.syncState = {};
  }
  async onload() {
    await this.loadSettings();
    await this.loadSyncState();
    this.addRibbonIcon("refresh-cw", "Sync Granola", async () => {
      await this.syncGranola();
    });
    this.addCommand({
      id: "sync-granola",
      name: "Sync Granola meetings",
      callback: async () => {
        await this.syncGranola();
      }
    });
    this.addSettingTab(new GranolaSyncSettingTab(this.app, this));
    if (this.settings.syncOnLoad) {
      setTimeout(async () => {
        await this.syncGranola();
      }, 2e3);
    }
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async loadSyncState() {
    const data = await this.loadData();
    const rawSyncState = (data == null ? void 0 : data.syncState) || {};
    this.syncState = {};
    for (const meetingId in rawSyncState) {
      const value = rawSyncState[meetingId];
      if (typeof value === "string") {
        this.syncState[meetingId] = {
          updated_at: value,
          filename: ""
        };
      } else if (value && typeof value === "object") {
        this.syncState[meetingId] = value;
      }
    }
  }
  async saveSyncState() {
    const data = await this.loadData() || {};
    data.syncState = this.syncState;
    await this.saveData(data);
  }
  // ========================================================================
  // Granola Cache Reading
  // ========================================================================
  getGranolaCachePath() {
    const granolaDir = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Granola"
    );
    for (const version of ["cache-v4.json", "cache-v3.json"]) {
      const candidate = path.join(granolaDir, version);
      if (fs.existsSync(candidate))
        return candidate;
    }
    return path.join(granolaDir, "cache-v4.json");
  }
  loadGranolaCache() {
    const cachePath = this.getGranolaCachePath();
    if (!fs.existsSync(cachePath)) {
      if (this.settings.showNotifications) {
        new import_obsidian.Notice(
          "Granola cache not found. Make sure Granola is installed."
        );
      }
      return null;
    }
    try {
      const rawContent = fs.readFileSync(cachePath, "utf-8");
      let data = JSON.parse(rawContent);
      if (data.cache && typeof data.cache === "string") {
        const parsed = JSON.parse(data.cache);
        if (parsed.state) {
          data = parsed.state;
        }
      } else if (data.cache && typeof data.cache === "object" && data.cache.state) {
        data = data.cache.state;
      }
      return data;
    } catch (error) {
      console.error("Failed to parse Granola cache:", error);
      if (this.settings.showNotifications) {
        new import_obsidian.Notice("Failed to read Granola cache file.");
      }
      return null;
    }
  }
  // ========================================================================
  // Content Extraction
  // ========================================================================
  extractTextFromContent(content) {
    var _a;
    if (Array.isArray(content)) {
      return content.map((item) => this.extractTextFromContent(item)).filter((t) => t).join("\n");
    }
    if (!content || typeof content !== "object") {
      return "";
    }
    const nodeType = content.type;
    if (nodeType === "text") {
      return content.text || "";
    }
    if (nodeType === "heading") {
      const level = ((_a = content.attrs) == null ? void 0 : _a.level) || 1;
      const text = this.extractTextFromContent(content.content || []);
      return `
${"#".repeat(level + 1)} ${text}
`;
    }
    if (nodeType === "paragraph") {
      return this.extractTextFromContent(content.content || []);
    }
    if (nodeType === "bulletList") {
      const items = content.content || [];
      return items.map((item) => {
        const text = this.extractTextFromContent(item);
        return text ? `- ${text}` : "";
      }).filter((t) => t).join("\n");
    }
    if (nodeType === "listItem") {
      return this.extractTextFromContent(content.content || []);
    }
    if (nodeType === "doc") {
      return this.extractTextFromContent(content.content || []);
    }
    if (content.content) {
      return this.extractTextFromContent(content.content);
    }
    return "";
  }
  extractAISummary(cache, meetingId) {
    var _a, _b, _c, _d, _e, _f;
    const panels = (_a = cache.documentPanels) == null ? void 0 : _a[meetingId];
    if (panels) {
      const summaries = [];
      for (const panelId in panels) {
        const panel = panels[panelId];
        if (panel == null ? void 0 : panel.content) {
          const text = this.extractTextFromContent(panel.content);
          if (text)
            summaries.push(text);
        }
      }
      if (summaries.length > 0)
        return summaries.join("\n\n");
    }
    const doc = (_b = cache.documents) == null ? void 0 : _b[meetingId];
    if (doc) {
      if ((_c = doc.notes_markdown) == null ? void 0 : _c.trim())
        return doc.notes_markdown.trim();
      if ((_d = doc.notes_plain) == null ? void 0 : _d.trim())
        return doc.notes_plain.trim();
      if (doc.notes) {
        const text = this.extractTextFromContent(doc.notes);
        if (text == null ? void 0 : text.trim())
          return text.trim();
      }
      if ((_e = doc.overview) == null ? void 0 : _e.trim())
        return doc.overview.trim();
      if ((_f = doc.summary) == null ? void 0 : _f.trim())
        return doc.summary.trim();
    }
    return "_No notes available \u2014 open Granola to generate an AI summary._";
  }
  // ========================================================================
  // Granola Cloud API
  // ========================================================================
  getGranolaAuthToken() {
    const tokenPath = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Granola",
      "supabase.json"
    );
    try {
      const raw = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      const workos = JSON.parse(raw.workos_tokens || "{}");
      if (!workos.access_token || !workos.obtained_at || !workos.expires_in)
        return null;
      const ageMs = Date.now() - workos.obtained_at;
      const expiresMs = workos.expires_in * 1e3;
      if (ageMs >= expiresMs - 5 * 60 * 1e3)
        return null;
      return workos.access_token;
    } catch (e) {
      return null;
    }
  }
  async fetchDocumentPanelsFromAPI(meetingId, token) {
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url: "https://api.granola.ai/v1/get-document-panels",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ document_id: meetingId }),
        throw: false
      });
      if (resp.status !== 200)
        return null;
      const panels = resp.json;
      if (!Array.isArray(panels) || panels.length === 0)
        return null;
      const texts = panels.map((p) => this.extractTextFromContent(p.content)).filter((t) => t.trim());
      return texts.length > 0 ? texts.join("\n\n") : null;
    } catch (e) {
      return null;
    }
  }
  // ========================================================================
  // Workspace Resolution
  // ========================================================================
  getWorkspaceName(cache, workspaceId) {
    var _a, _b;
    const workspaces = ((_a = cache.workspaceData) == null ? void 0 : _a.workspaces) || [];
    for (const ws of workspaces) {
      if (((_b = ws.workspace) == null ? void 0 : _b.workspace_id) === workspaceId) {
        return ws.workspace.display_name || "Unknown";
      }
    }
    return "Unknown";
  }
  // ========================================================================
  // Folder Resolution
  // ========================================================================
  buildMeetingToFoldersMap(cache) {
    const meetingToFolders = {};
    const documentLists = cache.documentLists || {};
    for (const folderId in documentLists) {
      const meetingIds = documentLists[folderId];
      if (Array.isArray(meetingIds)) {
        for (const meetingId of meetingIds) {
          if (!meetingToFolders[meetingId]) {
            meetingToFolders[meetingId] = [];
          }
          meetingToFolders[meetingId].push(folderId);
        }
      }
    }
    return meetingToFolders;
  }
  getFolderName(cache, folderId) {
    var _a;
    const metadata = (_a = cache.documentListsMetadata) == null ? void 0 : _a[folderId];
    return (metadata == null ? void 0 : metadata.title) || null;
  }
  getMeetingFolders(cache, meetingId, meetingToFoldersMap) {
    const folderIds = meetingToFoldersMap[meetingId] || [];
    const folderNames = [];
    for (const folderId of folderIds) {
      const name = this.getFolderName(cache, folderId);
      if (name) {
        folderNames.push(name);
      }
    }
    return folderNames;
  }
  // ========================================================================
  // Participant Extraction
  // ========================================================================
  getParticipants(meeting) {
    var _a;
    const participants = [];
    const people = meeting.people;
    if (!people)
      return participants;
    if ((_a = people.creator) == null ? void 0 : _a.name) {
      participants.push(people.creator.name);
    }
    if (people.attendees) {
      for (const attendee of people.attendees) {
        if (attendee == null ? void 0 : attendee.name) {
          participants.push(attendee.name);
        }
      }
    }
    return participants;
  }
  // ========================================================================
  // File Generation
  // ========================================================================
  sanitizeFilename(title) {
    let sanitized = title.replace(/[<>:"/\\|?*]/g, "");
    sanitized = sanitized.replace(/\s+/g, " ").trim();
    return sanitized.substring(0, 100);
  }
  generateFrontmatter(meeting, cache, folders) {
    const title = meeting.title || "Untitled Meeting";
    const createdAt = meeting.created_at || "";
    const workspaceId = meeting.workspace_id || "";
    const participants = this.getParticipants(meeting);
    let dateStr = "";
    try {
      const dateObj = new Date(createdAt);
      dateStr = dateObj.toISOString().split("T")[0];
    } catch (e) {
      dateStr = createdAt.substring(0, 10);
    }
    const lines = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      `date: ${dateStr}`,
      `granola_id: ${meeting.id}`,
      `granola_url: granola://open/${meeting.id}`,
      `workspace_id: ${workspaceId}`
    ];
    if (folders.length > 0) {
      lines.push("folders:");
      for (const f of folders) {
        lines.push(`  - "${f.replace(/"/g, '\\"')}"`);
      }
    }
    if (participants.length > 0) {
      lines.push("participants:");
      for (const p of participants) {
        lines.push(`  - "${p.replace(/"/g, '\\"')}"`);
      }
    }
    lines.push("---");
    return lines.join("\n");
  }
  generateFileContent(meeting, summary, cache, folders) {
    const frontmatter = this.generateFrontmatter(meeting, cache, folders);
    const title = meeting.title || "Untitled Meeting";
    const content = [
      frontmatter,
      "",
      `# ${title}`,
      "",
      "## AI Summary",
      "",
      summary
    ];
    return content.join("\n");
  }
  // ========================================================================
  // Sync Logic
  // ========================================================================
  async ensureOutputDir() {
    const outputPath = (0, import_obsidian.normalizePath)(this.settings.outputDir);
    let folder = this.app.vault.getAbstractFileByPath(outputPath);
    if (folder instanceof import_obsidian.TFolder) {
      return folder;
    }
    try {
      await this.app.vault.createFolder(outputPath);
      folder = this.app.vault.getAbstractFileByPath(outputPath);
      if (folder instanceof import_obsidian.TFolder) {
        return folder;
      }
    } catch (error) {
      console.error("Failed to create output folder:", error);
      if (this.settings.showNotifications) {
        new import_obsidian.Notice(`Failed to create folder: ${outputPath}`);
      }
    }
    return null;
  }
  async syncGranola() {
    const cache = this.loadGranolaCache();
    if (!cache) {
      return;
    }
    const outputFolder = await this.ensureOutputDir();
    if (!outputFolder) {
      return;
    }
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.settings.syncDays);
    const authToken = this.getGranolaAuthToken();
    const meetingToFoldersMap = this.buildMeetingToFoldersMap(cache);
    const documents = cache.documents || {};
    let syncedCount = 0;
    let skippedCount = 0;
    let deletedCount = 0;
    for (const meetingId in this.syncState) {
      const meeting = documents[meetingId];
      const syncInfo = this.syncState[meetingId];
      if (!meeting || meeting.deleted_at) {
        const filename = syncInfo == null ? void 0 : syncInfo.filename;
        if (filename) {
          const filePath = (0, import_obsidian.normalizePath)(
            `${this.settings.outputDir}/${filename}`
          );
          const existingFile = this.app.vault.getAbstractFileByPath(filePath);
          if (existingFile) {
            try {
              await this.app.vault.delete(existingFile);
              deletedCount++;
              console.log(`Deleted: ${filename}`);
            } catch (error) {
              console.error(`Failed to delete ${filePath}:`, error);
            }
          }
        }
        delete this.syncState[meetingId];
      }
    }
    for (const meetingId in documents) {
      const meeting = documents[meetingId];
      if (meeting.deleted_at) {
        continue;
      }
      try {
        const createdDate = new Date(meeting.created_at);
        if (createdDate < cutoffDate) {
          continue;
        }
      } catch (e) {
        continue;
      }
      const syncInfo = this.syncState[meetingId];
      if ((syncInfo == null ? void 0 : syncInfo.updated_at) === meeting.updated_at) {
        skippedCount++;
        continue;
      }
      let summary = this.extractAISummary(cache, meetingId);
      if (summary.startsWith("_No notes available") && authToken) {
        const apiSummary = await this.fetchDocumentPanelsFromAPI(meetingId, authToken);
        if (apiSummary)
          summary = apiSummary;
      }
      const meetingFolders = this.getMeetingFolders(
        cache,
        meetingId,
        meetingToFoldersMap
      );
      const content = this.generateFileContent(
        meeting,
        summary,
        cache,
        meetingFolders
      );
      const dateStr = meeting.created_at.substring(0, 10);
      const sanitizedTitle = this.sanitizeFilename(
        meeting.title || "Untitled"
      );
      const filename = `${dateStr}_${sanitizedTitle}.md`;
      const filePath = (0, import_obsidian.normalizePath)(
        `${this.settings.outputDir}/${filename}`
      );
      try {
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile) {
          await this.app.vault.modify(existingFile, content);
        } else {
          await this.app.vault.create(filePath, content);
        }
        this.syncState[meetingId] = {
          updated_at: meeting.updated_at,
          filename
        };
        syncedCount++;
      } catch (error) {
        console.error(`Failed to write file ${filePath}:`, error);
      }
    }
    await this.saveSyncState();
    if (this.settings.showNotifications) {
      const parts = [];
      if (syncedCount > 0) {
        parts.push(`${syncedCount} synced`);
      }
      if (deletedCount > 0) {
        parts.push(`${deletedCount} deleted`);
      }
      if (parts.length > 0) {
        new import_obsidian.Notice(`Granola: ${parts.join(", ")}`);
      } else {
        new import_obsidian.Notice("Granola: No new meetings to sync");
      }
    }
    console.log(
      `Granola sync complete: ${syncedCount} synced, ${deletedCount} deleted, ${skippedCount} skipped`
    );
  }
};
var GranolaSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Granola Sync Settings" });
    new import_obsidian.Setting(containerEl).setName("Output folder").setDesc("Folder in your vault where Granola meetings will be saved").addText(
      (text) => text.setPlaceholder("Granola").setValue(this.plugin.settings.outputDir).onChange(async (value) => {
        this.plugin.settings.outputDir = value || "Granola";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sync on startup").setDesc("Automatically sync Granola meetings when Obsidian starts").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncOnLoad).onChange(async (value) => {
        this.plugin.settings.syncOnLoad = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Days to sync").setDesc("Only sync meetings from the last N days").addSlider(
      (slider) => slider.setLimits(7, 365, 7).setValue(this.plugin.settings.syncDays).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.syncDays = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show notifications").setDesc("Show notifications when sync completes").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showNotifications).onChange(async (value) => {
        this.plugin.settings.showNotifications = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Manual sync").setDesc("Sync Granola meetings now").addButton(
      (button) => button.setButtonText("Sync now").onClick(async () => {
        await this.plugin.syncGranola();
      })
    );
    const cachePath = this.plugin.getGranolaCachePath();
    const cacheExists = fs.existsSync(cachePath);
    containerEl.createEl("h3", { text: "Status" });
    const statusEl = containerEl.createEl("div", { cls: "setting-item" });
    statusEl.createEl("span", {
      text: cacheExists ? "Granola cache found" : "Granola cache not found",
      cls: cacheExists ? "mod-success" : "mod-warning"
    });
    if (cacheExists) {
      const stats = fs.statSync(cachePath);
      const lastModified = new Date(stats.mtime).toLocaleString();
      statusEl.createEl("br");
      statusEl.createEl("small", {
        text: `Last modified: ${lastModified}`
      });
    }
  }
};
