## v0.0.87

### Added

- Notifications now leave an actionable entry in the tray menu: **Open: <title>**
  jumps to the session that sent it, and the taskbar button flashes. A Windows
  toast from an unpackaged app cannot report a click, so the tray is the honest
  place for that action.

### Fixed

- The sign-in card no longer starts above the window on a short window: it now
  scrolls inside its own box instead of relying on centring, so the fields are
  always reachable and the last button is never the only thing on screen.
- `version:check` no longer passes while `src-tauri/Cargo.lock` is stale on a
  Windows checkout (CRLF), which used to fail the release before it started.

## v0.0.86

### Changed

- The desktop app now runs on **Tauri 2** instead of Electron: a Rust host owns
  the gateway connection, the encrypted credential vault, file handling, and
  notifications, and the window uses the system WebView. The installer drops
  from about 124 MB to about 5 MB, and startup no longer spawns the Electron
  helper processes.
- Settings gained a **Window** card: the X button can quit the app or keep it
  running in the tray, with a tray menu to bring it back.
- On first launch the app offers what it can read from an older Icyteru install:
  the gateway URL, theme, and extra gateways. The saved token stays encrypted by
  the previous app's keychain entry, so you paste it once.

### Fixed

- Forgetting a gateway used to open the sign-in card with a stale connection
  error and its fields scrolled out of view.
- The Gateway URL field in Settings was stuck at 230px, and Enter on the
  composer skipped the send effect when Sakuga mode was on.

# Icyteru release notes

## v0.0.85

### Changed

- **Global model selection now matches the per-chat picker.** Settings uses the same searchable, theme-aware model list with provider tabs, provider labels, selected-provider marker, and a visible check on the selected model instead of the limited native dropdown.
- The closed global selector shows both the selected model and provider, including on Android.
- On Android the model search field no longer opens the keyboard by itself when a picker appears; tap the field to type. Desktop and web still focus it immediately.

### Fixed

- Global defaults now resolve duplicate model IDs using the authoritative global provider. If the same model is offered by several providers, Settings no longer silently selects the first inventory entry.
- The custom picker stays within the viewport: the list scrolls inside the popover and the panel opens upward when there is not enough room below, including at 390 px with no horizontal overflow.

## v0.0.84

### Added

- **Sakuga VFX, off by default.** An optional anime/manga effects layer adds impact bursts, smoke puffs, and SFX lettering on buttons, tabs, pins, and sliders, follows the active theme, and turns itself off when the system asks for reduced motion. It ships as a lazy-loaded module, so the base bundle is unchanged. Thanks to Justin Finkelman for Sakuga VFX (MIT).
- Subagent cards and the compress bar use the Sakuga progress component when the effects layer is enabled.

### Changed

- The Android build resolves Maven Central through Google's mirror first, avoiding CI throttling.

### Fixed

- **Image and video generation use the normal tool-call UI again.** The extra standalone progress card duplicated the existing tool state and got in the way of the conversation.
- The progress overlay canvas aligns to its bounding rect on Android edge-to-edge layouts and while the keyboard is open.

## v0.0.83

### Added

- **Rename sessions directly from History.** Session rows now have an inline Rename action with Save/Cancel controls, a 200-character limit, Android Back support, and conflict-safe writes that never overwrite a newer session state.
- **Native desktop context menus.** Electron now provides the expected text editing actions and opens external links only when they use HTTPS.
- **Return to the active chat from the phone Agents panel.** A dedicated mobile action makes it easy to leave the roster without changing agents.
- **Manual Android preview builds.** The beta workflow can produce a short-lived, production-signed APK only when explicitly dispatched; it validates the version, SDK, signing inputs, signer identity, and artifact before upload.

### Changed

- **Desktop runtime upgraded to Electron 45.5.0 and electron-builder 26.18.0.** Node typings now match Electron's Node 24 runtime, and production dependencies remain free of known npm vulnerabilities.
- Transparent PNG/WebP avatars keep their transparent background; a failed avatar image falls back to the agent initial instead of leaving a blank space.
- Desktop custom backgrounds accept only PNG, JPEG, or WebP images up to 8 MB and now surface validation errors in Settings.

