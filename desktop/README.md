# Deckhouse DJ desktop

The game as a desktop app for Mac, Windows and Linux: the same build the
website serves, in its own window, working offline. It's an Electron shell
(`main.cjs`) around `../dist`, so it runs on Chromium everywhere and DJ
controllers (Web MIDI), Air DJ's camera and the sound card picker all work.

## Get it

Download it from the [latest release](https://github.com/Limitlessgamingunblocked/dj/releases/latest).
The **Desktop app** workflow (`.github/workflows/desktop.yml`) rebuilds it on
every push to the default branch and replaces that release.

- **Mac (M1 and later):** `…-mac-arm64.zip`; **Intel Macs:** `…-mac-x64.zip` (a .dmg of each is there too). Double-click the zip and drag the app into Applications.
  The app has no Apple developer certificate, so the first launch is blocked:
  click Done, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
  (Or in Terminal: `xattr -dr com.apple.quarantine "/Applications/Deckhouse DJ.app"`.)
- **Windows:** `…-win-x64.exe` installs it with a Start menu and desktop shortcut. If SmartScreen
  stops it, click **More info → Run anyway**.
- **Linux:** `…-linux-x86_64.AppImage`: make it executable and run it.

Your library, career and settings are kept in the app's own data folder, not the browser's,
so they start fresh the first time (Settings → Your settings → Export / Import moves settings across).

## Build it yourself

```bash
npm ci && npm run build        # at the repository root: the game, in dist/
cd desktop
npm ci
npm start                      # run it unpacked
npx electron-builder --mac     # or --win / --linux: installers in desktop/release/
```

The icons in `build/` come from `assets_source/icons` (`sh assets_source/icons/render.sh`).
Signing with an Apple Developer ID (and notarising) would remove the first-launch step on a Mac;
`build/adhoc-sign.cjs` gives it an ad-hoc signature meanwhile so Apple Silicon Macs will open it at all.
