---
name: feedback-project-focus
description: "When working on one project, do not surface pending items from unrelated other projects unless explicitly asked"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3cc79017-38b2-4636-a20c-f8440679f22a
---

When the user is focused on one project, do not bring up pending items, uncommitted changes, or unused remotes from other projects in summaries or "what's pending" answers.

**Why:** The user explicitly said "leave about UIAPI automation, concentrate on shuddhiqacloud" when I listed pending items spanning multiple projects (an uncommitted change in UIAPIAutomation and an unused `github` remote on UIAPIAutomation, while we were actively working on the separate `ShuddhiQA-v10.2` project). The cross-project noise was unwanted.

**How to apply:** Track the *active project* by which working directory/files we are editing. When answering "what's pending" or summarizing, restrict the list to that project. Other projects' state is fine to mention only if directly asked, or if it blocks the active project.