### Fixed

- **Background subagents no longer lock the composer.** After the parent response finishes, delegated children remain visible while the primary action returns to Send; stale Tok/s and foreground working/steer controls stay hidden until a real foreground turn starts.
- **Underscores in identifiers stay visible and copyable.** Plain text such as `pesan_kalo_pake_ini`, `CONTOH_PESAN`, `snake_case`, and `__init__` is no longer paired across words and converted into accidental emphasis. Explicit `_italic_` and `**bold**` formatting still works; `__double_underscore__` text is now intentionally literal.
- Session rename handles stale revisions, missing sessions, double-submit, and Android Back/save races without closing the wrong editor or exposing raw gateway error codes.
- Notification reconnects no longer start overlapping desktop polling requests, and malformed avatar/background images fail safely.
- Markdown accepts both backtick and tilde fenced code blocks without freezing on malformed fences.

## v0.0.82

### Fixed

- **Session reasoning stays selected when switching models.** If a chat has an explicit reasoning level such as Medium, Icyteru now preserves and re-applies that session choice after a successful model switch instead of silently repainting the model's/global default such as High.
- Reasoning is restored before side data refreshes, so the chat header and the next turn stay consistent with the user's per-session selection.

## v0.0.81

### Added

- **Real Markdown tables in chat.** Assistant messages with a GFM-style header row and `|---|---|` delimiter now render as an actual table instead of raw pipe text. Cells keep inline formatting, alignment markers work, and the table uses theme-aware borders and header styling.
- On phones, long table cells wrap and the table fits the bubble width, so criteria text stays readable without clipping or horizontal page scroll.

## v0.0.80

### Fixed

- **Tool durations survive closing and reopening Icyteru.** History tool cards now reconstruct each tool's `startedAt`/`finishedAt` from the raw `session.resume` history: the assistant `tool_calls` row supplies the start timestamp and the matching tool-result row supplies the finish timestamp. Previously the display projection had no timing, so a reopened session fell back to `1 tool call` / `5 tool calls` instead of `Worked for 1m 25s · 5 tools`.

## v0.0.79

### Added

- **The “working” line now shows the real phase and elapsed time.** It reads `✍️ Writing... 12s` for `write_file`/`patch`, `⚔️ Running tools... 12s` for other tools, and `🔮 Thinking... 12s` while waiting for the first output. The three dots animate, and the timer runs in an isolated component so the transcript does not re-render every second.

### Changed

- **The Tok/s pill only appears when there is a real positive rate.** It stays hidden during thinking and tool phases, so there is no duplicate `🔮 Thinking` pill alongside the new working line.

## v0.0.78

### Fixed

- **The hidden-agent counter no longer overlaps Settings.** It now sits directly below the eye icon as a bare number, without a badge or background, so the eye and gear remain separate controls.

## v0.0.77

### Added

- **Notification taps open the session that sent them**, even when Icyteru is already open in another chat. Android emits a `sessionOpened` event from `onNewIntent` and the WebView consumes it; desktop notification-feed clicks carry the originating `session_id` into `client.openSession`. Tapping a reply/clarify/approval notification while the app is minimized now lands on the right conversation instead of only raising the app.
- **Tool activity cards sit above the assistant reply** and use the theme-aware `panel`/`surface` colors. The summary shows `Worked for N secs · N tools`, expands into a tree-connected list with tool icons, argument previews, and per-tool duration. Assistant text stays in its own bubble and is never folded into the tool card.
- **History source groups start collapsed**, so Telegram/Discord/Desktop/Jobs/Schedule lists stay compact. Searching opens the matching groups; clearing the search returns to the collapsed view.
- **Agents can be hidden from the left panel.** Hover an agent row and use the eye-off button; the eye button beside Settings lists hidden agents and restores them with Unhide. The last visible agent cannot be hidden.

### Fixed

- **Reconnect to the notification session is immediate** on Android warm starts and desktop when the window is already open; the old handler only focused the app.

## v0.0.76

### Added

