# Task

Goal: Add a third game to Lamplight, next to Texas Hold'em and backgammon: a clone of the popular mobile game Match Masters (1v1 turn-based match-3). Research the original online first so every detail is captured. The clone must play well in both mobile and desktop browsers and look stunning, with very polished graphics, visual effects and synthesized sounds, pushed to the highest level. Players can play against a bot or against other people who enter the Lamplight lobby.
Done when: `docs/match-masters-research.md` exists, cites its sources and covers the original's rules in detail: turn structure and moves per turn, extra moves, scoring, special pieces and their combos, boosters and how they charge, perks, match length, win condition and modes. Each rule is marked as implemented or deliberately left out. `bun test` passes, including new tests for the match-3 rules (swaps, matches, cascades, specials and combos, scoring, turn order, game end, reshuffle when no move exists) and a network test where scripted players finish a game against each other and against the bot. `bun run build` succeeds. In Chrome, the lobby's Play tab offers the new game, and a full game against the bot plays to the end at desktop size (1280×800, mouse) and at phone size (390×844, touch/swipe) with no console errors. A normal window and a private window find each other in the lobby (or through **Link**) and play a full game together. Hold'em and backgammon still open from the lobby and their tests still pass.
Scope: New files for the game, laid out like backgammon (e.g. `shared/match3.js`, `server/m3table.js`, `server/m3bot.js`, `client/m3*.jsx|js|css`, `test/match3*.test.js`), plus `docs/match-masters-research.md` (new). Integration edits in `client/app.js`, `client/lobby.jsx`, `client/main.jsx`, `client/index.html`, `client/screens.jsx`, `client/screens.css`, `server/index.js`, `server/db.js`, `shared/achievements.js` and `README.md`. Everything else is read-only, including the Hold'em and backgammon game code and `package.json`.
Limit: 8 hours or 60 iterations
Subagents: 5
Branch: new, `feat/match-masters`
PR: yes
Unattended: yes
Context: Do the research before writing any game code, using web search (official site, wikis, guides, gameplay videos and reviews), and build from what you find. Integrate the game the way backgammon was added in commit 8cdc29e: a shared rules module both sides use, a server-authoritative table and bot, a React room, a lobby switch, invite by **Link**, and engine plus network tests. For phone layout, follow commits f0b3ff8, 822d439 and 8b3c1e3. The server owns the board and every random refill, and browsers only animate what it sends (as README says). Generate all sounds with Web Audio and draw all art in code. Use an original look, with no assets, logo or characters copied from Match Masters.

If a missing detail would change the result, ask me one focused question (when unattended: pick the safest sensible default and record it under Decisions instead). For anything else, choose a sensible default, say what it is, and start.

## How to work

1. **Orient.** If `PROGRESS.md` exists, read it, confirm it still matches the code, and resume from its next step. Read only what the next decision needs.
2. **Baseline.** Run the checks before changing anything and note the result. Every change is measured against it.
3. **Small steps.** Make one bounded change and run the checks it affects. Keep it if it moves toward done; revert just that change if it doesn't. Don't repeat a failed approach without a new reason.
4. **Simpler wins.** When two solutions work equally well, keep the one with less code. Removing code without losing anything counts as progress. Don't add abstractions, config, or files the task doesn't need.
5. **Don't touch the evaluator.** Never edit, skip, or loosen a check to make it pass. If a check looks wrong, stop and tell me.

## Subagents

Use them when they save real time or context. Otherwise, do the work yourself.

- **Good fits:** independent pieces that can run in parallel, wide codebase searches, a fresh-eyes review at the end. **Poor fits:** small tasks and tightly coupled edits.
- **Pick the cheapest model that can do the job well.** Sonnet 5.5 for well-defined work: searching, mechanical edits, writing tests, following a clear plan. Opus 5.5 for ambiguous design, hard debugging, and the final review.
- **Brief them fully.** A subagent doesn't see this conversation. Give it the goal, the files, its scope, and exactly what to return.
- **No overlapping edits.** Two subagents never edit the same files at the same time.
- **Verify before keeping.** A subagent saying "done" is a claim. Run the checks on its work yourself.
- **Only you commit and push.** Subagents edit files; they don't touch git.
- Stay within the subagent limit above, counting every agent you start.

## Visual check

For anything a person will look at (UI, layout, styles, charts, generated pages), open it in Chrome and look at it before calling it done.

- Start the dev server if needed, open the page in a new tab, and take a screenshot.
- Compare it with what was asked. Try the main interaction, check the console for errors, and check a phone-width viewport if layout matters.
- Treat this as one of the checks: fix what looks wrong, then look again.
- Leave my other tabs and logged-in accounts alone.
- If Chrome isn't connected, say so. Never claim something looks right without seeing it.

## Git

Commits, pushes to the work branch, and opening the PR are pre-approved. You don't need to ask.

- **Branch.** If `Branch` is new, fetch and branch off the latest base branch. If it's current, work where you are. Unattended work never lands directly on `main`/`master`: if you're on it, create a branch first.
- **Commit at each milestone**, meaning a step that passes its checks and leaves nothing worse than the baseline. Stage only the files you changed. Never commit secrets, `.env` files, build output, or `PROGRESS.md`. Keep messages short: what changed and why.
- **Push after every commit.** If a push fails, keep committing locally, note it in `PROGRESS.md`, and try again at the next milestone.
- **Open the PR when finished** (if `PR` is yes), using `gh`, against the base branch. In the description, cover what changed, the check results, and what's unresolved. Open it as a draft if any check fails or the work is partial.
- **Never** force-push, rewrite pushed history, push to any other branch, merge the PR, or enable auto-merge.

## When I'm away (`Unattended: yes`)

- Don't wait for me. Where you'd normally ask, pick the safest reasonable option, record it under Decisions, and keep going.
- Anything on the ask-first list below: don't do it. Leave it as a next step for me.
- If one part is blocked, record why and move to another part. When nothing useful is left or the limit is reached, run Finish and stop. Don't spin.
- Keep `PROGRESS.md` current after every milestone. On a long run your context may get compacted, and this file is how you stay on track.

## Guardrails

- Stay inside scope.
- Ask before anything else irreversible or outward-facing: deploy, publish, delete data, send messages, spend money.
- Commit before a risky edit so it can be undone.
- Before retrying an external write (push, PR), check whether the first attempt already landed.

## Progress file

You must keep this file when the task is unattended or spans sessions. Skip it for short attended tasks. Keep it out of git (add it to `.git/info/exclude`). Keep it short:

- **Done:** finished milestones and their check results
- **Decisions:** choices that shape the result, and why
- **Tried and failed:** what didn't work, and why
- **Git:** branch, last pushed commit, PR link
- **Next:** one concrete step to resume from

## Finish

1. Reread the full diff once with fresh eyes (a review subagent works well for large changes). Look for bugs, leftover debug code, and complexity you can remove.
2. Rerun all checks on the final version, including the Chrome check for visual changes.
3. Commit and push the final state. If `PR` is yes, open the PR.
4. Report briefly:
   - branch and PR link
   - what changed, with file paths
   - each check: pass or fail, with the real output for failures
   - for visual changes, what you looked at in Chrome
   - if you used subagents: how many, which model, and for what
   - decisions made without me, and anything unresolved

If the limit or a blocker stops you, say exactly what's left. Never report a result you didn't observe.
