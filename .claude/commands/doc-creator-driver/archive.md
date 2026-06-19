---
description: Archive a completed version — snapshot docs 01–05, stamp root docs, update CLAUDE.md and the full milestone registry, commit
arguments: version
---

Archive the docs for a completed version of ds-ide.

`$version` must be provided (e.g. `v2`). The version being archived is the one whose
milestones are **all released** in `docs/05_dev-plan.md`.

# Pre-flight checks (halt on any failure)

1. Read `docs/05_dev-plan.md` §0 Milestone Registry.
2. Locate the sub-section matching `$version` (e.g. `### v2 (…)`).
3. Verify every milestone row in that sub-section has status `**released**`.
   - If any milestone is not `**released**`: halt —
     "Cannot archive $version: milestone <name> is not yet released."
4. Scan every file in `docs/milestones/$version/*.md` for `- [ ]` items.
   - If any unchecked item exists: halt —
     "Cannot archive $version: open task in <file>."
5. AskUserQuestion: "All milestones for $version are released and all tasks are checked.
   Archive $version now? This will snapshot docs/01–05 into docs/$version/ and is not
   reversible without git."
   - If not confirmed: halt — "Archive cancelled."

# Archive steps

## Step 1 — Snapshot docs 01–05

Create the directory `docs/$version/` and copy these five files verbatim into it:
- `docs/01_input-ideas.md`      → `docs/$version/01_input-ideas.md`
- `docs/02_assumptions-and-risks.md` → `docs/$version/02_assumptions-and-risks.md`
- `docs/03_requirements.md`     → `docs/$version/03_requirements.md`
- `docs/04_architecture.md`     → `docs/$version/04_architecture.md`
- `docs/05_dev-plan.md`         → `docs/$version/05_dev-plan.md`

Do NOT copy `docs/00_north-star.md` (version-agnostic; persists in place).
Do NOT copy `docs/archived-doc-access-log.md` (running log; persists in place).

If `docs/raw/` contains any files that are not already under a versioned sub-directory
(e.g. `docs/raw/v1/`), move them to `docs/raw/$version/`. If there are none, skip.

## Step 2 — Stamp the root docs

Add a completion banner as the **first line** of each of docs/01–05 (before the `#` heading):

```
> **$version complete** — archived to `docs/$version/` on $date. This file now seeds $nextVersion planning.
```

where `$nextVersion` is the next logical version (increment the numeric suffix, e.g. v2 → v3).

## Step 3 — Update `docs/05_dev-plan.md` registry sub-heading

Find the `### $version (…)` sub-heading in §0 and append ` — archived in \`docs/$version/\``
to it, e.g.:

```
### v2 (0.2.0–0.2.9) — archived in `docs/v2/`
```

## Step 4 — Create the next-version milestone directory

Create `docs/milestones/$nextVersion/` with a `.gitkeep` placeholder so the directory
is tracked by git before any milestone files are added.

## Step 5 — Update `CLAUDE.md`

In `CLAUDE.md` (project root):

1. **Archived docs protocol line** — extend the list of read-only archive paths to include
   `docs/$version/`. For example, change:
   ```
   `docs/v1/` and `docs/raw/v1/` are read-only archives.
   ```
   to:
   ```
   `docs/v1/`, `docs/v2/` and `docs/raw/v1/` are read-only archives.
   ```
   (adapt to whatever versions already appear in the line)

2. **Document map table** — add a row for the new archive:
   ```
   | docs/$version/  | $version archived docs (01–05, read-only) | complete; do not edit |
   ```
   Insert it directly below the existing archive rows.

## Step 6 — Commit

Stage and commit all changes:

```
git add docs/$version/ docs/milestones/$nextVersion/.gitkeep docs/01_input-ideas.md \
        docs/02_assumptions-and-risks.md docs/03_requirements.md docs/04_architecture.md \
        docs/05_dev-plan.md CLAUDE.md
git commit -m "chore: archive $version docs — all milestones released"
```

If `docs/raw/$version/` was created, include it in the staged files.

# What this command does NOT do

- Does not rewrite root docs for the next version — that is a planning session's job.
- Does not create new milestone files for the next version.
- Does not touch source code, tests, or CHANGELOG.
- Does not push to remote (user's responsibility).
