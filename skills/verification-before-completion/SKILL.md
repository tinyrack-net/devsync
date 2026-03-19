---
name: verification-before-completion
description: Verify work before reporting completion. Use when finishing a task so the agent can identify validation steps, run relevant checks, confirm outcomes, and clearly report any remaining risk.
---

# Verification Before Completion

Use this skill whenever you are about to say work is done.

The goal is to prevent premature completion reports by making validation explicit.

## Core workflow

1. **Inspect the project context first**
   - Read project instructions, task requirements, and any local guidance files.
   - Identify expected validation commands from files such as `README.md`, `package.json`, `pyproject.toml`, `Makefile`, CI configs, or agent instructions.

2. **Create a validation plan**
   - List the checks that are relevant to the change.
   - Start with the smallest high-signal checks for the changed area.
   - Run broader project validation before completion when it is available and practical.

3. **Run the checks**
   - Execute the relevant commands.
   - Prefer deterministic validation such as tests, type-checking, linting, builds, or targeted smoke checks.
   - If a manual verification step is required, describe exactly what was checked.

4. **Interpret the results carefully**
   - Distinguish between:
     - checks that passed
     - checks that failed because of the current change
     - pre-existing failures or unrelated environment issues
   - Do not claim success if required validation was skipped or failed.

5. **Report completion with evidence**
   - Summarize what was validated.
   - Call out any unverified assumptions, skipped steps, flaky results, or environment limitations.
   - If something could not be verified, state that clearly and explain why.

## Validation priorities

Prefer this order when appropriate:

1. targeted checks for the changed code path
2. project-required quality gates
3. broader regression checks
4. manual smoke tests or user-facing verification

## Rules

- Never say a task is fully complete without checking whether validation is expected.
- Never hide failing checks.
- Never treat “I changed the code” as equivalent to “it works”.
- If validation is expensive or blocked, say what remains and what the user should run next.
- If the repository includes explicit required commands, run those before finishing unless the user told you not to.

## References

- [Command discovery guide](references/command-discovery.md)
- [Completion report checklist](references/completion-report-checklist.md)
