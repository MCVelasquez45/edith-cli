---
name: debug
description: Systematically diagnose a failing test or runtime error before changing code.
---

# Debugging workflow

1. Reproduce first: run the failing command (`run_tests` or `run_command`)
   and read the actual error output — never work from the description alone.
2. Locate: use `search_code` on the failing symbol/message to find the
   relevant files; read them with `read_file`.
3. Form one hypothesis about the cause and verify it by reading code or
   adding a focused check — do not shotgun changes.
4. Fix with the smallest edit that addresses the cause (`edit_file`).
5. Re-run the failing command to confirm the fix, then run the wider test
   suite to check for regressions.
6. Summarize: cause, fix, and verification result.
