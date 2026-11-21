# Icyteru

Icyteru is a small desktop and Android app for a Hermes Agent you already run. It does not install a model, keep memory, or replace Hermes. Chats, tools, skills, and notes stay on your Hermes, the same one you can reach from Telegram or Discord. Icyteru is only the window.

The look is meant to stay quiet: a sidebar of chats, a plain conversation, and a details panel for memory and skills. The connection is the same one Hermes Desktop uses.

## What you need

- Node.js 22 or newer, to build the app
- An Hermes Agent install on a machine you control
- The gateway running, for example:

```bash
hermes serve
```

`hermes dashboard` serves the same gateway and also opens the browser UI. The default address is `http://127.0.0.9:9119`.

## Connect

1. Open Icyteru.
2. Enter the gateway URL. Choose **Password** or **Token** under the address; Icyteru preselects the one the gateway advertises, and you can switch tabs yourself.
3. Enter the session token **or** the username and password it asks for. An open gateway needs neither.
4. Press **Test connection**, then **Save and continue**.

A session token is `HERMES_DASHBOARD_SESSION_TOKEN` on the Hermes machine. A username and password are the ones registered with the gateway's `basic` auth provider; Icyteru signs in with `POST /auth/password-login`, keeps the session cookie, and opens the chat socket with a one-time ticket. Credentials are stored with the operating-system keychain when it is available.

A pairing code from Telegram or Discord is not a session token. Those codes authorize a chat account. Icyteru uses the same credentials Hermes Desktop and Mobile use.

Hosted gateways that only sign in with OAuth are not covered here. Use a session token, a password provider, or connect with Hermes Desktop for that sign-in.

## Chat

Type a message and press Enter; Shift+Enter adds a line. The composer grows upward as the draft gets longer. Paste a screenshot or a file straight into it, or use the paperclip. Images stage through `image.attach_bytes`, other files through `file.attach`, so the agent opens them from the session workspace.

Slash commands run against the current session: `/steer <text>` reaches a running turn, `/queue <text>` waits for it to finish, `/compress` (or `/compact`) compresses context, and other gateway commands go through `slash.exec`.

## Install and build

```bash
npm install
npm test
npm start
```

`npm start` builds the app and opens it.

Day-to-day development, with a reloadable window:

```bash
npm run dev
```

Installers:

```bash
npm run dist:linux   # AppImage and deb
npm run dist:mac     # DMG and zip, on a Mac
npm run dist:win     # NSIS installer, on Windows
```

The app is Electron, so one project runs on Windows, macOS, and Linux. Build each installer on that platform.

The token is stored in the app's user-data folder. When the operating system keychain is available, it is encrypted with Electron `safeStorage`. Otherwise it is kept in a file that is readable only by your user. A background picture you choose in Settings is copied into that same folder. It is not sent to Hermes.

Light mode is the warm paper look. Dark mode is a deep purple night sky with small stars. You can replace either background with a PNG, JPEG, or WebP of your own, and use the dim and frost sliders so the panels stay readable.

## Build on Windows

These steps are for a Windows laptop. You do not need to install Hermes inside Icyteru. You only need Node.js, Git, and this repository.

### 1. Install Node.js and Git

