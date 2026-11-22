# Icyteru release notes

## v0.0.62

### Fixed

- **Session Info stays inside the viewport.** The card lived inside the resizable history panel, whose `overflow:hidden` and optional `backdrop-filter` clipped it when the panel got narrow. It now renders through a portal to `document.body`, centers in the viewport, and caps its height with scroll on short screens.

### Changed

- **Light mode has a paper background.** Default light mode now uses a warm paper color with faint ruled lines, a margin line, and subtle grain. The treatment is limited to the chat/settings surfaces so bubbles stay readable.
- **Dark-mode stars are smaller.** Canvas star sizes and CSS twinkles were reduced for a calmer night sky.

## v0.0.61

### Added

- **Thinking state in the composer.** While a turn is streaming with no output yet, the pill shows `🔮 Thinking...`; only the three dots animate and the crystal stays static. The first assistant delta switches to `⌨️ N Tok/s`; a running tool switches to `⚔️ N Tok/s`. The text check only considers assistant rows after the latest user message, so old history does not skip the thinking phase.

### Fixed

- **Tok/s no longer starts from the previous turn.** `send`, `newChat`, `openSession`, and `disconnect` now clear the rolling window, the previous `session.usage` average, and the displayed value. A new turn starts at `🔮 Thinking...` instead of showing an old `87 Tok/s`.
- **Tok/s pill follows light/dark theme.** Background, border, text, pending/tool states, and the spark use theme variables instead of hardcoded beige.

## v0.0.60

### Fixed

- **Model picker marks the real provider again.** The active marker used the first inventory row that contained the model id, so a no-override session could show a check next to Nous Portal while the header and global provider were `opencode-go`. The session/global provider is now authoritative; inventory inference is only a fallback.
- **Reasoning falls back to the current global level.** Icyteru now honors the gateway’s `explicit` flag: an inherited or frozen effort is not treated as a per-session override, so the header shows the global level when the user never chose one. `newChat()` clears the session value, and saving a global level no longer overwrites an explicit session override.

### Changed

- The reasoning fallback requires the gateway’s `config.get` response to include `explicit` and `global` (loaded by the gateway restart). Older gateways keep the previous effective-value behavior until restarted.

## v0.0.59

### Fixed

- **History no longer shrinks after a reconnect.** A forced reconnect used to land on the `default` profile even when another profile was active, and a transient `session.list` picker failure fell back to a live-only subset that overwrote the history list. Reconnect now preserves the active profile, merges fallback rows instead of dropping omitted sessions, and also merges the picker page for a same-gateway reconnect. Covered by new client-state tests.

## v0.0.58

### Added

- **Session Info in history.** Every session row now has a small bar-chart button next to the pin. It opens a `📊 Session Info` card with the session title, `Messages`, and `Estimated context` tokens. Live sessions read `session.stats`; history mounts fall back to a transcript estimate. Closes with `×`, outside click, Escape, or Android Back.

### Fixed

- **`/usage` works in Icyteru.** The gateway’s `slash.exec` authorizes only local sessions, so `/usage` in Telegram/history sessions returned `permission_denied`. Icyteru now answers `/usage` client-side from `session.stats` (model, input/output, total, API calls, context) with a transcript estimate as fallback; no gateway config change is needed.

## v0.0.57

### Fixed

- **Non-image attachments work in messaging and history sessions.** The gateway’s `file.attach` used to return `permission_denied` whenever a Telegram or history-mounted session had no local launch policy. It now stages under the profile’s attachments store and returns an absolute `@file:` ref. New chats are resumed/subscribed before staging, and a `permission_denied` upload re-subscribes once and retries. **Requires a gateway restart.**
- **A stale session open can no longer overwrite the active chat.** `openSession()` now carries an open epoch; after every async resume/history read it verifies the request is still the latest before changing the live session, transcript, model, or reasoning. The A→B race is covered by a deferred-response regression test.
- **Queued messages resume receipt polling after a reconnect.** Entries retained across `disconnect()` are checked again after the next successful connection instead of staying `queued` forever. A reconnect regression test verifies the receipt poll and terminal cleanup.
- **Sent files and images now appear in your own bubble.** `send()` keeps attachment metadata on the user transcript row; images render inline, files and small text/Markdown files render as chips with preview/download, and assistant media stays unchanged. No gateway media route is needed for the local preview.

