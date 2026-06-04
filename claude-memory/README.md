# claude-memory — portable backup of Claude Code project memory

These are a **backup copy** of the Claude Code memory files for this project,
checked into git so they travel with every clone. They let a fresh Claude Code
session understand the project's history and status.

## ⚠️ Claude does NOT auto-load from here
Claude Code only auto-loads memory from its state directory, not from inside a
repo. To activate these on a new laptop, copy them once into the proper path:

```
From (this folder):  <repo>\claude-memory\
To (Claude state):   C:\Users\<YourUser>\.claude\projects\<project-folder>\memory\
```

`<project-folder>` is your working-directory path with `\` and `:` replaced by
dashes (e.g. `c--Users-You-shuddhiqacloud`). After copying, start `claude` from
the repo and it will load `MEMORY.md` automatically.

## Files
- `MEMORY.md` — the index (one line per memory); loaded into context each session
- `feedback_project_focus.md` — work preference
- `project_shuddhiqa_copilot_mcp_roadmap.md` — MCP/Copilot integration plan
- `project_shuddhiqa_launch_status.md` — launch-readiness snapshot

## Keeping this backup fresh
This is a point-in-time copy. When the live memory changes, re-copy the files
from the Claude state folder into here and commit, or they'll drift out of date.
