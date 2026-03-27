#!/bin/bash
# sprack-hook-bridge: Claude Code hook command handler.
# Reads hook event JSON from stdin, extracts relevant fields,
# appends a structured event line to the per-session event file.
#
# Requires: jq
#
# Environment:
#   SPRACK_EVENT_DIR  Override event file directory
#                     (default: ~/.local/share/sprack/claude-events)

set -euo pipefail

# Resolve event directory: explicit env var > container mount > local default.
# Claude Code hooks do not inherit the container environment, so SPRACK_EVENT_DIR
# is typically unset inside hook subprocesses. Detect the container bind mount at
# /mnt/sprack/claude-events (created by the sprack devcontainer feature) to ensure
# events are written to the host-visible path.
if [ -n "${SPRACK_EVENT_DIR:-}" ]; then
  EVENT_DIR="$SPRACK_EVENT_DIR"
elif [ -d /mnt/sprack/claude-events ]; then
  EVENT_DIR="/mnt/sprack/claude-events"
else
  EVENT_DIR="$HOME/.local/share/sprack/claude-events"
fi

# Read stdin into a variable (hook input is a single JSON object).
INPUT=$(cat)

# Extract common fields.
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Bail if required fields are missing.
if [ -z "$SESSION_ID" ] || [ -z "$EVENT_NAME" ]; then
  exit 0
fi

# PostToolUse: filter to task-related tools only.
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
  case "$TOOL_NAME" in
    TaskCreate|TaskUpdate) ;;
    *) exit 0 ;;
  esac
fi

# Build the event-specific data payload.
case "$EVENT_NAME" in
  SessionStart)
    DATA=$(echo "$INPUT" | jq -c '{
      model: .model,
      transcript_path: .transcript_path
    }')
    ;;
  PostToolUse)
    DATA=$(echo "$INPUT" | jq -c '{
      tool_name: .tool_name,
      tool_input: .tool_input,
      tool_response: .tool_response
    }')
    ;;
  TaskCompleted)
    DATA=$(echo "$INPUT" | jq -c '{
      task_id: .task_id,
      task_subject: .task_subject,
      task_description: .task_description
    }')
    ;;
  SubagentStart|SubagentStop)
    DATA=$(echo "$INPUT" | jq -c '{
      agent_id: .agent_id,
      agent_type: .agent_type,
      last_assistant_message: .last_assistant_message
    }')
    ;;
  PostCompact)
    DATA=$(echo "$INPUT" | jq -c '{
      compact_summary: .compact_summary
    }')
    ;;
  SessionEnd)
    DATA=$(echo "$INPUT" | jq -c '{
      reason: .reason
    }')
    ;;
  *)
    exit 0
    ;;
esac

# Ensure the event directory exists.
mkdir -p "$EVENT_DIR"

# Build and append the event line.
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "$INPUT" | jq -c --arg ts "$TS" --arg event "$EVENT_NAME" \
  --arg sid "$SESSION_ID" --arg cwd "$CWD" --argjson data "$DATA" \
  '{ts: $ts, event: $event, session_id: $sid, cwd: $cwd, data: $data}' \
  >> "$EVENT_DIR/$SESSION_ID.jsonl"
