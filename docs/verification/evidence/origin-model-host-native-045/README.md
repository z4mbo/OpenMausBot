# Shared model native verification — 045

The finite acceptance checks passed against two isolated native Origin servers, the repository's fake Claude CLI, synthetic accounts and the original owned Convex 042 instance on `127.0.0.1:54851/54852`. No production data, email, GitHub or real provider requests were used. The 228-file backend snapshot was pushed only to that existing local instance.

[manifest.json](manifest.json) records hashes for all nine retained 044 artifacts, four native source closures, the [backend source snapshot](backend-source.json), and source changes made after the final native check. The 044 artifacts were preserved byte for byte. Raw provider captures and fixture credentials remain in ignored private evidence.

## Scenario matrix

| Scenario | Observed result | Retained evidence |
| --- | --- | --- |
| Remote primary and duplicate send ID | Owner CLI ran once; requester CLI never ran; one canonical reply appeared in both native mirrors. | [Initial receipt](../origin-model-host-native-044/receipt.json) |
| Lost successful `begin` response | Requester received 503, reconciled the accepted request, and produced one owner execution without replay. | [Initial receipt](../origin-model-host-native-044/receipt.json) |
| Stop during held thread setup | Stop completed before setup resumed; no hosted begin or provider execution followed. | [Initial receipt](../origin-model-host-native-044/receipt.json) |
| Private context and native confinement | Normal owner control contained the private-memory canary. Hosted context excluded private memory/B; actual MCP search/read/thread-list routes denied private access; outside-project Read was denied. Native arguments excluded Bash/PowerShell/WebFetch. | [Initial receipt](../origin-model-host-native-044/receipt.json), [arguments](../origin-model-host-native-044/native-confinement.json) |
| Local quota → remote backup | One local quota invocation, then one owner invocation; one canonical reply. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Remote quota → distinct remote source | One quota source invocation, then one successful source invocation; final reply attributed to the successful source. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Offline candidate and nonquota control | Controlled offline presence was skipped after typed quota; a successful primary did not fall through. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Partial output before quota | Partial canonical text remained; the local backup never ran. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Stop after owner acceptance | Canonical run cancelled, exact accepted fake-provider PID exited, no fallback or late reply after gate release. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Owner zero daily API cap | Metered CLI preflight refused before any provider prompt; owner spent/reserved USD stayed zero; no local backup ran. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Owner revocation after acceptance | Canonical run interrupted, exact fake-provider PID exited, no fallback or late reply. | [Handover receipt](../origin-model-host-native-044/handover-receipt.json) |
| Remote quota → local backup with inherited project folder | Final fresh request ran owner quota once and local backup once, produced one canonical reply visible in both mirrors, and preserved both private B transcripts and the owner's selected B. | [Final receipt](../origin-model-host-native-044/handover-final-receipt.json) |

## Regressions discovered and corrected

The first remote-to-local attempt rejected a valid inherited project folder because the chooser required a conversation folder override. The next attempt confirmed transfer to the sender but retained the remote busy presentation, so native local dispatch refused to start. Their [first](../origin-model-host-native-044/handover-receipt.json) and [second](../origin-model-host-native-044/handover-sender-failure-receipt.json) failure receipts remain intact. Both earlier send IDs were left untouched; the stuck sender request was explicitly stopped. A new request passed after both fixes.

## Source boundaries

| Native closure | Files | Scope |
| --- | ---: | --- |
| [Initial](../origin-model-host-native-044/runtime-source.json) | 765 | Direct remote/privacy, lost begin acknowledgement, setup Stop. |
| [Handover](../origin-model-host-native-044/handover-runtime-source.json) | 766 | Quota chains, offline control, partial output, accepted Stop, cap and revoke; inherited-folder failure. |
| [Sender failure](../origin-model-host-native-044/handover-sender-failure-runtime-source.json) | 766 | Inherited-folder fix present; busy handoff failure retained. |
| [Final](../origin-model-host-native-044/handover-final-runtime-source.json) | 766 | Fresh inherited-folder remote-to-local request after both corrections and catalog-visibility fix. |

The post-native production-readiness changes in `server/index.ts` and `server/testing/model-host-readiness.ts` have separate root-owned checks. The manifest does not relabel these native runs as having loaded those later changes. Source hashes, rather than the base commit alone, bind each result to the uncommitted implementation it exercised.

## Limits

These checks use a fake CLI. Emitted settings and real permission/MCP denial paths do not establish a real vendor CLI or operating-system sandbox. Distinct source accounts ran on one native owner computer; the offline case used controlled backend presence, not a third native computer. Positive metered HTTP API execution, owner cost settlement, owner crash/restart after unknown accepted work, packaged desktop behavior and production delivery were not established by this manifest.

## Cleanup

[cleanup-receipt.json](cleanup-receipt.json) records the final shutdown. Eight raw capture files were archived and rehashed before the owned native pair and backend stopped. All six owned listener ports closed; the protected-port listener snapshot was identical before and after. The original backend data/profile remain intact. The backend holder's stdin was closed, so its exact process was stopped only after verifying the executable, instance and data path. The [pre-cleanup manifest](manifest-before-cleanup.json) and all original 044 artifacts remain preserved.
