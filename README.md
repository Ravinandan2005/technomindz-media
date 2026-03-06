![VS Code Extension](https://img.shields.io/badge/VSCode-Extension-blue)
![Platform](https://img.shields.io/badge/Platform-Windows-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

# TechnoMindz Media Controller

Elevate your workspace with **TechnoMindz Media Hub** — a sleek, powerful, and responsive media controller designed to keep your focus sharp and your music perfectly synced directly inside Visual Studio Code.

## Preview

### Media Hub inside VS Code

<img src="resources/logo.png" alt="TechnoMindz Media Controller" width="250">

## Demo

See TechnoMindz Media Controller controlling your system media directly from VS Code.

https://github.com/user-attachments/assets/6832e312-76c4-484f-aa15-d670d1654423

⚠️ This extension currently works only on **Windows** because it uses the Windows Media Transport Controls API via WinRT.


## Features

- **Spotify-Style Webview UI:** A beautiful, dark-themed responsive UI panel that sits cleanly in your Explorer sidebar.
- **Adaptive Layout:** Regardless of how narrow or short you compress your sidebar, the Media Hub dynamically adjusts its Flexbox layout to keep album art and controls instantly accessible.
- **Live System Synchronization:** Automatically detects the active media session (Spotify, Apple Music, YouTube in a browser, etc.) playing on Windows and binds to it.
- **Real-Time Progress Tracking:** View your exact playback position with a dynamic scrubber that tracks milliseconds live.
- **Interactive Scrubber:** Click or drag the progress bar to instantly seek to any point in the track.
- **Auto-Scrolling Marquees:** Long track titles or artist names automatically scroll across the screen so nothing is ever cut off.
- **Integrated Controls:**
  - Play / Pause
  - Next Track
  - Previous Track
- **Fallback Branding:** Automatically displays the custom TechnoMindz logo when no album art is provided by the media source.
- **Status Bar Integration:** A lightweight hoverable track display sits quietly at the bottom of VS Code alongside quick-access media buttons.

## Requirements

This extension requires a **Windows OS** environment to function, as it uses native Windows Runtime (WinRT) bindings and the `winsdk` API to interface directly with the global system Media Transport Controls.

### Python Environment
To fetch Album Art and live timeline scrubber properties, the extension spins up a lightweight Python background process.

You will need Python 3 installed and accessible via your system PATH or integrated `.venv`.

**Dependencies:**
- `winsdk`

You must install the required dependency using Python.

Open a terminal and run:
```bash
pip install winsdk
```
Make sure Python is installed on your computer and available in your system PATH.

### Step-by-Step Installation

1. Open **VS Code** (`Ctrl` + `Shift` + `X` to open Extensions).
2. Search for **TechnoMindz Media Controller** and click **Install**.
3. **Ensure Python 3 is installed** on your computer and added to your system PATH.
4. Open a new terminal in VS Code (or your command prompt) and run this exact command to install the required Windows integrations:
   ```bash
   pip install winsdk
   ```
5. Reload VS Code.

### Developer Setup

1. Clone the repository into your VS Code extensions folder or open the folder directly in VS Code.
2. Run `npm install` to install extension dependencies.
3. Ensure your Python environment has `winsdk` installed (`pip install winsdk`).
4. Press `F5` to open an Extension Development Host with the Media Hub loaded.

## How to Use
Once installed and activated:
1. Open the **Explorer** sidebar in VS Code (`Ctrl` + `Shift` + `E`).
2. Expand the accordion tab labeled `TechnoMindz Media Hub`.
3. Play any media on your system (Spotify, Chrome, YouTube, Music apps).
4. The panel will instantly sync with the playing track, displaying the Album Art, Artist, Title, and playback scrubber.
5. Use the UI buttons or the bottom Status bar buttons to control your system's media without ever leaving your editor.

## Commands

You can also control media from the Command Palette.

Open Command Palette (`Ctrl` + `Shift` + `P`) and run:
- `Media: Play / Pause`
- `Media: Next Track`
- `Media: Previous Track`

## First Run

When the extension starts for the first time, it launches a lightweight Python background process that connects to Windows Media Transport Controls.

If no media is currently playing, the panel will display the TechnoMindz logo until a media session becomes active.

## Extension Settings

Currently, TechnoMindz Media automatically locks onto the most actively playing session on your Windows system. If you pause a session, it deliberately "sticks" to the paused app ID so you don't mysteriously jump to other inactive apps.

## Known Issues

- **Linux / macOS Support:** Because this relies deeply on Windows standard `winsdk` and internal Media Transport controls, this extension currently only works fully on Windows operating systems.
- **Web Browser Media Art:** Some web browser media sessions (like a YouTube tab in Chrome) might not always export high-res Album Art to the Windows Media Transport pipeline depending on the browser version. The extension handles this gracefully by defaulting to the TechnoMindz logo.

## Release Notes

### 0.0.1
Initial release of **TechnoMindz Media**.
- Fully integrated Spotify-style Webview Interface.
- Live python-powered timeline scrubbing and Base64 Thumbnail extraction.
- Completely responsive CSS architecture with Marquee wrappers.
- Windows Media Session sticky binding.
