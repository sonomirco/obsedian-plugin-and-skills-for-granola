---
name: granola-transcript
description: Extract and display the full verbatim transcript from a Granola meeting. Searches synced meeting files by partial title, then fetches the complete transcript from Granola's local cache.
user-invocable: true
arguments: title-query (partial title to search for)
---

# Granola Transcript

## Overview

Extracts the full verbatim transcript from Granola's local cache and prints it in the conversation. The Obsidian plugin syncs AI summaries but not the raw transcript — this skill fills that gap.

## Configuration

Set `VAULT_GRANOLA_PATH` to the absolute path of the folder where the Obsidian Granola Sync plugin writes meeting files. For example:

```
VAULT_GRANOLA_PATH = /Users/you/your-vault/Granola
```

## Requirements

- Granola must be installed and have been run at least once
- Granola's cache file location is platform-specific (macOS default: `~/Library/Application Support/Granola/cache-v3.json`; Windows: update the path to match your Granola install location)
- Meeting files should exist in `VAULT_GRANOLA_PATH`
- Python 3.6 or higher

## Workflow

### Step 1: Search for Matching Files

Search for markdown files in `VAULT_GRANOLA_PATH` that match the user-provided title query.

Read files and parse their YAML frontmatter to extract:
- `title` - the meeting title
- `granola_id` - the unique identifier for fetching transcript
- `date` - the meeting date

Match files where the title contains the query string (case-insensitive).

### Step 2: Handle Search Results

**If no files found:**
- Inform the user that no meetings were found with that title
- Suggest they check the title spelling or try a different partial title

**If exactly one file found:**
- Proceed to Step 3 with that file's `granola_id` and `title`

**If multiple files found:**
- Use `AskUserQuestion` to present the user with a list of matching meetings
- Format options to include: meeting title and date
- Example option label: "Snug interview - 2025-09-03"
- Proceed to Step 3 with the selected meeting's `granola_id` and `title`

### Step 3: Extract and Display Transcript

Use the GranolaExtractor script (located at `skills/granola-extractor/scripts/granola_extractor.py`) to fetch the full transcript. If you're on Windows, update `CACHE_PATH` in the script to the Granola cache location for your install.

```bash
cd skills/granola-extractor && python3 -c "
from scripts.granola_extractor import GranolaExtractor
extractor = GranolaExtractor()

transcript = extractor.get_transcript('{granola_id}', simplified=False)
print(transcript if transcript else 'No transcript available')
"
```

Print the transcript directly in the conversation.

## Error Handling

**Granola File Not Found:**
If no matching files are found in `VAULT_GRANOLA_PATH`:
```
No meetings found matching "{query}" in your Granola notes folder.
Please check the title spelling or try a different partial title.
```

**Missing granola_id:**
If a matched file doesn't have a `granola_id` in frontmatter:
```
The file "{filename}" doesn't have a granola_id. Cannot fetch full transcript.
```

**Cache File Not Found:**
If Granola's cache doesn't exist:
```
Granola cache file not found. Please ensure Granola is installed and has been run at least once.
```

**Empty Transcript:**
If the transcript is unavailable, inform the user that no transcript content was found for this meeting.

## Example Usage

**User**: `/granola-transcript Snug`

**Process**:
1. Search files in `VAULT_GRANOLA_PATH`
2. Find match: `2025-09-03_Snug interview.md`
3. Extract `granola_id: 50dc18e1-fd84-459b-9a1d-a7c7d254b800`
4. Fetch full transcript from Granola cache
5. Print the transcript in the conversation
