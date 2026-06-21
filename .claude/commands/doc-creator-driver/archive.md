---
description: Archive a completed version — snapshot docs 01–05 and 06_emulator_review.md (if present), stamp root docs, clean them up as next-version seeds, update ./.claude/memory/project-progress.md and the full milestone registry, commit
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
   Archive $version now? This will snapshot docs/01–05 (and 06_emulator_review.md if present)
   into docs/$version/ and is not reversible without git."
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

If `docs/06_emulator_review.md` exists, copy it verbatim into the archive:
- `docs/06_emulator_review.md` → `docs/$version/06_emulator_review.md`

If it does not exist, skip with a note: "docs/06_emulator_review.md not found — skipping."

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

## Step 3b — Clean up root docs as next-version seeds

The root docs now contain the just-archived version's full content **plus** the completion banner
added in Step 2. Rewrite each of docs/01–05 so it is a clean `$nextVersion` seed: the
completion banners are preserved as context, but the body is replaced with a minimal stub ready
for the next planning session.

For each file, the target structure after cleanup is:

### `docs/01_input-ideas.md`

```markdown
# 01 — Input Ideas ($nextVersion)

> **v1 complete** — ... archived in [`docs/v1/`](v1/01_input-ideas.md).
> (repeat one line per prior completed version, most recent last)
> **$version complete** — ... archived in [`docs/$version/`]($version/01_input-ideas.md).

*$nextVersion planning not yet started. Use `/doc-creator-driver:intake` or `/doc-creator-driver:start` to begin.*
```

### `docs/02_assumptions-and-risks.md`

```markdown
# 02 — Assumptions & Risks ($nextVersion)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **$version complete** — all $version bets held; risks resolved or managed.
> Archived: [`docs/$version/02_assumptions-and-risks.md`]($version/02_assumptions-and-risks.md).

*$nextVersion bets and risks to be defined during planning.*
```

### `docs/03_requirements.md`

```markdown
# 03 — Requirements ($nextVersion)

> **$version complete** — all $version requirements implemented; ACs green.
> Archived: [`docs/$version/03_requirements.md`]($version/03_requirements.md).

*$nextVersion requirements not yet defined.*
```

### `docs/04_architecture.md`

```markdown
# 04 — Architecture ($nextVersion)

> **$version complete** — full $version architecture in
> [`docs/$version/04_architecture.md`]($version/04_architecture.md).

*$nextVersion architecture not yet defined.*
```

### `docs/05_dev-plan.md`

```markdown
# 05 — Development Plan ($nextVersion)

> **v1 complete** — M0–MN archived in [`docs/v1/`](v1/).
> (repeat one line per prior completed version)
> **$version complete** — MN–MM archived in [`docs/$version/`]($version/).

*$nextVersion milestones not yet planned.*

---

## 0. Milestone Registry

### v1 (…) — archived in `docs/v1/`

(one-line summary, link to v1 archive)

(repeat for each prior version)

### $version (…) — archived in `docs/$version/`

(one-line summary, link to $version archive)

### $nextVersion — planned

*(no milestones yet)*
```

### `docs/06_emulator_review.md`

If the file was archived in Step 1, reset the root copy to a stub:

```markdown
# 06 — Emulator Code Review ($nextVersion)

> **$version review archived** — [`docs/$version/06_emulator_review.md`]($version/06_emulator_review.md).

*$nextVersion review not yet generated. Run `/doc-creator-driver:cpp-emulator-review` to produce it.*
```

If the file was not present (skipped in Step 1), leave `docs/06_emulator_review.md` unchanged.

### Rules for the cleanup

- The `#` heading of each doc must be updated from `$version` to `$nextVersion`.
- All prior completion banners (accumulated from previous archive runs) must be **preserved** — do
  not remove them. Only the body (non-banner content) is replaced with the stub.
- Write each doc via the Write tool (full rewrite), not piecemeal edits.
- Do not invent next-version content — stubs only. Planning sessions fill in the real content.
- After cleanup, the document map in `CLAUDE.md` does not need updating — the Purpose/Status cells for docs/01–05 are version-agnostic stubs. No edits to `CLAUDE.md` are required during archive.

## Step 4 — Create the next-version milestone directory

Create `docs/milestones/$nextVersion/` with a `.gitkeep` placeholder so the directory
is tracked by git before any milestone files are added.

## Step 5 — Update `./.claude/memory/project-progress.md`

Append a shipped-version summary line to `./.claude/memory/project-progress.md`, directly before the `**$nextVersion planning**` line. Compose it from the Milestone Registry in `docs/05_dev-plan.md` and the milestone files:

```
**$version shipped** ($semverRange, $milestoneRange, all ACs green): <comma-separated feature summary>. Archived docs: `docs/$version/`.
```

Do not touch `CLAUDE.md` — it uses a generic `docs/v[n]/` pattern and needs no update.

## Step 6 — Commit

Stage and commit all changes (archive snapshot + cleaned-up root docs + ./.claude/memory/project-progress.md + milestone dir):

```
git add docs/$version/ docs/milestones/$nextVersion/.gitkeep docs/01_input-ideas.md \
        docs/02_assumptions-and-risks.md docs/03_requirements.md docs/04_architecture.md \
        docs/05_dev-plan.md .claude/memory/project-progress.md
git commit -m "chore: archive $version docs — all milestones released"
```

If `docs/raw/$version/` was created, include it in the staged files.
If `docs/06_emulator_review.md` was archived and reset, include it in the staged files.

# What this command does NOT do

- Does not create new milestone files for the next version (planning sessions do that via `/intake`).
- Does not touch source code, tests, or CHANGELOG.
- Does not push to remote (user's responsibility).