- **History groups can be reordered by dragging** (carried from v0.0.74): drag the ⠿ handle beside Telegram, Discord, Schedule, Desktop, Jobs, Local, or any source group; order is saved per device.
- **Session Info shows a tap-to-copy session ID** (carried from v0.0.78): the full ID sits below the context estimate with a ✓ Copied confirmation.
- **`desktop_preview`/`preview_panel` render a real preview dock** (carried from v0.0.78/v0.0.80): embedded page, Open in browser, close, and a reopen chip. `preview_panel` works for Telegram/Discord/CLI sessions when the gateway exposes it.
- **Gateway-side preview `read`** (v0.0.80): `preview_panel action=read` fetches a public page and returns extracted visible text with pagination, instead of trying to read a cross-origin iframe.

### Fixed

- **Reconnect survives a WebView/app restart too.** The active session is now remembered in `localStorage` (gateway URL + session ID), not only in the in-memory live object. After a socket drop or Android WebView recreation, Icyteru reopens the last session instead of landing on New chat. Switching to a different gateway or starting a New chat clears the remembered ID.
- **Local sessions stay in the Local group** (v0.0.79): history also merges the profile REST list for rows the live/stored picker omits, and `local` is labelled `Local`.
- **The Tok/s pill sits above the upload button** on phone and desktop (v0.0.75), and **pinned/local session state no longer disappears** from history.

## v0.0.75

### Changed

- **The Tok/s pill now sits above the upload button** in the composer on both phone and desktop, instead of beside it. It keeps the same Thinking/tool states and a compact mobile size.

## v0.0.74

### Added

- **History groups can be reordered by dragging.** Drag the ⠿ handle beside Telegram, Discord, Schedule, Desktop, Jobs, Local, or any other source group to move it. The order is saved per device and survives restarts; touch dragging works on Android, and the handle has a 44px target.

## v0.0.73

### Fixed

