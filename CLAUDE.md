# CLAUDE.md — Project Conventions for new-api

> **悟空私有分支：** 下文要求读的 `AGENTS.md` 指本目录的 `newapi/AGENTS.md`，它开头的“悟空私有分支”一段优先；
> 与仓库根 `AGENTS.md`（悟空总规则）冲突时一律以根规则为准。“遵守全部规则”不包括本仓不适用的 Issue/PR 流程和上游部署方式。

## MANDATORY: Read AGENTS.md with the Read tool

Do not treat `@AGENTS.md` as loaded. Claude Code does not reliably inline that import.

Before any planning, coding, reviewing, or answering a project question, you MUST call the Read tool on the repo-root file `AGENTS.md` and wait for the full contents. This is the first action of every session and every new task.

Rules:

- Do not start from memory, summaries, or this file alone.
- Do not skip the Read because a previous turn mentioned AGENTS.md.
- Do not replace the Read with a grep, glob, or partial skim.
- After reading, follow every rule in `AGENTS.md` for the rest of the work.
- If the task touches `web/`, also Read `web/AGENTS.md` before editing frontend files.
