---
name: granola-search
description: Search Granola meeting transcripts by folder tags, title, and content keywords. This skill should be used when the user wants to find or search through Granola meeting notes — whether by person, category, meeting title, or topic.
user-invocable: true
arguments: query
---

# Granola Search

## Overview

Search Granola meeting transcript files using a 3-step progressive filtering approach: folder tags, then title, then summary content. Each step narrows the result set. Skip any step where no filter was specified.

All meeting files are markdown with YAML frontmatter located in your Obsidian vault output folder (default `Granola/` inside your vault).

## Query Parsing

Parse the user's natural language query to identify which terms belong to each filter dimension:

| Dimension | What matches | Examples |
|-----------|-------------|----------|
| **Folder tag** | Person names, project names, categories | "Brady", "AECOM", "QA Drawings", "Data science" |
| **Title** | Meeting name references, descriptive phrases | "Madrid followup", "automation roadmap" |
| **Content** | Topics, keywords, technical terms | "Revit", "pilot purgatory", "ROI" |

When ambiguous, default to folder tag first, then content. A single query may span multiple dimensions. For example, "Brady meetings about automation" means folder: Brady, content: automation.

## Search Workflow

Use the Grep tool and Read tool for all search operations. Do not use bash grep or rg commands.

### Step 1 — Filter by Folder Tag

Run when the query contains a person name, project name, or known folder tag.

Use the Grep tool to find files containing the folder tag. Search for the tag as a literal string within the frontmatter `folders:` section:

- Use the Grep tool with the pattern set to the folder tag name, searching in `/Users/biancopeve/Documents/sonomirco/Granola`
- Use case-insensitive matching
- Collect the list of matching file paths

After collecting matches, read each file's frontmatter to confirm the match is inside the `folders:` block and not in `participants:` or body content. This avoids false positives.

Partial matching is intentional — "Brady" matches the folder "Chat with Brady".

When the query implies **multiple** folder tags, search for each tag separately and intersect the file lists to keep only files that match **all** tags.

### Step 2 — Filter by Title

Run when the query contains a meeting name or descriptive title phrase. Apply against the file list from Step 1, or all files if Step 1 was skipped.

Use the Grep tool to search for the title term with case-insensitive matching. Pattern: `title:` followed by the search term. Confirm matches by reading the frontmatter `title:` field.

If no title matches are found but content keywords exist, fall through to Step 3 using the file list from Step 1.

### Step 3 — Search Body Content

Run when the query contains topic keywords. Apply against the file list from previous steps, or all files if both were skipped.

Use the Grep tool with case-insensitive matching and context lines to find relevant excerpts. For broad topic searches, combine multiple keywords with the OR operator in the pattern.

### Skipping Steps

- If only content keywords are given, search all files directly at Step 3.
- If only a folder tag is given, run Step 1 only and list matching files.
- If folder + content but no title, run Step 1 then Step 3.

### Fallback Behavior

When a query has both title and content terms but Step 2 finds no title matches, do not stop. Instead, carry the Step 1 results forward and search their body content at Step 3 using both the title terms and content terms as keywords. This ensures the user still gets relevant results even if no meeting title matched exactly.

## Result Formatting

### File-Level Results — Steps 1 and 2

Present a numbered list sorted by date, newest first. For each file show:

```
1. **Title** — YYYY-MM-DD
   Folders: tag1, tag2 | Participants: name1, name2
   `filename.md`
```

### Content Results — Step 3

Group excerpts by file with a metadata header and blockquoted matches:

```
### Title — YYYY-MM-DD
Folders: tag1, tag2

> ...matched excerpt with 2 lines of context...

> ...another match...
```

### Summary Footer

Always end with a count and the filters applied:

```
Found N files matching folder: "X", content: "Y"
```

## Edge Cases

- **Zero matches at any step**: Report which step produced no results and suggest alternatives. For example: "No files matched folder 'Brady'. Did you mean 'Chat with Brady'? Known folders listed below."
- **Broad results with more than 15 files**: Summarize distribution by folder or date range, then ask the user to narrow the search.
- **Case variations**: Always use case-insensitive matching.

## Known Folder Tags

For reference, these are the current folder tags in the Granola collection:

- Aecom / AECOM
- Augment
- Chat with Brady
- Chat with David
- Data science
- Digital meeting
- EC
- Elevate
- Garrick mentoring
- General
- Interview in AEC
- QA Drawings

## Example Usage

**`/granola-search Brady meetings about automation`**
Step 1: filter to "Chat with Brady" folder. Step 3: search for "automation" in those files.

**`/granola-search search all meetings for Revit`**
Skip Steps 1 and 2, search all files for "Revit".

**`/granola-search AECOM QA Drawings`**
Step 1: intersect files matching both "AECOM" and "QA Drawings" folder tags.

**`/granola-search what Brady things should be the action to avoid people thinking we are developing AI tools`**
Step 1: filter to "Chat with Brady" folder. Step 2: search titles for "AI" or "Automation" — if no title matches, fall through. Step 3: search body content for "AI tools", "AI", "automation", "developing" across the Brady files.
