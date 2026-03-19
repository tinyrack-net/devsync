# Completion Report Checklist

Use this structure when reporting completion.

## Minimum report

1. **What changed**
   - one short summary of the completed work

2. **What was validated**
   - commands run
   - manual checks performed
   - relevant outputs or pass/fail summary

3. **What remains uncertain**
   - skipped checks
   - environment limitations
   - assumptions that still need confirmation

## Good completion examples

### Fully verified

- Updated the sitemap parser to handle nested index files.
- Validated with `npm run typecheck`, `biome check .`, and `npm run test`.
- All checks passed.

### Partially verified

- Updated the deployment script to support a new environment flag.
- Validated with `npm run typecheck` and targeted unit tests.
- I could not run the production smoke test locally because it requires deployment credentials. The remaining step is to run `npm run smoke:prod` in the deployment environment.

### Failed validation

- Implemented the fix for the API timeout retry path.
- Ran `pytest tests/api/test_retry.py` and `pytest`, but the full suite still fails.
- One failure appears related to the new retry logic in `tests/api/test_retry.py`; another failure appears pre-existing in `tests/auth/test_login.py`. The task should not be considered complete until the retry failure is resolved.

## Final rule

If validation is incomplete, say so explicitly.
Do not imply that code is production-ready unless the relevant checks actually passed.
