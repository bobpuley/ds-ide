---
description: Execute the in-progress milestone — branch, implement, test, merge, tag, and repeat until the milestone is complete
arguments: milestone
---

Implement the dev plan recursively

Read in order:
1. docs/03_requirements.md
2. docs/04_architecture.md
3. docs/05_dev-plan.md

Then find the active milestone:
- If `$milestone` was supplied, find the milestone matching that name or version in the Milestone Registry and read its file — regardless of its current status.
- Otherwise, from the Milestone Registry in `05_dev-plan.md`, find the single milestone with status **in progress** and follow its link to read the milestone file.
- If no milestone is **in progress** (and none was specified): halt — "No in-progress milestone found. Mark one as **in progress** in docs/05_dev-plan.md to begin, or pass a milestone name explicitly."
- If multiple milestones are **in progress** (and none was specified): halt — "Multiple in-progress milestones found. Exactly one must be **in progress** at a time, or pass a milestone name explicitly."

Generate executable code
Generate unit tests

Do not change requirements or architecture.

# Workflow

1. Analyze the documents
2. In the in-progress milestone file, check for the next pending implementations (`- [ ]` items)
3. If no pending implementations:
   - Update the Milestone Registry in `05_dev-plan.md`: change this milestone's status from **in progress** to **released**
   - Stop — "Milestone complete and marked released. Promote the next planned milestone to **in progress** when ready."
4. Otherwise:
   1. Pick the next implementation
   2. Create a git branch (name rules: between ~5 and ~30 chars, common naming best practices)
   3. Think about how to properly integrate it in the existing codebase
   4. Split it into atomic tasks (TaskCreate for each)
   5. For each task:
      * (TaskUpdate in_progress)
      * Use AskUserQuestion for any decision or clarification needed
      * Implement the test
      * Implement the code
      * Run the tests
      * Iterate implementation until tests pass
      * If `tests/human-driven/showcase.js` exists: update it to cover the new or changed feature (add a new section or amend an existing one). If the file does not exist yet, skip.
      * Update the sprint task in the in-progress milestone file (mark `- [x]`)
      * (TaskUpdate completed)
   6. Sprint completion gate (runs once, after ALL tasks pass):
      * AskUserQuestion: "Please run your manual / human-driven tests and report the results. All green?"
        - If issues found → stay on branch, fix them, go back to step 5 for the affected tasks
        - If all green → continue
      * Merge git branch into master (same commit message format as existing merges)
      * Run: `git tag --list --sort=v:refname` to inspect existing tags
        - No tags exist → propose `0.1.0`
        - Tags exist → increment the patch segment of the highest tag (e.g. `0.1.3` → `0.1.4`)
      * AskUserQuestion: "Proposed tag is <tag>. Confirm or provide an override."
      * Update/create CHANGELOG.md:
        - Prepend a new section header `## <tag> — <YYYY-MM-DD>` followed by bullet points summarising the sprint changes (derive from branch commits via `git log`)
        - `git add CHANGELOG.md && git commit -m "chore: update changelog for <tag>"`
      * Create annotated tag: `git tag -a <tag> -m "<tag>"`
      * Push commit and tag: `git push && git push --tags`
   7. Go to "1. Analyze the documents"

# Required skills
- /typescript-expert
- /graphify
