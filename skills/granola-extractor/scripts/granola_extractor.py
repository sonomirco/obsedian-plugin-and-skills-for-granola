#!/usr/bin/env python3
"""
Granola Meeting Extractor
Reads Granola's local cache file and extracts meeting transcripts and notes.
"""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any


class GranolaExtractor:
    """Extract meeting data from Granola's cache file."""

    CACHE_DIR = os.path.expanduser("~/Library/Application Support/Granola")

    @staticmethod
    def _find_cache_path() -> str:
        """Auto-detect the latest Granola cache file (v4, v3, etc.)."""
        import glob
        cache_dir = os.path.expanduser("~/Library/Application Support/Granola")
        candidates = sorted(
            [c for c in glob.glob(os.path.join(cache_dir, "cache-v*.json"))
             if not c.endswith(".tmp")],
            reverse=True
        )
        if not candidates:
            raise FileNotFoundError(
                f"No Granola cache file found in {cache_dir}. "
                "Make sure Granola is installed and has been run at least once."
            )
        return candidates[0]

    def __init__(self):
        """Initialize the extractor and load cache data."""
        self.cache_path = self._find_cache_path()
        self.cache_data = self._load_cache()

    def _load_cache(self) -> Dict[str, Any]:
        """Load and parse Granola's cache file (supports v3 and v4 structures)."""
        with open(self.cache_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        # v3: cache is a serialised JSON string
        if 'cache' in raw_data and isinstance(raw_data['cache'], str):
            actual_data = json.loads(raw_data['cache'])
            if 'state' in actual_data:
                return actual_data['state']
            return actual_data

        # v4: cache is a nested dict with a state key
        if 'cache' in raw_data and isinstance(raw_data['cache'], dict):
            state = raw_data['cache'].get('state', {})
            if state:
                return state

        return raw_data

    def search_meetings(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search for meetings by title.

        Args:
            query: Search term to match against meeting titles
            limit: Maximum number of results to return

        Returns:
            List of matching meetings with id, title, date, and participants
        """
        documents = self.cache_data.get('documents', {})
        results = []

        query_lower = query.lower()

        for meeting_id, meeting_data in documents.items():
            title = meeting_data.get('title', '')
            if query_lower in title.lower():
                # Extract participants
                people = meeting_data.get('people', [])
                participants = []
                for person in people:
                    if isinstance(person, dict):
                        name = person.get('name', '')
                        if name:
                            participants.append(name)
                    elif isinstance(person, str):
                        participants.append(person)

                # Extract date
                created_at = meeting_data.get('created_at', '')
                try:
                    date_obj = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    formatted_date = date_obj.strftime('%Y-%m-%d %H:%M')
                except:
                    formatted_date = created_at

                results.append({
                    'id': meeting_id,
                    'title': title,
                    'date': formatted_date,
                    'participants': participants
                })

        # Sort by date (most recent first)
        results.sort(key=lambda x: x['date'], reverse=True)

        return results[:limit]

    def get_transcript(self, meeting_id: str, simplified: bool = False) -> Optional[str]:
        """
        Get the full transcript for a meeting.

        Args:
            meeting_id: The meeting identifier
            simplified: If True, use "Me:" and "Them:" labels instead of actual names

        Returns:
            Formatted transcript with speaker identification, or None if not found
        """
        transcripts = self.cache_data.get('transcripts', {})

        if meeting_id not in transcripts:
            return None

        segments = transcripts[meeting_id]
        if not segments:
            return None

        # Identify unique speakers
        speakers = []
        for segment in segments:
            speaker = segment.get('source', 'Unknown')
            if speaker not in speakers:
                speakers.append(speaker)

        # Create speaker mapping for simplified mode
        speaker_map = {}
        if simplified and speakers:
            # Map "system" to "Me", all others to "Them"
            for speaker in speakers:
                if speaker.lower() == 'system':
                    speaker_map[speaker] = "Me"
                else:
                    speaker_map[speaker] = "Them"

        # Build formatted transcript
        transcript_lines = []
        current_speaker = None

        for segment in segments:
            speaker = segment.get('source', 'Unknown')
            text = segment.get('text', '').strip()

            if not text:
                continue

            # Determine display label
            if simplified:
                display_speaker = speaker_map.get(speaker, 'Unknown')
            else:
                display_speaker = speaker

            # Add speaker label when speaker changes
            if speaker != current_speaker:
                transcript_lines.append(f"{display_speaker}: {text}")
                current_speaker = speaker
            else:
                transcript_lines.append(text)

        return '\n'.join(transcript_lines)

    def _extract_text_from_notes(self, content: Any) -> str:
        """Recursively extract text from structured notes with markdown formatting."""
        if isinstance(content, str):
            return content

        if isinstance(content, dict):
            node_type = content.get('type')

            # Handle text nodes
            if node_type == 'text':
                return content.get('text', '')

            # Handle headings
            if node_type == 'heading':
                level = content.get('attrs', {}).get('level', 1)
                heading_text = self._extract_text_from_notes(content.get('content', []))
                return f"\n{'#' * level} {heading_text}\n"

            # Handle paragraphs
            if node_type == 'paragraph':
                para_text = self._extract_text_from_notes(content.get('content', []))
                return para_text

            # Handle bullet lists
            if node_type == 'bulletList':
                items = content.get('content', [])
                list_items = []
                for item in items:
                    item_text = self._extract_text_from_notes(item)
                    if item_text:
                        list_items.append(f"- {item_text}")
                return '\n'.join(list_items)

            # Handle list items
            if node_type == 'listItem':
                return self._extract_text_from_notes(content.get('content', []))

            # Handle doc node
            if node_type == 'doc':
                return self._extract_text_from_notes(content.get('content', []))

            # Recursively process content for other types
            if 'content' in content:
                return self._extract_text_from_notes(content['content'])

        if isinstance(content, list):
            texts = []
            for item in content:
                text = self._extract_text_from_notes(item)
                if text:
                    texts.append(text)
            return '\n'.join(texts)

        return ''

    def get_enhanced_notes(self, meeting_id: str) -> Optional[str]:
        """
        Get the enhanced notes/documents for a meeting.

        Args:
            meeting_id: The meeting identifier

        Returns:
            Enhanced notes content, or None if not found
        """
        documents = self.cache_data.get('documents', {})

        if meeting_id not in documents:
            return None

        meeting_data = documents[meeting_id]

        # Try to get notes in order of preference
        notes = None

        # 1. Try document panels first (contains enhanced transcription with formatting)
        if 'documentPanels' in self.cache_data:
            panels_dict = self.cache_data['documentPanels'].get(meeting_id, {})
            panel_texts = []
            # documentPanels is a dict with UUID keys, iterate over values
            for panel_id, panel in panels_dict.items():
                if isinstance(panel, dict) and 'content' in panel:
                    text = self._extract_text_from_notes(panel['content'])
                    if text:
                        panel_texts.append(text)
            if panel_texts:
                notes = '\n\n'.join(panel_texts)

        # 2. Try structured notes
        if not notes and 'notes' in meeting_data and meeting_data['notes']:
            notes = self._extract_text_from_notes(meeting_data['notes'])

        # 3. Try notes_markdown
        if not notes and 'notes_markdown' in meeting_data and meeting_data['notes_markdown']:
            notes = meeting_data['notes_markdown']

        # 4. Try notes_plain
        if not notes and 'notes_plain' in meeting_data and meeting_data['notes_plain']:
            notes = meeting_data['notes_plain']

        # 5. Fallback to overview or summary
        if not notes:
            overview = meeting_data.get('overview', '')
            summary = meeting_data.get('summary', '')
            notes = overview or summary

        return notes if notes else None

    def get_meeting_details(self, meeting_id: str) -> Optional[Dict[str, Any]]:
        """
        Get full details for a meeting including metadata.

        Args:
            meeting_id: The meeting identifier

        Returns:
            Dictionary with title, date, participants, or None if not found
        """
        documents = self.cache_data.get('documents', {})

        if meeting_id not in documents:
            return None

        meeting_data = documents[meeting_id]

        # Extract participants
        people = meeting_data.get('people', [])
        participants = []
        for person in people:
            if isinstance(person, dict):
                name = person.get('name', '')
                if name:
                    participants.append(name)
            elif isinstance(person, str):
                participants.append(person)

        # Extract date
        created_at = meeting_data.get('created_at', '')
        try:
            date_obj = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            formatted_date = date_obj.strftime('%Y-%m-%d')
        except:
            formatted_date = created_at

        return {
            'id': meeting_id,
            'title': meeting_data.get('title', 'Untitled Meeting'),
            'date': formatted_date,
            'participants': participants
        }

    def format_meeting_export(self, meeting_id: str) -> Optional[str]:
        """
        Generate a complete formatted export of a meeting with header, notes, and transcript.

        Args:
            meeting_id: The meeting identifier

        Returns:
            Formatted meeting export string, or None if meeting not found
        """
        # Get meeting details
        details = self.get_meeting_details(meeting_id)
        if not details:
            return None

        # Get raw meeting data for additional metadata
        documents = self.cache_data.get('documents', {})
        meeting_data = documents.get(meeting_id, {})

        # Get transcript segments to identify speakers
        transcripts = self.cache_data.get('transcripts', {})
        segments = transcripts.get(meeting_id, [])

        # Identify unique speakers
        speakers = []
        for segment in segments:
            speaker = segment.get('source', 'Unknown')
            if speaker and speaker not in speakers:
                speakers.append(speaker)

        # Build header
        title = details['title']

        # Format date as "Nov 24"
        try:
            date_obj = datetime.fromisoformat(details['date'])
            formatted_date = date_obj.strftime('%b %d')
            full_date = date_obj.strftime('%Y-%m-%d %H:%M')
        except:
            formatted_date = details['date']
            full_date = details['date']

        # Build metadata section - only three fields
        metadata_lines = [
            f"Meeting Title: {title}",
            f"Date: {formatted_date}",
        ]

        # Build participant mapping (combines participants and speaker mapping)
        participant_lines = []
        if speakers:
            # Map system to "me" and microphone/others to "them"
            system_speakers = [s for s in speakers if s.lower() == 'system']
            other_speakers = [s for s in speakers if s.lower() != 'system']

            if system_speakers:
                participant_lines.append(f"Meeting participants: {system_speakers[0]} = me")

            for speaker in other_speakers:
                if not participant_lines:
                    participant_lines.append(f"Meeting participants: {speaker} = them")
                else:
                    participant_lines.append(f"{' ' * 21}{speaker} = them")

        # Get enhanced notes (summaries and structured content)
        notes = self.get_enhanced_notes(meeting_id)

        # Get transcript with simplified labels
        transcript = self.get_transcript(meeting_id, simplified=True)

        # Build complete output
        output_parts = metadata_lines

        if participant_lines:
            output_parts.append("")  # blank line
            output_parts.extend(participant_lines)

        # Add notes section
        output_parts.append("\nNotes:\n")
        if notes:
            output_parts.append(notes)
        else:
            output_parts.append("No notes available")

        # Add transcript section
        output_parts.append("\n\nTranscript:\n")

        if transcript:
            output_parts.append(transcript)
        else:
            output_parts.append("No transcript available")

        return '\n'.join(output_parts)


if __name__ == '__main__':
    import sys

    # Simple CLI for testing
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python granola_extractor.py search <query>")
        print("  python granola_extractor.py transcript <meeting_id> [--simplified]")
        print("  python granola_extractor.py notes <meeting_id>")
        print("  python granola_extractor.py details <meeting_id>")
        print("  python granola_extractor.py format <meeting_id>")
        sys.exit(1)

    extractor = GranolaExtractor()
    command = sys.argv[1]

    if command == 'search' and len(sys.argv) > 2:
        query = ' '.join(sys.argv[2:])
        results = extractor.search_meetings(query)
        print(json.dumps(results, indent=2))

    elif command == 'transcript' and len(sys.argv) > 2:
        meeting_id = sys.argv[2]
        simplified = '--simplified' in sys.argv
        transcript = extractor.get_transcript(meeting_id, simplified=simplified)
        print(transcript if transcript else "Transcript not found")

    elif command == 'notes' and len(sys.argv) > 2:
        meeting_id = sys.argv[2]
        notes = extractor.get_enhanced_notes(meeting_id)
        print(notes if notes else "Notes not found")

    elif command == 'details' and len(sys.argv) > 2:
        meeting_id = sys.argv[2]
        details = extractor.get_meeting_details(meeting_id)
        print(json.dumps(details, indent=2) if details else "Meeting not found")

    elif command == 'format' and len(sys.argv) > 2:
        meeting_id = sys.argv[2]
        formatted = extractor.format_meeting_export(meeting_id)
        print(formatted if formatted else "Meeting not found")

    else:
        print("Invalid command")
        sys.exit(1)
