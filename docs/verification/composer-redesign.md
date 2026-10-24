# Composer, model picker and usage in the chat

The agent chat's composer is one card at the foot of the conversation. The
text sits on top, with attachment chips above it. One toolbar row runs along
the bottom: attach, the model pill, permissions and where the conversation
works on the left; the usage ring, the monthly budget (only when a shared
agent's budget needs attention), dictation, the voice call and the send
button on the right. While the agent works, the send button is **Stop this
turn**; once there is a draft, Stop moves beside it and the send button steers
or queues. The header keeps the agent and thread pills, the runs-on badge,
**Listen** on project pages, the computer and **More**. It shows Stop only when
the thread has no composer (a shared thread the reader cannot write in).

## The model picker

The pill names the model (a leading "Claude" is dropped next to the Claude
mark), and the effort when one is set. Its accessible name is
`Model: <provider> · <model>[ · <effort> effort]`. Below 30rem of composer
width it drops the effort, below 22rem the name, leaving the provider mark.

It opens upward from the composer as `dialog "Choose model"`, no taller than
the room between the composer and the header:

- `textbox "Search models"` has focus and filters every provider's models.
  Enter picks the first match; ArrowDown moves into the list; ArrowUp, Down,
  Home and End move between rows; typing on a row returns to the search;
  Escape clears the search, then closes and hands focus back to the pill.
  The rows are one Tab stop, starting on the current model.
- Providers are grouped, plans first, then API keys, then local engines. A
  Claude or OpenAI sign-in family is one group with an account select. Each
  row has the model's name, a short description, badges (Default, Loaded,
  the context window) and a check on the current model.
- A provider that needs sign-in or setup shows one row that opens its page
  with the setup card. An available update is one row that opens the same
  page with the full notice, so the list keeps its height. **Use a local
  model** opens the local list and looks for local models again.
- The footer holds `group "Reasoning effort"` (Default plus the engine's
  levels) and `group "Apply model changes to"` (**Only this thread** and
  **Thread + bot default**). It stacks the labels on a narrow popover.

## The usage ring

`button "Show plan usage and context"` draws a quiet ring for the context
window. From 80% the ring and the percentage turn warning, from 95% danger. A
mouse hover peeks at the panel; a click pins it open (the choice persists, as
before); Escape or the close button unpins it and returns focus to the ring.
The panel shows the context bar with tokens used and the window, **Compact now**
once the context is nearly full, the collapsed "How this is measured", and the
plan's session and weekly limits with their reset times.

## Run

```sh
OMB_VERIFY_PLAYWRIGHT=<path to playwright's index.mjs> \
  node --experimental-strip-types scripts/verify-composer-redesign.ts after
```

It starts disposable fake-engine servers on ports 26610–26800 with the
repository's fake Claude and Codex, creates Pepper, sends two turns, and serves
the full app (`scripts/testing/threads-preview.tsx`) with a synthetic
`/api/plan-usage` report. Headless Chromium captures Midnight and Meadow at
1280 and 375 px: the chat, a focused draft, the model picker and the usage
panel; at 1280 also a search, the update page, attachment chips, a group
chat's composer and the open picker in every skin. A second server in the fake
engine's `slow` mode holds a turn open for the working composer. Screenshots and `report.json` land in
`docs/verification/evidence/composer-redesign/after/`; `before` runs the same
script on the parent commit. `report.json` must show `noPageErrors: true`,
no horizontal overflow and both popovers inside the viewport.

To drive it by hand on a `ui launch` handle (see [Chat UI](chat-ui.md)):

```sh
pnpm control:omb ui click --ui $H --name "Show plan usage and context"
pnpm control:omb ui eval --ui $H --js "document.querySelector('[data-tour=model]').click(); true"
pnpm control:omb ui snapshot --ui $H --interactive
```

## Tests

```sh
pnpm exec vitest run src/components/ModelPicker.test.ts src/components/ModelPicker.interaction.test.ts src/components/ModelPicker.simple.test.ts src/components/ChatUsagePopover.test.ts src/components/ChatUsagePopover.visibility.test.ts src/components/ChatView.controls.test.ts src/components/CallView.composer.test.ts
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/control-omb-ui.e2e.test.ts scripts/testing/usage-details-ui.e2e.test.ts
pnpm check:contrast
```

## Evidence

| State | Before | After |
| --- | --- | --- |
| Chat, dark 1280 | [PNG](evidence/composer-redesign/before/dark-1280-chat.png) | [PNG](evidence/composer-redesign/after/dark-1280-chat.png) |
| Focused draft, light 1280 | [PNG](evidence/composer-redesign/before/light-1280-composer-focused.png) | [PNG](evidence/composer-redesign/after/light-1280-composer-focused.png) |
| Model picker, dark 1280 | [PNG](evidence/composer-redesign/before/dark-1280-picker-open.png) | [PNG](evidence/composer-redesign/after/dark-1280-picker-open.png) |
| Model picker, light 375 | [PNG](evidence/composer-redesign/before/light-375-picker-open.png) | [PNG](evidence/composer-redesign/after/light-375-picker-open.png) |
| Usage, light 1280 | [PNG](evidence/composer-redesign/before/light-1280-usage-open.png) | [PNG](evidence/composer-redesign/after/light-1280-usage-open.png) |
| Usage, dark 375 | [PNG](evidence/composer-redesign/before/dark-375-usage-open.png) | [PNG](evidence/composer-redesign/after/dark-375-usage-open.png) |
| Update behind one row | — | [PNG](evidence/composer-redesign/after/dark-1280-picker-update.png) |
| Attachment chips | — | [PNG](evidence/composer-redesign/after/light-1280-composer-attachments.png) |
| Stop while working | — | [PNG](evidence/composer-redesign/after/dark-1280-composer-working.png) |
| Stop beside a draft | — | [PNG](evidence/composer-redesign/after/light-1280-composer-working-draft.png) |
| Group chat composer | — | [PNG](evidence/composer-redesign/after/dark-1280-group-composer.png) |
| Picker in Foundry | — | [PNG](evidence/composer-redesign/after/skins/foundry-picker.png) |

The rest of each matrix sits beside these files; `after/skins/` holds the open
picker and composer in each of the nine skins.

## What this proves, and what it does not

Proven: the real renderer and store against disposable fake-engine servers,
in headless Chromium, in two skins and two widths (and the open picker in all
nine skins), with real model switching, effort, scope and Stop; the renderer
tests cover the picker's groups, pages and keyboard model, the usage ring's
pin, peek and compact action, and the composer's structure. Not proven: a real
provider's catalog, the Electron shell's dictation and calls, or the packaged
desktop app.
