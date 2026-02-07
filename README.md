# Granola Automation Suite

This repository contains an Obsidian plugin and two Claude Code skills that work together to bridge **[Granola](https://granola.so)** meeting data with your personal knowledge management system.

## How It Works

The **Obsidian plugin** syncs Granola's AI summaries into your vault as markdown files with rich YAML frontmatter (`granola_id`, `folders`, `participants`, etc.). These synced files become the foundation for both skills:

- **Granola Search** queries the synced markdown files by folder tags, title, and content.
- **Granola Transcript** extracts the **full verbatim transcript** from Granola's local cache — content the plugin doesn't sync — and prints it in the conversation.

## Contents

1.  **[Obsidian Granola Sync Plugin](./main.ts)** — syncs AI summaries from Granola into your Obsidian vault.
2.  **[Granola Search Skill](./skills/granola-search)** (`/granola-search`) — searches the synced meeting files by folder tags, title, and body content. Requires `VAULT_GRANOLA_PATH` to be configured.
3.  **[Granola Transcript Skill](./skills/granola-extractor)** (`/granola-transcript`) — extracts the full transcript from Granola's cache (which the plugin doesn't sync) and prints it in the conversation. Requires `VAULT_GRANOLA_PATH` to be configured.

---

## 1. Obsidian Granola Sync Plugin

This plugin runs within Obsidian to pull your latest meeting summaries.

### Features
- **Auto-sync on startup**: Automatically checks for new meetings when you open Obsidian.
- **AI Summary Extraction**: Pulls the clean AI summary (not just the raw text).
- **Rich Metadata**: Populates YAML frontmatter with `granola_id`, deep links (`granola_url`), and participant lists.
- **Incremental Sync**: Only adds new meetings; avoids duplicates.

### Installation

#### Prerequisites
- [Node.js](https://nodejs.org/) installed
- [Obsidian](https://obsidian.md/) installed
- [Granola](https://granola.so) installed and run at least once (so the local cache exists)

#### Steps
1. Clone this repository:
   ```bash
   git clone https://github.com/sonomirco/obsedian-plugin-and-skills-for-granola.git
   cd obsedian-plugin-and-skills-for-granola
   ```
2. Install dependencies and build:
   ```bash
   npm install && npm run build
   ```
3. Create a folder named `granola-sync` inside your Obsidian vault's `.obsidian/plugins/` directory.
4. Copy `main.js` and `manifest.json` into that folder.
5. Open Obsidian, go to **Settings > Community Plugins**, and enable **Granola Sync**.

### Configuration
In Obsidian Settings > Granola Sync:
*   **Output folder**: Destination for meeting notes (Default: `Granola`).
*   **Days to sync**: How far back to look for meetings (Default: `365`).

Platform note: the plugin reads Granola's cache from the macOS default path `~/Library/Application Support/Granola/cache-v3.json`. On Windows, update `getGranolaCachePath()` in `main.ts` to match your Granola install location, then rebuild.

---

## Installing the Claude Code Skills

The two skills (`/granola-search` and `/granola-transcript`) are [Claude Code custom skills](https://docs.anthropic.com/en/docs/claude-code/skills). To install them:

1. Copy the `skills/` folder from this repo into your project or working directory.
2. Open each skill's `SKILL.md` and set `VAULT_GRANOLA_PATH` to the absolute path where the Obsidian plugin writes meeting files (e.g., `/Users/you/your-vault/Granola`).
3. The skills will be available as `/granola-search` and `/granola-transcript` in Claude Code.

The Granola Transcript skill also requires **Python 3.6+** for the extractor script.

---

## 2. Granola Search Skill

Located in `skills/granola-search`. A Claude Code skill invocable with `/granola-search`.

**Configuration:** Set `VAULT_GRANOLA_PATH` in the skill's `SKILL.md` to the absolute path where the Obsidian plugin writes meeting files.

This skill searches through the markdown files created by the Obsidian plugin. It uses a 3-step progressive filtering approach against the synced files' YAML frontmatter and body content:

1. **Folder tags** — filter by person names, projects, or categories (e.g., "Chat with Brady", "AECOM").
2. **Title** — narrow by meeting title keywords.
3. **Body content** — search for topics and keywords in the summary text.

Each step narrows the result set. Steps are skipped when no matching filter is given, and natural language queries like "meetings with Brady about automation" are parsed across all three dimensions.

---

## 3. Granola Transcript Skill

Located in `skills/granola-extractor`. A Claude Code skill invocable with `/granola-transcript`.

**Configuration:** Set `VAULT_GRANOLA_PATH` in the skill's `SKILL.md` to the absolute path where the Obsidian plugin writes meeting files.

The Obsidian plugin only syncs AI summaries — it does not include the full verbatim transcript. This skill extracts that missing content directly from Granola's local JSON cache (`cache-v3.json`) and displays it in the conversation.

### Workflow
1. **Search** — finds a meeting by partial title match in the synced markdown files at `VAULT_GRANOLA_PATH`.
2. **Extract** — reads the `granola_id` from the matched file's frontmatter, then uses the `GranolaExtractor` Python script to pull the full transcript from Granola's cache.
3. **Display** — prints the complete transcript with speaker labels in the conversation.

### Standalone Python Usage
The `GranolaExtractor` class can also be used directly:

```python
from scripts.granola_extractor import GranolaExtractor

extractor = GranolaExtractor()
transcript = extractor.get_transcript('your-granola-id')
```

