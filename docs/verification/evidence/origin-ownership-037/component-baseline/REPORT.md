# Exact component baseline replay

The final root test files were copied byte for byte into the isolated lease worktree as untracked files. The production components, client and hooks stayed at baseline `ec28ec06e935b10a176f26586348e81831475e80`; no production source was replaced. Own HEAD remained `99f2c5672fb358f749bb02a9e899bdfe5dbf7b35`. The three committed lease files were verified unchanged before and after the replay.

| Final test file | Actual result on baseline |
| --- | --- |
| `OriginGate.session.test.ts` | 4 failed, 1 passed, 5 total |
| `OriginConnect.session.test.ts` | 8 failed, 2 passed, 10 total |

Both commands exited 1 for behavioral assertions. No import, compilation, setup or network error caused the red results. Vitest's existing runners deprecation notice appears in the logs. The dialog's missing-alert assertion reports an undefined text-content value: the product did not render the required alert. That is not an environment failure.

The main form's current successful authentication/invite/share control passed with its two-argument slice assertion, so the test does not require the newer optional capture argument. The failed main form cases demonstrate both sign-in/signup responses applying after a backend switch, an old invite continuation sharing after account replacement, and token publication before a refused server handoff. Dialog failures demonstrate forwarding superseded credentials, stale disconnect, swallowed HTTP refusal, three raw versus canonical URL cases, and hidden handoff errors. Current-session PUT and signed-out DELETE controls pass.

Test SHA256:

- Gate: `66ee4bb48ba21069396ca986a405afa715bc56f71b8de69a4498ab502704b726`
- Connect: `d080af802f55dd6ecde630eae2cfa6db7309b755093f128e0d5abd8dd2dc3ec8`

`bindings-before.json` and `final-proof.json` bind the actual checkout bytes, normalized baseline Git blobs, exact parent/copied test bytes, result cases, and unchanged lease source. `gate-red.*` and `connect-red.*` retain command metadata, raw logs, structured Vitest reports and exit metadata. Test snapshots are also copied into this packet for reproducibility.

Each test process used Node 24.21.0, an explicit environment whitelist and its own home/temp/AppData. Convex and fetch were synthetic fixtures in the test files. No server or browser service was launched; no main checkout, live port, Convex process, production, commit or push was changed. Root separately owns corrected-source green acceptance; this packet claims baseline behavior only.
