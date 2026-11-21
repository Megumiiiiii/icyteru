# Icyteru release notes

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
