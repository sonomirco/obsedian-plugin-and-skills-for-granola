import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFolder,
	normalizePath,
	requestUrl,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// Types
// ============================================================================

interface GranolaSyncSettings {
	outputDir: string;
	syncOnLoad: boolean;
	syncDays: number;
	showNotifications: boolean;
}

interface SyncState {
	[meetingId: string]: {
		updated_at: string;
		filename: string;
	};
}

interface GranolaCache {
	documents: Record<string, GranolaMeeting>;
	documentPanels?: Record<string, Record<string, GranolaPanel>>; // v3 only — absent in v4+
	documentLists?: Record<string, string[]>; // folder_id -> meeting_ids
	documentListsMetadata?: Record<string, GranolaFolder>;
	workspaceData?: {
		workspaces: Array<{
			workspace: {
				workspace_id: string;
				display_name: string;
			};
		}>;
	};
}

interface GranolaFolder {
	id: string;
	title: string;
	description?: string;
	icon?: {
		type: string;
		color: string;
		value: string;
	};
	parent_document_list_id?: string;
}

interface GranolaMeeting {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	workspace_id: string;
	notes_markdown?: string; // v4: user notes in markdown
	notes_plain?: string;    // v4: user notes as plain text
	notes?: GranolaContent;  // v4: user notes as rich content
	overview?: string;
	summary?: string;
	people?: {
		creator?: { name?: string; email?: string };
		attendees?: Array<{ name?: string; email?: string }>;
	};
}

interface GranolaPanel {
	id: string;
	title: string;
	content: GranolaContent;
}

interface GranolaContent {
	type: string;
	content?: GranolaContent[];
	text?: string;
	attrs?: {
		level?: number;
		id?: string;
	};
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: GranolaSyncSettings = {
	outputDir: "Granola",
	syncOnLoad: true,
	syncDays: 365,
	showNotifications: true,
};

// ============================================================================
// Main Plugin
// ============================================================================

export default class GranolaSyncPlugin extends Plugin {
	settings: GranolaSyncSettings;
	syncState: SyncState = {};

	async onload() {
		await this.loadSettings();
		await this.loadSyncState();

		// Add ribbon icon
		this.addRibbonIcon("refresh-cw", "Sync Granola", async () => {
			await this.syncGranola();
		});

		// Add command
		this.addCommand({
			id: "sync-granola",
			name: "Sync Granola meetings",
			callback: async () => {
				await this.syncGranola();
			},
		});

		// Add settings tab
		this.addSettingTab(new GranolaSyncSettingTab(this.app, this));

		// Auto-sync on load if enabled
		if (this.settings.syncOnLoad) {
			// Small delay to ensure Obsidian is fully loaded
			setTimeout(async () => {
				await this.syncGranola();
			}, 2000);
		}
	}

	onunload() {
		// Cleanup if needed
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
		const rawSyncState = data?.syncState || {};

		// Migrate old format (string) to new format (object with updated_at and filename)
		this.syncState = {};
		for (const meetingId in rawSyncState) {
			const value = rawSyncState[meetingId];
			if (typeof value === "string") {
				// Old format: just updated_at string
				// We don't have the filename, so set it to empty - it will be updated on next sync
				this.syncState[meetingId] = {
					updated_at: value,
					filename: "",
				};
			} else if (value && typeof value === "object") {
				// New format
				this.syncState[meetingId] = value;
			}
		}
	}

	async saveSyncState() {
		const data = (await this.loadData()) || {};
		data.syncState = this.syncState;
		await this.saveData(data);
	}

	// ========================================================================
	// Granola Cache Reading
	// ========================================================================

	getGranolaCachePath(): string {
		const granolaDir = path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"Granola"
		);
		// Try newest cache version first for forward compatibility
		for (const version of ["cache-v4.json", "cache-v3.json"]) {
			const candidate = path.join(granolaDir, version);
			if (fs.existsSync(candidate)) return candidate;
		}
		return path.join(granolaDir, "cache-v4.json");
	}

	loadGranolaCache(): GranolaCache | null {
		const cachePath = this.getGranolaCachePath();

		if (!fs.existsSync(cachePath)) {
			if (this.settings.showNotifications) {
				new Notice(
					"Granola cache not found. Make sure Granola is installed."
				);
			}
			return null;
		}

		try {
			const rawContent = fs.readFileSync(cachePath, "utf-8");
			let data = JSON.parse(rawContent);

			// v3: cache is a serialised JSON string
			if (data.cache && typeof data.cache === "string") {
				const parsed = JSON.parse(data.cache);
				if (parsed.state) {
					data = parsed.state;
				}
			// v4: cache is a nested object with a state key
			} else if (data.cache && typeof data.cache === "object" && data.cache.state) {
				data = data.cache.state;
			}

			return data as GranolaCache;
		} catch (error) {
			console.error("Failed to parse Granola cache:", error);
			if (this.settings.showNotifications) {
				new Notice("Failed to read Granola cache file.");
			}
			return null;
		}
	}