## v0.0.56

### Fixed

- **Reasoning updates in the header immediately.** After choosing a session reasoning level, the top bar shows the chosen value right away; it no longer waits for the next chat message while the gateway’s cached agent still reports the old level. Global reasoning changes also repaint the header immediately.
- **Settings global defaults are profile-wide again.** The Default model and Default reasoning dropdowns read the profile defaults, not the currently open session. Opening a chat with a per-session model or reasoning no longer makes that session value look global.

## v0.0.55

### Changed

- **Agent roster is quieter.** The left panel no longer shows a last-active time (`4h`, `20d`, …) next to each profile; it keeps the avatar, name, presence dot, and pin.

### Fixed

- **Reasoning now follows the session and the global default correctly.** The top-bar level uses the session override, falls back to the profile’s global reasoning when the session has none, and only then falls back to `medium`. Saving a global default refreshes the active session’s value; a new empty chat shows the global default instead of a hardcoded `Med`.

## v0.0.54

### Fixed

- **The model header now survives session switches, profile switches, and an app restart.** The active model is taken from the session row’s stored `model` (`sessions.model`) instead of `/api/model/options` or `session.resume` info, which can report the profile default for messaging sessions. Changing a model updates that row immediately; returning to the chat later still shows the model chosen for that chat. Model-options refreshes preserve the active row value.

## v0.0.53

### Fixed

- **The model header now follows the open session.** `refreshSideData()` and `openSession()` request `/api/model/options?session_id=<session>`, so switching the model in one chat can no longer repaint another chat’s header with the profile default. Model options are refreshed again after a session resumes, and a regression test covers the session-scoped URL.
- **Phone touch targets.** The header back `‹` keeps its compact 28px visual but now has a 44px hit area, and the Settings link is 46×44. At 390px the header has no horizontal overflow and the title stays around 106px.

## v0.0.52

### Fixed

- **Forget gateway now also unregisters push notifications.** On Android, forgetting a gateway retrieves the current FCM token, calls the gateway’s `/api/plugins/icyteru-push/unregister`, stops the foreground service, and deletes the device token. A stale token can no longer keep sending notifications while the app is on the Connect screen. If the gateway is unreachable, deleting the device token still lets FCM prune it on the next send.

## v0.0.51

### Fixed

- **One assistant message no longer splits around a tool block.** When `message.complete` replaces a streamed preamble with a different final answer, every tool `textOffset` is moved to the end of the final text. The final bubble stays whole and the tool block appears after it. Normal turns with separate assistant messages still show each message’s tool block in event order.
- **Windows notification previews are cleaner and longer.** The renderer now uses a 280-character preview, strips bullets/code, preserves `~/` paths, fixes spacing before punctuation, and cuts at a sentence or word boundary. Long final answers no longer look like they stopped at the first heading.

## v0.0.50

### Fixed

- **Windows notifications now use the final reply.** The desktop renderer waits for 2 seconds of stable, non-streaming state with no running tool and no live subagent before notifying. A tool-call preamble such as “Aku siapin release…” no longer produces a toast; the final answer does. Clarify and approval questions still notify immediately.

## v0.0.49

### Added

