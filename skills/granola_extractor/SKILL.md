---
name: article-folder-set-up
description: Create a WIP article folder from a Granola meeting transcript. Searches for meetings by partial title in the Granola export folder, extracts the full transcript from Granola's cache, and creates a structured folder with cleaned and raw transcription files.
user-invocable: true
arguments: title-query (partial title to search for)
---

# Article Folder Set Up

## Overview

Creates a new article working folder from a Granola meeting transcript. This skill:
1. Searches for Granola meeting files by partial title match
2. Extracts the `granola_id` from the matched file's frontmatter
3. Fetches both enhanced notes and full transcript from Granola's cache
4. Creates a structured folder with separate files for cleaned and raw transcriptions

## Requirements

- Granola must be installed and have been run at least once
- Granola's cache file location is platform-specific (macOS default: `~/Library/Application Support/Granola/cache-v3.json`; Windows: update the path to match your Granola install location)
- Meeting files should exist in your Obsidian vault output folder (default `Granola/` inside your vault)
- Python 3.6 or higher

## Workflow

### Step 1: Search for Matching Files

Search for markdown files in your Obsidian vault output folder (default `Granola/` inside your vault) that match the user-provided title query.

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

### Step 3: Extract Transcripts from Granola Cache

Use the GranolaExtractor script (located at `skills/granola_extractor/scripts/granola_extractor.py`) to fetch the meeting data. If you're on Windows, update `CACHE_PATH` in the script to the Granola cache location for your install.

```bash
cd skills/granola_extractor && python3 -c "
from scripts.granola_extractor import GranolaExtractor
extractor = GranolaExtractor()

# Get enhanced notes (cleaned summary)
notes = extractor.get_enhanced_notes('{granola_id}')
print('---NOTES_START---')
print(notes if notes else 'No notes available')
print('---NOTES_END---')

# Get full transcript
transcript = extractor.get_transcript('{granola_id}', simplified=False)
print('---TRANSCRIPT_START---')
print(transcript if transcript else 'No transcript available')
print('---TRANSCRIPT_END---')
"
```

### Step 4: Create the Folder Structure

**Folder name convention:**
- Sanitize the meeting title to create a valid folder name
- Remove special characters, replace spaces with hyphens, lowercase
- Location: `<wip-articles-root>/{sanitized-title}` (set `<wip-articles-root>` to your preferred base directory)

**Sanitization example:**
```python
import re
sanitized = re.sub(r'[^\w\s-]', '', title).strip().lower()
sanitized = re.sub(r'[-\s]+', '-', sanitized)
folder_name = sanitized
```

### Step 5: Create the Files

Create two markdown files in the new folder:

**1. `cleaned-transcription.md`**
Contains the enhanced notes/summary from Granola. This is the AI-processed summary with key points, action items, and structured content.

Format:
```markdown
# {Meeting Title}

**Date:** {date}

---

{enhanced_notes_content}
```

**2. `raw-transcription.md`**
Contains the full verbatim transcript with speaker identification.

Format:
```markdown
# {Meeting Title} - Full Transcript

**Date:** {date}

---

{full_transcript_content}
```

### Step 6: Confirm Completion

After creating the folder and files, confirm to the user:
- Full path of the created folder
- List of files created
- Brief summary of content status (e.g., if any section was empty)

## Error Handling

**Granola File Not Found:**
If no matching files are found in the Granola folder:
```
No meetings found matching "{query}" in your Granola notes folder
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

**Empty Transcript/Notes:**
If either the transcript or notes are unavailable:
- Still create the files with a placeholder message
- Inform the user which content was missing

## Example Usage

**User**: `/article-folder-set-up Snug`

**Process**:
1. Search files in your vault output folder (default `Granola/` inside your vault)
2. Find match: `2025-09-03_Snug interview.md`
3. Extract `granola_id: 50dc18e1-fd84-459b-9a1d-a7c7d254b800`
4. Fetch enhanced notes and transcript from Granola cache
5. Create folder: `<wip-articles-root>/snug-interview`
6. Create files:
   - `cleaned-transcription.md` (with AI summary)
   - `raw-transcription.md` (with full transcript)
7. Confirm: "Created article folder at <wip-articles-root>/snug-interview with 2 files"