	// ========================================================================
	// Content Extraction
	// ========================================================================

	extractTextFromContent(content: GranolaContent | GranolaContent[]): string {
		if (Array.isArray(content)) {
			return content
				.map((item) => this.extractTextFromContent(item))
				.filter((t) => t)
				.join("\n");
		}

		if (!content || typeof content !== "object") {
			return "";
		}

		const nodeType = content.type;

		if (nodeType === "text") {
			return content.text || "";
		}

		if (nodeType === "heading") {
			const level = content.attrs?.level || 1;
			const text = this.extractTextFromContent(content.content || []);
			return `\n${"#".repeat(level + 1)} ${text}\n`;
		}

		if (nodeType === "paragraph") {
			return this.extractTextFromContent(content.content || []);
		}

		if (nodeType === "bulletList") {
			const items = content.content || [];
			return items
				.map((item) => {
					const text = this.extractTextFromContent(item);
					return text ? `- ${text}` : "";
				})
				.filter((t) => t)
				.join("\n");
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

	extractAISummary(
		cache: GranolaCache,
		meetingId: string
	): string {
		// v3: AI summaries were stored in documentPanels (removed in v4)
		const panels = cache.documentPanels?.[meetingId];
		if (panels) {
			const summaries: string[] = [];
			for (const panelId in panels) {
				const panel = panels[panelId];
				if (panel?.content) {
					const text = this.extractTextFromContent(panel.content);
					if (text) summaries.push(text);
				}
			}
			if (summaries.length > 0) return summaries.join("\n\n");
		}

		// v4: AI panels moved to encrypted OPFS — fall back to user notes
		const doc = cache.documents?.[meetingId];
		if (doc) {
			if (doc.notes_markdown?.trim()) return doc.notes_markdown.trim();
			if (doc.notes_plain?.trim()) return doc.notes_plain.trim();
			if (doc.notes) {
				const text = this.extractTextFromContent(doc.notes);
				if (text?.trim()) return text.trim();
			}
			if (doc.overview?.trim()) return doc.overview.trim();
			if (doc.summary?.trim()) return doc.summary.trim();
		}

		// Placeholder so the meeting still syncs even without notes
		return "_No notes available — open Granola to generate an AI summary._";
	}

	// ========================================================================
	// Granola Cloud API
	// ========================================================================

	getGranolaAuthToken(): string | null {
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
			if (!workos.access_token || !workos.obtained_at || !workos.expires_in) return null;
			// Reject if token has less than 5 minutes remaining
			const ageMs = Date.now() - workos.obtained_at;
			const expiresMs = workos.expires_in * 1000;
			if (ageMs >= expiresMs - 5 * 60 * 1000) return null;
			return workos.access_token as string;
		} catch {
			return null;
		}
	}

	async fetchDocumentPanelsFromAPI(meetingId: string, token: string): Promise<string | null> {
		try {
			const resp = await requestUrl({
				url: "https://api.granola.ai/v1/get-document-panels",
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ document_id: meetingId }),
				throw: false,
			});
			if (resp.status !== 200) return null;
			const panels: Array<{ title: string; content: GranolaContent }> = resp.json;
			if (!Array.isArray(panels) || panels.length === 0) return null;
			const texts = panels
				.map((p) => this.extractTextFromContent(p.content))
				.filter((t) => t.trim());
			return texts.length > 0 ? texts.join("\n\n") : null;
		} catch {
			return null;
		}
	}

	// ========================================================================
	// Workspace Resolution
	// ========================================================================

	getWorkspaceName(cache: GranolaCache, workspaceId: string): string {
		const workspaces = cache.workspaceData?.workspaces || [];
		for (const ws of workspaces) {
			if (ws.workspace?.workspace_id === workspaceId) {
				return ws.workspace.display_name || "Unknown";
			}
		}
		return "Unknown";
	}

	// ========================================================================
	// Folder Resolution
	// ========================================================================

	buildMeetingToFoldersMap(cache: GranolaCache): Record<string, string[]> {
		const meetingToFolders: Record<string, string[]> = {};
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

	getFolderName(cache: GranolaCache, folderId: string): string | null {
		const metadata = cache.documentListsMetadata?.[folderId];
		return metadata?.title || null;
	}

	getMeetingFolders(
		cache: GranolaCache,
		meetingId: string,
		meetingToFoldersMap: Record<string, string[]>
	): string[] {
		const folderIds = meetingToFoldersMap[meetingId] || [];
		const folderNames: string[] = [];

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

	getParticipants(meeting: GranolaMeeting): string[] {
		const participants: string[] = [];
		const people = meeting.people;

		if (!people) return participants;

		if (people.creator?.name) {
			participants.push(people.creator.name);
		}

		if (people.attendees) {
			for (const attendee of people.attendees) {
				if (attendee?.name) {
					participants.push(attendee.name);
				}
			}
		}

		return participants;
	}

	// ========================================================================
	// File Generation
	// ========================================================================

	sanitizeFilename(title: string): string {
		// Remove or replace invalid characters
		let sanitized = title.replace(/[<>:"/\\|?*]/g, "");
		sanitized = sanitized.replace(/\s+/g, " ").trim();
		// Limit length
		return sanitized.substring(0, 100);
	}

	generateFrontmatter(
		meeting: GranolaMeeting,
		cache: GranolaCache,
		folders: string[]
	): string {
		const title = meeting.title || "Untitled Meeting";
		const createdAt = meeting.created_at || "";
		const workspaceId = meeting.workspace_id || "";
		const participants = this.getParticipants(meeting);

		// Parse date
		let dateStr = "";
		try {
			const dateObj = new Date(createdAt);
			dateStr = dateObj.toISOString().split("T")[0];
		} catch {
			dateStr = createdAt.substring(0, 10);
		}

		const lines: string[] = [
			"---",
			`title: "${title.replace(/"/g, '\\"')}"`,
			`date: ${dateStr}`,
			`granola_id: ${meeting.id}`,
			`granola_url: granola://open/${meeting.id}`,
			`workspace_id: ${workspaceId}`,
		];

		// Add folders if present (as array)
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

	generateFileContent(
		meeting: GranolaMeeting,
		summary: string,
		cache: GranolaCache,
		folders: string[]
	): string {
		const frontmatter = this.generateFrontmatter(meeting, cache, folders);
		const title = meeting.title || "Untitled Meeting";

		const content = [
			frontmatter,
			"",
			`# ${title}`,
			"",
			"## AI Summary",
			"",
			summary,
		];

		return content.join("\n");
	}

	// ========================================================================
	// Sync Logic
	// ========================================================================

	async ensureOutputDir(): Promise<TFolder | null> {
		const outputPath = normalizePath(this.settings.outputDir);

		let folder = this.app.vault.getAbstractFileByPath(outputPath);
		if (folder instanceof TFolder) {
			return folder;
		}

		// Create the folder
		try {
			await this.app.vault.createFolder(outputPath);
			folder = this.app.vault.getAbstractFileByPath(outputPath);
			if (folder instanceof TFolder) {
				return folder;
			}
		} catch (error) {
			console.error("Failed to create output folder:", error);
			if (this.settings.showNotifications) {
				new Notice(`Failed to create folder: ${outputPath}`);
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

		// Try to get an auth token for the cloud API (used to fetch AI summaries)
		const authToken = this.getGranolaAuthToken();

		// Build meeting-to-folders lookup (supports multiple folders per meeting)
		const meetingToFoldersMap = this.buildMeetingToFoldersMap(cache);

		const documents = cache.documents || {};
		let syncedCount = 0;
		let skippedCount = 0;
		let deletedCount = 0;

		// First, handle deletions - remove files for deleted meetings
		for (const meetingId in this.syncState) {
			const meeting = documents[meetingId];
			const syncInfo = this.syncState[meetingId];

			// If meeting is deleted or no longer exists, delete the file
			if (!meeting || meeting.deleted_at) {
				const filename = syncInfo?.filename;
				if (filename) {
					const filePath = normalizePath(
						`${this.settings.outputDir}/${filename}`
					);
					const existingFile =
						this.app.vault.getAbstractFileByPath(filePath);
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
				// Remove from sync state
				delete this.syncState[meetingId];
			}
		}

		// Then, sync new and updated meetings
		for (const meetingId in documents) {
			const meeting = documents[meetingId];

			// Skip deleted meetings
			if (meeting.deleted_at) {
				continue;
			}

			// Check date range
			try {
				const createdDate = new Date(meeting.created_at);
				if (createdDate < cutoffDate) {
					continue;
				}
			} catch {
				continue;
			}

			// Check if already synced with same updated_at
			const syncInfo = this.syncState[meetingId];
			if (syncInfo?.updated_at === meeting.updated_at) {
				skippedCount++;
				continue;
			}

			// Extract AI summary — try local cache first, then cloud API
			let summary = this.extractAISummary(cache, meetingId);
			if (summary.startsWith("_No notes available") && authToken) {
				const apiSummary = await this.fetchDocumentPanelsFromAPI(meetingId, authToken);
				if (apiSummary) summary = apiSummary;
			}

			// Get all folder names for this meeting
			const meetingFolders = this.getMeetingFolders(
				cache,
				meetingId,
				meetingToFoldersMap
			);

			// Generate file content
			const content = this.generateFileContent(
				meeting,
				summary,
				cache,
				meetingFolders
			);

			// Create filename
			const dateStr = meeting.created_at.substring(0, 10);
			const sanitizedTitle = this.sanitizeFilename(
				meeting.title || "Untitled"
			);
			const filename = `${dateStr}_${sanitizedTitle}.md`;
			const filePath = normalizePath(
				`${this.settings.outputDir}/${filename}`
			);

			// Write or update file
			try {
				const existingFile =
					this.app.vault.getAbstractFileByPath(filePath);
				if (existingFile) {
					await this.app.vault.modify(existingFile as any, content);
				} else {
					await this.app.vault.create(filePath, content);
				}

				// Update sync state with filename for deletion tracking
				this.syncState[meetingId] = {
					updated_at: meeting.updated_at,
					filename: filename,
				};
				syncedCount++;
			} catch (error) {
				console.error(`Failed to write file ${filePath}:`, error);
			}
		}

		// Save sync state
		await this.saveSyncState();

		// Show notification
		if (this.settings.showNotifications) {
			const parts: string[] = [];
			if (syncedCount > 0) {
				parts.push(`${syncedCount} synced`);
			}
			if (deletedCount > 0) {
				parts.push(`${deletedCount} deleted`);
			}
			if (parts.length > 0) {
				new Notice(`Granola: ${parts.join(", ")}`);
			} else {
				new Notice("Granola: No new meetings to sync");
			}
		}

		console.log(
			`Granola sync complete: ${syncedCount} synced, ${deletedCount} deleted, ${skippedCount} skipped`
		);
	}
}

// ============================================================================
// Settings Tab
// ============================================================================

class GranolaSyncSettingTab extends PluginSettingTab {
	plugin: GranolaSyncPlugin;

	constructor(app: App, plugin: GranolaSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Granola Sync Settings" });

		new Setting(containerEl)
			.setName("Output folder")
			.setDesc("Folder in your vault where Granola meetings will be saved")
			.addText((text) =>
				text
					.setPlaceholder("Granola")
					.setValue(this.plugin.settings.outputDir)
					.onChange(async (value) => {
						this.plugin.settings.outputDir = value || "Granola";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Automatically sync Granola meetings when Obsidian starts")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncOnLoad)
					.onChange(async (value) => {
						this.plugin.settings.syncOnLoad = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Days to sync")
			.setDesc("Only sync meetings from the last N days")
			.addSlider((slider) =>
				slider
					.setLimits(7, 365, 7)
					.setValue(this.plugin.settings.syncDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.syncDays = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show notifications")
			.setDesc("Show notifications when sync completes")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showNotifications)
					.onChange(async (value) => {
						this.plugin.settings.showNotifications = value;
						await this.plugin.saveSettings();
					})
			);

		// Manual sync button
		new Setting(containerEl)
			.setName("Manual sync")
			.setDesc("Sync Granola meetings now")
			.addButton((button) =>
				button.setButtonText("Sync now").onClick(async () => {
					await this.plugin.syncGranola();
				})
			);

		// Cache info
		const cachePath = this.plugin.getGranolaCachePath();
		const cacheExists = fs.existsSync(cachePath);

		containerEl.createEl("h3", { text: "Status" });

		const statusEl = containerEl.createEl("div", { cls: "setting-item" });
		statusEl.createEl("span", {
			text: cacheExists
				? "Granola cache found"
				: "Granola cache not found",
			cls: cacheExists ? "mod-success" : "mod-warning",
		});

		if (cacheExists) {
			const stats = fs.statSync(cachePath);
			const lastModified = new Date(stats.mtime).toLocaleString();
			statusEl.createEl("br");
			statusEl.createEl("small", {
				text: `Last modified: ${lastModified}`,
			});
		}
	}
}
