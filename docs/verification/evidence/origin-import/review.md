# Origin import integrity review

Severity: P1, repeated automatic sync can exhaust the local bot limit and leave
projects unusable after an ordinary setup or link-write failure.

The original `runImport` sequence created a bot, requested `/default-team`, and
only then saved its project link. With one existing workspace head and a capacity
of seven bots, each team request failed after creating a new unlinked bot. Three
rounds produced `[head, orphan1, orphan2, orphan3]` instead of `[head]`. The added
client regression failed on exactly this result before the fix. Workspace
creation had the same missing-link retry gap, and a lost successful team response
could leave role bots behind even if only the Chief were subsequently removed.

Imports now use dedicated authenticated local routes that verify the current
Origin account's read access. Capacity is checked for the whole team. A single
durable bot registry write records the complete Chief, six specialist roles,
workspace grant, and private deployment/cloud identity. A separate link write can
fail safely: the next request finds the saved identity and reconnects it. No bot
deletion or automatic regrant of edited authority is used. Concurrent requests
recheck the saved identity after awaited model selection. Current account and
local admin authorization are checked again before writes. The local model
selection/effort path and hosted model restrictions remain in force.

Reserved names such as `Workspace: Billing` and `Agents` retain their cloud names
but get a `Project: …` local section, preserving their project role and ancestry.
Both reserved-name regression tests also failed before that boundary was fixed.

The production fixture result is recorded in `result.json`. It passed real client
and server requests, link-write fault recovery, lost-response replay and parallel
replay with exactly nine final bots and one project link. Both private bot wire
projections strip the saved import receipt. No UI pixels change in this fix.

Existing orphan bots without a saved import identity are deliberately left for
human review: a matching name cannot prove ownership or that their conversations
can be erased. Legacy manually linked bots keep their established explicit-link
contract; this change does not migrate all historical cloud links into a new
deployment-indexed format.