- **Download buttons now work on Android.** Media attachments use a native `MediaStore` bridge instead of the HTML `download` attribute, which Android WebView ignores for `data:` URLs. Files are saved under **Downloads/Icyteru/**, with a ✓ confirmation.
- **The “Ineffa is working…” indicator no longer sticks on an idle history session.** The composer was treating a stale `SessionRow.running` flag as authoritative after a turn had already ended. It now follows the transcript/live subagent state, and reopening a session with `running: false` clears both the working indicator and the stale row.

## v0.0.72

### Fixed

- **Steer on an idle session no longer fails with `stale_generation`.** If a history session still looked like it was working but the gateway reported `running: false`, the client kept using an old execution generation. It now clears the stale working state and sends the text as a normal message instead of surfacing a gateway error.

## v0.0.71

### Added

- **Rich browser-vault cards.** Icyteru now renders `vault.unlock_prompt`, `vault.code`, and `vault.save_login` as dedicated cards: password-manager unlock, one-time code with the site/hint, and save-login with identifier + password fields. Secrets stay in the input and travel only in the answer frame; they never enter the transcript, logs, or model context.
- **Vault prompts can reach Icyteru from Telegram/Discord sessions.** When the same session is open in Icyteru, the gateway sends the vault request to that viewer instead of only local Desktop turns. If no viewer is attached, the prompt is skipped immediately rather than waiting.

### Fixed

- `vault.save_login` was previously not understood by the client, and unlock/code cards appeared as a generic “Hermes needs a secret” prompt. Each kind now has the correct title, body, fields, and reply payload.

## v0.0.70

### Fixed

- **Pinned sessions stay pinned.** Live session rows were merged without the picker fields, so their `pinned` value became false and overwrote the stored pin. History then showed only a subset of pins and a second pin attempt hit the gateway's 404 "no change" path. Live history now requests picker fields and keeps the authoritative pinned state; a regression test covers live and stored rows.

## v0.0.69

### Added

- **Code blocks are copyable and expandable.** Fenced code now has a `CODE` header with Copy and Expand actions, a Copied confirmation, and an Android/WebView clipboard fallback. Expanded code opens in a dismissible modal.
- **Subagent cards work for every session source.** Turns whose gateway route does not publish `subagent.*` events (for example a Telegram session opened in Icyteru) now poll `subagent.list` when `delegate_task` starts, so the live card still shows goals, status, and tool counts.

### Fixed

- **New Chat no longer makes the previous local session vanish.** History now merges the live feed with the stored picker; live local sessions were previously omitted from the sidebar, and New Chat now refreshes history immediately.
- **Presence dots are honest.** The selected agent always gets a live dot, and the History running dot also follows streaming, tool calls, and live subagents instead of only a gateway row flag. Stale running flags are cleared on refresh.

## v0.0.68

### Fixed

- **The Jobs history group now loads.** The gateway dashboard caps `/api/sessions` `limit` at 100, but Icyteru asked for 200, so every one-shot Jobs request returned 422 and the group silently disappeared. The client now requests the dashboard's 100-row cap, and a regression test covers the one-shot path.

## v0.0.67

### Fixed

- **Profiles no longer share history.** Switching agents clears the previous history immediately and ignores a late refresh from the profile that was just left, so an empty profile cannot show another agent's sessions.
- **Tool calls and messages stay in their own session.** Events from another session, profile, or a chat that is no longer live can no longer be painted into an empty "New chat". Approval and clarify cards remain global so they still reach you from any transport.
- **Dialpool job history is visible.** One-shot `hermes -z` sessions are hidden by the gateway's normal picker; Icyteru now fetches the active profile's jobs from the profile-prefixed REST endpoint and lists them under **Jobs**. Job sessions without a live subscription open read-only.
- **The working indicator stays honest.** A matching `session.info.running` is authoritative, with the session row and live subagents as fallbacks. After a tool-call preamble, **Ineffa is working…**, Stop, and Steer no longer disappear while the gateway is still thinking.

### Changed

- Session and side-panel refreshes are guarded by a profile epoch, preventing stale responses from repainting the newly selected agent.

## v0.0.66

### Changed

- **Abyss is now a dark-red chasm.** The teal palette is replaced with deep wine surfaces, crimson accents, and a static canyon backdrop: black/maroon cliff walls, a red rim glow, and a black bottom. No animation, so it stays calm behind long chats.
- **Antartika has falling snow.** A new `Snowflakes` layer drifts 28 SVG flakes with varied size, sway, spin, and negative delays, matching the Sakura petal treatment. The layer stays behind the chat and is hidden under `prefers-reduced-motion`.

## v0.0.65

### Fixed

- **Custom backgrounds no longer leak into signature themes.** A second, ungated `image` variable in `App.tsx` bypassed the GitHub-only check, so Sakura, Abyss, Antartika, and Kraft could render the custom GitHub image. A single gated source now drives both the backdrop and the photo layer. Only GitHub Light, GitHub Dark, and `System` when it resolves to them use a custom image.

### Changed

- **Stars got the portfolio night-sky treatment.** Three CSS depth layers, 18 individually twinkling star dots (9 bright), and 5 soft glow stars replace the old single canvas. The Stars chat surface is more transparent and unblurred so the layers read through; reduced-motion still disables every star animation.

## v0.0.64

### Changed

- **Custom background images now belong to GitHub Light/Dark only.** Paper, Stars, Sakura, Antartika, Kraft, and Abyss keep their signature backgrounds. GitHub Light uses the light image, GitHub Dark uses the dark image, and `System` follows whichever GitHub mode is active. Settings cards are labelled **GitHub Light background** / **GitHub Dark background** to match.

## v0.0.63

### Added

- **Nine themes.** Paper, Sakura, Antartika, Kraft, Stars, Abyss, GitHub Light, GitHub Dark, and System are available in Settings. Sakura now has falling petals and faint blossoms; Abyss has a deep teal-ocean backdrop; Antartika is icy blue; Kraft is warm cardboard; Stars keeps the purple night sky. GitHub themes stay deliberately plain.
- **System follows GitHub.** When the theme is `System`, light mode resolves to GitHub Light and dark mode to GitHub Dark. The pre-paint script and persisted theme validation understand the new ids.

### Changed

- Settings uses a compact 3×3 theme grid (2 columns on phones), and the theme labels now describe the palettes instead of only Light/Dark.

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