- **Android hardware Back navigation.** Back now closes an open media preview, model/reasoning menu, send menu, or queue pill first; then Settings → chat, history panel → chat, chat → roster, and only exits the app from the roster. The header back arrow keeps working as before.
- **Subagent progress card.** Delegated work appears as a `N subagents` pill with queued/thinking/tool/completed/failed/timed-out/stopped states, the current goal, `2/3` progress, and an expandable task list.
- **Version single-source.** `package.json` is the only version input. `npm run version:set -- 0.0.49` updates Android `versionCode`/`versionName`, `src/version.ts`, `package-lock.json`, and README asset names. `npm run version:check` runs in CI before a release build.
- **Tok/s mode animations.** The composer pill uses a soft typing tap for `⌨️` chat output and a clash swing with a small `✦` spark for `⚔️` tool calls. Both respect `prefers-reduced-motion: reduce`.
- **Preview shots.** `?shot=tok-chat`, `?shot=question-multi`, and `?shot=remote-clarify-multi` for visual QA.

### Changed

- **Clarify multi-select is comma-safe.** Selected choices are stored as arrays, so labels containing commas keep their ✓ indicator. Multi-select answers are sent as 1-based choice indices (`"1, 3"`), which the gateway resolves back to the original labels.
- **Clarify submit guard.** `Send answers` is disabled until at least one question has a non-empty answer. A sending lock blocks double submits and shows `Sending…`; partial answers remain allowed.
- **Model menu resets on close.** Closing via toggle, outside click, Escape, Back, or a successful switch clears the search filter and returns the provider tab to **All**.
- **Agent selection from Settings.** Clicking an agent in the desktop sidebar while Settings is open now returns to chat with that agent instead of leaving the screen on Settings.
- **Touch targets.** On phones and coarse pointers, header actions, sidebar icons, pins, attach, jump-latest, media preview close/download/zoom, send menu, queue pill, and queue actions are at least 44px. The 390px header still fits with a readable title.
- **Electron packaging.** `@capacitor/*` and `@fontsource/inter` moved to devDependencies; `app.asar` now carries only the runtime `ws` dependency (1.4 MB) instead of bundling the Capacitor and font packages.
- **Notification stacking.** Each event keeps its own notification. The FCM collapse tag was removed, while `icyteru_session_id` still deep-links a background tap to the right session.
- **Unsigned desktop builds are documented.** Release notes and README explain the Windows SmartScreen and macOS Gatekeeper bypass. Real signing still requires Apple Developer ID/notarization and a Windows code-signing certificate in Actions secrets.
- **Android security hardening.** App backups are disabled, cleartext HTTP/WS is limited to `localhost`, `127.0.0.1`, and `10.0.2.2`, and data-extraction rules exclude shared preferences, files, and databases.
- **Markdown fences.** The parser now handles 3+ backticks/tildes, info strings with spaces, 4-backtick fences, and malformed blocks without freezing the renderer.
- **Composer and phone navigation.** The Stop/Steer/Queue menu closes on outside click and Escape. Phone New chat clears the search and returns to chat. Forget gateway requires a second **Forget gateway? / Keep** confirmation.
- **Android foreground service.** `IcyteruConnectionService` handles `onTimeout()` for Android 15 and stops when the connection leaves `ready`.
- **Release workflow.** The Android build derives `ANDROID_SDK_ROOT` from the installed SDK in the same shell, and the release job verifies the derived version files before building.
- **Pin controls and headers.** Pin buttons use one SVG icon with 44px phone targets. The mobile header keeps a 22px avatar and a readable title. Tablet history uses a right-side drawer, and the 981–1099px header compacts without overlapping.

### Fixed

- **Tool rows complete independently.** A `tool.generating` placeholder is adopted by the real `tool.start` call, so a finished tool row stops spinning instead of waiting for the last tool call in the turn.
- **Connection probe isolation.** Probing a gateway no longer mutates the live client’s token/cookie or attaches the probe socket to the live transcript; connection state is saved and restored around the probe.
- **Media plugin path safety.** `/media` only serves Hermes media/cache roots (plus `HERMES_MEDIA_ALLOW_DIRS`), sends `attachment` and `nosniff` headers, and cannot expose the Firebase service-account key.
- **Notification feed privacy.** The feed moved to `~/.hermes/state/icyteru-push/` with 700/600 permissions, 240-character previews, 24-hour/50-entry retention, and a file lock for concurrent writes.
