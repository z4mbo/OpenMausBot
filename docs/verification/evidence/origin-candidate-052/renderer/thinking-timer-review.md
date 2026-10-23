# Thinking-timer CI investigation: bounded findings

Reviewed source: `bd111a97d1f161a51e32ad050b4363874d1cd517` (0.7.3). No tracked source or test edits were made in this investigation. The native audit remains held.

## Actual failing observations

- CI39547106200, renderer job119048414713: first direct-thread timer case timed out at `scripts/testing/thinking-timer-ui.e2e.test.ts:172`, before any elapsed-time assertion. It never observed the original task with both busy=true and a numeric turnStartedAt within60seconds. The last probe discards intermediate task state and returns only null. Group timer and14other renderer cases passed.
- Prior source375da4cf in CI39546164818, completed renderer job119045672207, failed the same gate. This is repeated evidence; it is not established as an external runner flake.
- `renderer-job-119048414713-complete.log` SHA256 `4d9c9f5a1c94d4d91967f6cdb9fe91901acb97ae413d79db9b07e0a46c1fd77c`; prior log `renderer-previous-375.log` SHA256 `856c452242111195e555762a6796eb69bb953ed918c2b5d53968947cca5f9e03`.

The native afterEach diagnostic saves bots+AX snapshot to `<fixture.logPath>.thinking-timer.json` under the runner temporary evidence directory. The CI workflow uploads only three named PNG paths. The failed run uploaded two PNGs, without the failed fixture state or server log. Therefore those existing CI outputs cannot distinguish unsent text, a rejected send, the wrong task or a later dispatch failure. An unsupported runtime fix or a blind retry is not justified by last:null alone.

## Real isolated current-source verification

One instrumented hang-mode fixture followed the first case while recording synthetic DOM, current rows, focus, text, all tasks and actual fetch payload/status. It used pre-existing hash-verified vendor agent-browser and Chrome, without downloads or production data. The read probes add delay, so this is not a timing-equivalent reproduction.

- Server selection remained the newly created second thread, while the renderer intentionally retained the original thread.
- Typing left hello in the enabled Message Pepper textarea with textarea focus.
- Enter sent a real POST to the original thread, HTTP202. The original task acquired busy=true and a numeric turnStartedAt; the second task remained idle.
- This confirms that the server-selected thread may differ from the independently selected renderer thread; explicit message.threadId routes correctly in the observed settled path.
- `thinking-timer-diagnosis/result.json` SHA256 `f48707dc51525e7b4a6a0e91cae0181a0ebc373ed44dd011780f94e6cf731e5d`; stages SHA256 `2647f8b1def33e15a388a87c829a803d73a914fdd7888bcde217300b0beabe04`.

The unchanged first test was then run once with its original sequence and timing on Windows:1passed,1filtered,36.21seconds. Its real timer/away/back/stamp assertions, no-console-error assertion and owned cleanup passed. `thinking-timer-exact.log` SHA256 `8cd22069e1ea4ad524fea3db7f04f0b1309b54d6a79c4cf988c92168a6314da2`; actual screenshot SHA256 `83c0432a516c21d5aec6a1ddf58e0ec96e733043157eaaf688309b9758b0eed9`.

Runtime qualification: Windows agent-browser0.36.0-omb.1 executable SHA256 `33bee834f6a6072ec8688b0914726e0262874d758f69f27e8baf7eaac6b5ed15`; Chrome153.0.8010.47 executable SHA256 `01176f6928faeb37ff018bc8884bbca8a0197f51b659d467f2501ab2c64f9fcf`. Linux CI uses a different agent-browser build. This Windows pass does not establish Linux acceptance or explain its failures.

The diagnostic launcher22988 exited0 and its owned data directory was removed. The exact test asserted its own data removal and exit0. Fresh observation05:18:04Z found no listeners on5173/22322/22323 and no diagnostic launcher22988. Root's core fixture5174 and protected3210/3211/5199/8799 were untouched.

## Code-path comparison and candidate correction

The thinking test, Composer and send-key code are unchanged versus earlier accepted source042. Composer pins the visible thread into its send action; the state dispatcher carries that explicit thread through the messages POST. Sidebar aria-current follows the same visible bot.threadId. No confirmed wrong-thread runtime regression was found in this bounded path.

The new UI launcher calls startSessionDaemon unconditionally on every platform before open. The helper is explicitly a workaround for the Windows0.36.0-omb.1 stderr-pipe panic; the runtime ownBrowserDaemon wrapper correctly returns immediately on non-Windows, but the UI launcher directly calls startBrowserDaemon and bypasses that platform guard. This is a concrete change to the previously accepted Linux fixture startup. It is a plausible compatibility factor, not a demonstrated causal explanation for the timer failure; the group case also uses it and passes.

Proposed for root review, not implemented: scope the explicit UI daemon startup to Windows, preserving its verified fix while restoring the prior Linux launch path, and preserve or emit bounded synthetic failure state (textarea/focus, actual message request/status, all tasks and server refusal) in CI. Keep the original timer assertions and timeouts. Another same-source retry without causal evidence would still be blind. Actual Linux proof remains necessary before release clearance.
