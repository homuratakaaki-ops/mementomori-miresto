# Stage 14: gate before enabling cloud storage (2026-10-12)

Scope: test Worker `holy-angel-gacha-test` and its dedicated D1 only. No production merge or paid upgrade.

## Verified
- D1 binding `DB` and `workspaces` table exist according to the owner's live `/health` screenshot.
- Draft PR #2 commit `99b5f1da` completed GitHub Actions successfully. Cloud API checks use mock D1 / mock network only.
- Existing read/put handler rejects unauthenticated calls, validates v3 document via `serializeCombinedWorkspace`, and uses a conditional `remote_revision` UPDATE.

## Blockers before enabling real edits
1. **No workspace creation exists.** There is currently no safe way to issue a random workspace ID and a random edit token, save a token hash, and return the token only once. Never ask the user to type a token or manually insert a hashed token in the console.
2. **Creation abuse protection is missing.** Before activating POST creation, enforce an actual server-verified Turnstile response (or keep creation disabled while testing), rate/quantity guards, and size limits. CORS is not authentication.
3. **End-to-end deployment is missing.** The API imports local ESM modules, so copying only the handler into the dashboard will not work; bundle with its dependencies. Verify the real deployed output before directing the user to Deploy.
4. **Deletion and revoke are missing.** Require authenticated explicit confirmation and negative tests before exposing.
5. **Real D1 update semantics are untested.** Validate GET/PUT success, 409, invalid token, valid / invalid v3, offline retention, rollback, and export/import with the disposable test database and synthetic data.
6. **Origin/access controls and protection headers require review.** No third-party scripts on an editor page containing an edit token; prevent token leaks to logs or URL queries.
7. **Document max 64,000 UTF-8 bytes**, not characters. Guard request sizes before processing; preserve local un-synced state on any failure.

## Next action
Implement an isolated, fully tested, disabled-by-default test-only workspace creation route with server-side validation, then test bundled API against synthetic data. Do not deploy client secrets or a shared real user record until all gates pass.

Brain case study: modelled storage success and two-device conflicts separately from real D1 deployment; approval to create Free test resources does not imply approval to deploy an unverified public editing API.
