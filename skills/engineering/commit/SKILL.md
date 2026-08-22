---
name: commit
description: Create a clean, well-scoped git commit for the current changes.
---

# Commit workflow

1. Run `git_status` and `git_diff` to see exactly what changed.
2. Group only related changes into the commit; leave unrelated files out.
3. Write the message as `<type>: <imperative summary>` where type is one of
   feat, fix, refactor, docs, test, chore. Keep the summary under 72 chars.
4. Stage the intended files explicitly (`git add <files>`, never `git add -A`
   unless everything is truly one change), then commit with `run_command`.
5. Show the result with `git_log` limit 1.

Never commit secrets, .env files, or generated artifacts. If tests exist,
run them before committing.