1. Download **Node.js 22 LTS** from [https://nodejs.org](https://nodejs.org). Pick the Windows Installer (.msi), 64-bit. During setup, leave **Add to PATH** checked.
2. Download Git from [https://git-scm.com/download/win](https://git-scm.com/download/win) and install it. The default options are fine.
3. Close any open terminal, then open a new **Command Prompt** or **PowerShell** window and check:

```bat
node -v
npm -v
git --version
```

`node -v` should print `v22` followed by a smaller number. If the command is not found, restart the computer so Windows picks up the new PATH, then try again.

### 2. Get the code

If this pull request is already merged into `main`:

```bat
git clone https://github.com/Megumiiiiii/icyteru.git
cd icyteru
```

If it is not merged yet, clone the repository and check out the pull request branch:

```bat
git clone https://github.com/Megumiiiiii/icyteru.git
cd icyteru
git fetch origin cursor/icyteru-hermes-client-6e91
git checkout cursor/icyteru-hermes-client-6e91
```

### 3. Install and run

```bat
npm install
npm start
```

`npm install` downloads the libraries. The first run also downloads Electron, so it needs an internet connection.

`npm start` builds the app and opens the window. Use that while you are trying things out.

### 4. Build the Windows installer

```bat
npm run dist:win
```

This takes a few minutes. When it finishes, the installer is in the `release` folder next to the other project files:

```text
release\Icyteru Setup 0.1.0.exe
```

Double-click that file. The installer asks where to put Icyteru, then adds a Start menu shortcut.

### 5. The SmartScreen warning

Windows SmartScreen may say **Windows protected your PC** and name an unknown publisher. That happens because this installer is not signed with a paid code-signing certificate. It does not mean the file was changed after you built it.

If you built it yourself on this computer:

1. Click **More info**.
2. Click **Run anyway**.

Only do that for an installer you just built, or one you downloaded from a place you trust.

### 6. If something fails

**`npm` is blocked in PowerShell** (`npm.ps1 cannot be loaded because running scripts is disabled`). PowerShell's execution policy is stopping the npm script. Either open **Command Prompt** instead and run the same commands, or allow local scripts for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then close PowerShell, open it again, and retry.

**`node-gyp` or `Could not find any Visual Studio installation` during `npm install`.** Icyteru itself does not compile a native addon, but a dependency sometimes tries. Install the C++ build tools, then retry:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. In the installer, select **Desktop development with C++**.
3. Open a new terminal and run `npm install` again.

You can also delete `node_modules` and run `npm install` again if the first download was interrupted.

**`npm` is not recognized.** Node.js is not on PATH. Reinstall Node.js 22 LTS with **Add to PATH** checked, then open a new terminal.

**`git` is not recognized.** Git for Windows is missing or the terminal was open before you installed it. Open a new terminal after installing Git.

**The window opens and then says it cannot reach Hermes.** The app built correctly. Start Hermes on the machine that holds your agent (`hermes serve`) and enter that gateway address on the connect screen.

## Phone and Android

A phone is not the computer running Hermes, so `http://127.0.0.9:9119` points at the phone and the connection fails. Use an address the phone can reach.

Tailscale is the safer choice. Install it on the Hermes machine and on the phone, then use the machine's Tailscale address, for example `http://100.x.x.x:9119`. The session token is still required once Hermes is listening beyond loopback.

If both devices are on a home network you trust, you can listen on every interface instead:

```bash
hermes serve --host 0.0.0.0 --port 9119
```

Set `HERMES_DASHBOARD_SESSION_TOKEN` before that command. Do not forward that port to the public internet. A bind of `0.0.0.0` is what lets the Android app through Hermes's origin check; the token is what keeps other devices out. The phone stores the token in its own local storage. It is not wrapped with the operating-system encryption the desktop app uses.

The Android WebView serves Icyteru from `https://localhost`. A gateway that enforces the WebSocket Origin guard closes `/api/ws` with `4403` unless that origin is trusted. On a gateway build with the extra-origin setting, add:

```bash
HERMES_TRUSTED_ORIGINS=https://localhost,capacitor://localhost,http://localhost
```

Credentials and the one-time ticket are still required; this only lets the packaged client reach the same auth gate as the desktop app.

The Android app is the same screen as the desktop app, packed with Capacitor. On a narrow window the bot list, the chat, and the History or Profile tabs each take the whole screen.

### Build the APK on Windows

1. Install [Node.js 22 LTS](https://nodejs.org/), [Git](https://git-scm.com/download/win), and [Android Studio](https://developer.android.com/studio).
2. Open Android Studio once. In **SDK Manager**, install **Android SDK Platform 35** and **Android SDK Build-Tools**.
3. Clone the repository, check out `main`, and run `npm install`.
4. Build the web app and copy it into the Android project:

```bash
npm run cap:sync
```

5. Open the Android project:

```bash
npx cap open android
```

6. In Android Studio, choose **Build**, then **Build Bundle(s) / APK(s)**, then **Build APK(s)**. The debug APK is `android\app\build\outputs\apk\debug\Icyteru-0.0.46.apk`. Copy it to the phone and open it. Android will ask you to allow installs from that source.

From a terminal, with `JAVA_HOME` and `ANDROID_HOME` set, the same debug APK is:

```bash
npm run android:apk
```

The debug APK is signed with the debug keystore Android Studio creates (`%USERPROFILE%\.android\debug.keystore`, password `android`, alias `androiddebugkey`). That is enough to install a copy you built yourself. It is not a store listing.

For a release APK you can share more widely, create your own key and do not commit it:

```bash
keytool -genkeypair -v -keystore icyteru-release.keystore -alias icyteru -keyalg RSA -keysize 2048 -validity 10000
```

In Android Studio, **Build**, **Generate Signed Bundle / APK**, then **APK**, and choose that keystore. Keep the keystore and the passwords somewhere you can back up. Losing them means you cannot update an install that was signed with them.

The GitHub Release workflow builds this same debug-signed APK and attaches it next to the desktop installers. It does not use a private release key.

## Making a release

You do not upload the installers yourself. GitHub Actions builds them when you publish a version tag, then attaches the files to a Release.

1. Open `package.json` and set `"version"` to the new number, for example `0.1.0`. Commit that change and push it to `main`.
2. Create a tag with the same numbers and a leading `v`, such as `v0.1.0`. The workflow refuses to package when those numbers differ. A tag `v0.0` while `package.json` says `0.1.0` stops immediately and says to tag `v0.1.0` or change the version first. Installer names come from `package.json` (`Icyteru Setup 0.1.0.exe`), and the GitHub Release is named after the tag, so the two have to be the same release.

   On the GitHub website: open the repository, choose **Releases**, then **Draft a new release**. Click **Choose a tag**, type `v0.1.0`, and select **Create new tag on publish**. Leave the target as `main`. Press **Publish release**.

   Or, from a terminal, after the version bump is on `main`:

   ```bash
   git checkout main
   git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Open the **Actions** tab and wait until the **Release** workflow is green. It builds a Windows NSIS installer (`.exe`), a macOS disk image and zip, a Linux AppImage and `.deb` package, and an Android debug APK. The desktop build jobs run `electron-builder --publish never`, so they only write those files. They do not upload them and they do not need a personal access token.
4. The last job, **Publish GitHub Release**, attaches those files, including `Icyteru-0.0.46.apk`, to a Release named after the tag. It uses the `GITHUB_TOKEN` that Actions already provides. You do not add a `GH_TOKEN` secret. Return to **Releases** and download the installers from that version. The Windows file is named like `Icyteru Setup 0.1.0.exe`. The Android file is the debug-signed APK described above.

The tag has to start with `v`, as in `v1.2.3`. A tag without the `v` does not start the workflow. The macOS files are not signed with an Apple certificate, so the first time you open the app macOS may ask you to approve it in System Settings.

## What the app talks to

Icyteru checks `GET /api/status`, then opens the chat socket at `/api/ws`. Messages go through Hermes JSON-RPC: `session.create`, `session.resume`, `session.list`, and `prompt.submit`. Replies arrive as `message.delta` and `message.complete`. Tool calls arrive as `tool.start` and `tool.complete` and fold into a collapsible block under the reply.

When you approve a command or answer a question, Icyteru sends the answer back on that same socket. The choice is applied by your Hermes, not by this app.

If the gateway offers them, the model list comes from `GET /api/model/options`, skills from `GET /api/skills`, and memory status from `GET /api/memory`. Changing the model uses `POST /api/model/set`. That writes the choice on the Hermes machine for new messages.

Profiles come from `profiles.list` on that same socket, the same roster Hermes Desktop uses. Each row's picture is `profiles.get_asset` for `avatar` (`assets/avatar.png` and the other image types under the profile). The name, pin, and last line come from the profile's `ui_meta` and its latest session. Chats for the selected profile are `session.list` with that profile, so Telegram and Discord threads appear when the gateway has them.

## What this app leaves out

Hermes Desktop can also install Hermes, sign in with OAuth, browse files, preview pages, talk by voice, manage projects, cron, billing, and a lot of agent settings. Icyteru does not do those. It also does not run tools on the computer where the window is open. Tools run on the Hermes host, which is what you want when the same agent is already working in Telegram and Discord.

## Disclaimer

Icyteru is an unofficial, community-made client. It is not affiliated with, endorsed by, or supported by Nous Research or the Hermes project, and it is not affiliated with Akeru.

Icyteru only connects to a Hermes gateway you already run. You are responsible for keeping that gateway safe. Keep the session token private, and expose the gateway only through a network you trust, such as Tailscale. Anyone who has the gateway URL and the token can control your agents.

The builds are unsigned. Windows SmartScreen and macOS Gatekeeper may warn you the first time you open an installer or the app. That is expected.

Icyteru is provided as-is under the MIT license, without warranty. You use it at your own risk.

## Thanks

The gateway protocol and the WebSocket URL shape follow [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research, which is MIT licensed. See `THIRD_PARTY_NOTICES.md`.

The quiet layout follows the feel of [Akeru Bot](https://www.akeru-bot.com/) ([source](https://github.com/opencoredev/akeru-bot), MIT). No Akeru code or artwork is included. The bot list itself follows Hermes Desktop's roster: avatar, name, last activity, and the latest line.
