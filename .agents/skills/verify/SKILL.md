---
name: verify
description: Run the repo's verification gate - TypeScript typecheck of server/ and web/ plus the safety-invariant checker (no auto-submit on LinkedIn/Naukri/Indeed, no tracked personal data), optionally full builds. Use after any code change or when asked to check, test, or validate the code.
---
# Verify

```bash
.ai/scripts/verify.sh            # typecheck both packages + safety invariants  (~3s)
.ai/scripts/verify.sh --changed  # only packages with uncommitted changes
.ai/scripts/verify.sh --build    # also run tsc build (server) and ng build (web)
node .ai/scripts/check-invariants.mjs   # invariants alone
node .ai/scripts/sync-agents.mjs --check  # generated agent files up to date
```

- Use `--build` when `angular.json`, `tsconfig*.json`, `package.json`, or `start.sh` changed.
- `ng test` is not part of the gate. The specs are still the Angular template stubs.
- To check against the running app, run `./start.sh`. The API is at http://localhost:4000/api
  and the UI at http://localhost:4200. Only call localhost.

Report the result plainly: PASS, or each failure with file:line and the first error line.
Don't "fix" an invariant failure by weakening `check-invariants.mjs`. Ask the user first.
