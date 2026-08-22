---
name: review
description: Review the current diff or a file for correctness, safety, and clarity.
---

# Review workflow

1. Get the change surface: `git_diff` (and `git_diff` staged) or read the
   requested files.
2. Check correctness first: logic errors, unhandled edge cases, broken
   contracts between caller and callee.
3. Check safety: secret exposure, path traversal, unvalidated input,
   destructive operations without guards.
4. Check clarity: dead code, misleading names, needless complexity.
5. Report findings ordered by severity with file:line references. State
   clearly when something is fine — do not invent issues.
