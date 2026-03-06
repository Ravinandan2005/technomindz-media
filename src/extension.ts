import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';

// ─── Process handle (module-level so deactivate() can reach it) ───────────
let mediaProcess: ChildProcessWithoutNullStreams | undefined;

// ─── Activate ─────────────────────────────────────────────────────────────
export function activate(context: vscode.ExtensionContext): void {
    console.log('[technomindz-media] activate() called.');

    const extensionRoot = context.extensionPath;

    // Paths
    const venvPythonPath = path.join(extensionRoot, '.venv', 'Scripts', 'python.exe');
    const pythonExe = fs.existsSync(venvPythonPath) ? venvPythonPath : 'python';
    const scriptPath = path.join(extensionRoot, 'media_backend.py');

    // ── 1. Create Status Bar Items ──────────────────────────────────────

    const songItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    songItem.text = '$(music) No Media';
    songItem.tooltip = 'Currently playing';
    songItem.show();

    const prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    prevItem.text = '$(chevron-left)';
    prevItem.tooltip = 'Previous Track';
    prevItem.command = 'technomindz-media.previous';
    prevItem.show();

    const playItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    playItem.text = '$(play)';
    playItem.tooltip = 'Play / Pause';
    playItem.command = 'technomindz-media.playPause';
    playItem.show();

    const nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    nextItem.text = '$(chevron-right)';
    nextItem.tooltip = 'Next Track';
    nextItem.command = 'technomindz-media.next';
    nextItem.show();

    const allItems = [songItem, prevItem, playItem, nextItem];
    context.subscriptions.push(...allItems);

    // ── 2. Helper: send a command to the Python backend ─────────────────

    const sendCommand = (cmd: string): void => {
        if (mediaProcess?.stdin?.writable) {
            mediaProcess.stdin.write(`${cmd}\n`);
        }
    };

    // ── 3. Webview View Provider ────────────────────────────────────────

    class MediaWebviewProvider implements vscode.WebviewViewProvider {
        private _view?: vscode.WebviewView;

        // Cache last known states so that if the webview reloads, we can send it immediately
        private _lastTrack = 'No Media Playing';
        private _lastArtist = '';
        private _lastTitle = 'No Media';
        private _lastState = 'Stopped';
        private _lastPos = 0;
        private _lastDur = 0;
        private _lastThumb = '';

        constructor(private readonly _extensionUri: vscode.Uri) { }

        public resolveWebviewView(
            webviewView: vscode.WebviewView,
            context: vscode.WebviewViewResolveContext,
            _token: vscode.CancellationToken,
        ) {
            this._view = webviewView;

            webviewView.webview.options = {
                // Allow scripts in the webview
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            };

            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

            // Handle messages from the webview
            webviewView.webview.onDidReceiveMessage(data => {
                switch (data.type) {
                    case 'command':
                        sendCommand(data.value);
                        break;
                    case 'scrub':
                        sendCommand(`scrub:${data.value}`);
                        break;
                    case 'ready':
                        // Send initial cached state immediately for fast UI
                        this.sendUpdate('TRACK', { artist: this._lastArtist, title: this._lastTitle });
                        this.sendUpdate('STATE', { state: this._lastState });
                        this.sendUpdate('PROGRESS', { pos: this._lastPos, dur: this._lastDur });
                        this.sendUpdate('THUMBNAIL', { base64: this._lastThumb });
                        // Then ask backend to refresh to ensure 100% accuracy
                        sendCommand('get_state');
                        break;
                }
            });
        }

        public sendUpdate(type: string, payload: any) {
            if (this._view) {
                this._view.webview.postMessage({ type, payload });
            }
        }

        public updateTrack(artist: string, title: string) {
            this._lastArtist = artist;
            this._lastTitle = title;
            this.sendUpdate('TRACK', { artist, title });
        }

        public updateState(state: string) {
            this._lastState = state;
            this.sendUpdate('STATE', { state });
        }

        public updateProgress(pos: number, dur: number) {
            this._lastPos = pos;
            this._lastDur = dur;
            this.sendUpdate('PROGRESS', { pos, dur });
        }

        public updateThumbnail(base64: string) {
            this._lastThumb = base64;
            this.sendUpdate('THUMBNAIL', { base64 });
        }

        private _getHtmlForWebview(webview: vscode.Webview) {
            // Get local logo URI
            const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'logo.png'));

            return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TechnoMindz Media Hub</title>
                <style>
                    :root {
                        --bg-color: #121212;
                        --surface-color: #181818;
                        --text-primary: #ffffff;
                        --text-secondary: #b3b3b3;
                        --accent-color: #1db954; /* Spotify Green */
                    }
                    body {
                        background-color: var(--bg-color);
                        color: var(--text-primary);
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        padding: 10px;
                        margin: 0;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        box-sizing: border-box;
                        overflow-x: hidden;
                        overflow-y: auto;
                    }
                    .header {
                        width: 100%;
                        display: flex;
                        justify-content: center;
                        margin-bottom: 10px;
                    }
                    .album-art {
                        width: 140px;
                        height: 140px;
                        border-radius: 8px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                        object-fit: cover;
                        transition: all 0.2s ease;
                    }
                    .main-content {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        width: 100%;
                        min-width: 0;
                    }
                    .track-info {
                        padding: 0 15px;
                        text-align: center;
                        width: 100%;
                        box-sizing: border-box;
                        min-width: 0;
                        display: flex;
                        flex-direction: column;
                    }
                    .title {
                        font-size: 1.25rem;
                        font-weight: 700;
                        margin-bottom: 8px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .artist {
                        font-size: 0.9rem;
                        color: var(--text-secondary);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .scrubber-container {
                        width: 90%;
                        max-width: 300px;
                        margin: 20px auto;
                    }
                    .time-labels {
                        display: flex;
                        justify-content: space-between;
                        font-size: 0.75rem;
                        color: var(--text-secondary);
                        margin-bottom: 8px;
                    }
                    input[type=range] {
                        -webkit-appearance: none;
                        width: 100%;
                        height: 4px;
                        background: #535353;
                        border-radius: 2px;
                        outline: none;
                        cursor: pointer;
                    }
                    input[type=range]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        height: 12px;
                        width: 12px;
                        border-radius: 50%;
                        background: var(--text-primary);
                        cursor: pointer;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        display: none; /* Only show on hover */
                    }
                    .scrubber-container:hover input[type=range]::-webkit-slider-thumb {
                        display: block;
                    }
                    .controls {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        gap: 20px;
                        margin-top: 5px;
                        margin-bottom: 10px;
                    }
                    /* Responsive height queries for narrow/short sidebars */
                    @media (max-height: 450px) {
                        .album-art { width: 110px; height: 110px; }
                        .scrubber-container { margin: 10px auto; }
                        .title { font-size: 1.1rem; }
                    }
                    @media (max-height: 350px) {
                        .album-art { width: 80px; height: 80px; }
                        .scrubber-container { margin: 5px auto; }
                    }
                    @media (max-height: 250px) {
                        body {
                            flex-direction: row;
                            justify-content: center;
                            padding: 10px 5px;
                        }
                        .header {
                            width: auto;
                            margin-bottom: 0;
                            margin-right: 15px;
                        }
                        .album-art {
                            width: 80px;
                            height: 80px;
                        }
                        .main-content {
                            flex: 1;
                        }
                        .scrubber-container { margin: 5px auto; width: 100%; }
                        .controls { margin-top: 0; margin-bottom: 0; }
                    }
                    .btn {
                        background: none;
                        border: none;
                        color: var(--text-primary);
                        cursor: pointer;
                        padding: 8px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: transform 0.1s, color 0.2s;
                    }
                    .btn:hover {
                        color: var(--accent-color);
                        transform: scale(1.1);
                    }
                    .btn:active {
                        transform: scale(0.95);
                        opacity: 0.7;
                    }
                    .btn svg {
                        width: 24px;
                        height: 24px;
                        fill: currentColor;
                    }
                    .play-pause svg {
                        width: 36px;
                        height: 36px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <img id="album-art" src="${logoUri}" alt="Album Art" class="album-art">
                </div>
                
                <div class="main-content">
                    <div class="track-info">
                        <div class="title" id="track-title">No Media Playing</div>
                        <div class="artist" id="track-artist"></div>
                    </div>

                    <div class="scrubber-container">
                        <div class="time-labels">
                            <span id="time-pos">0:00</span>
                            <span id="time-dur">0:00</span>
                        </div>
                        <input type="range" id="progress-bar" min="0" max="100" value="0" step="1">
                    </div>

                    <div class="controls">
                        <button class="btn" id="btn-prev" aria-label="Previous">
                            <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                        </button>
                        <button class="btn play-pause" id="btn-play" aria-label="Play/Pause">
                            <!-- Play icon by default -->
                            <svg id="icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            <!-- Pause icon (hidden) -->
                            <svg id="icon-pause" viewBox="0 0 24 24" style="display: none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        </button>
                        <button class="btn" id="btn-next" aria-label="Next">
                            <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                        </button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    // DOM Elements
                    const albumArtEl = document.getElementById('album-art');
                    const titleEl = document.getElementById('track-title');
                    const artistEl = document.getElementById('track-artist');
                    const posEl = document.getElementById('time-pos');
                    const durEl = document.getElementById('time-dur');
                    const progressBar = document.getElementById('progress-bar');
                    const iconPlay = document.getElementById('icon-play');
                    const iconPause = document.getElementById('icon-pause');

                    const DEFAULT_LOGO = '${logoUri}';

                    // State
                    let isScrubbing = false;
                    let isPlaying = false;
                    let currentPos = 0;
                    let currentDur = 0;

                    // Helper to format MM:SS
                    function formatTime(seconds) {
                        const m = Math.floor(seconds / 60);
                        const s = Math.floor(seconds % 60);
                        return m + ':' + (s < 10 ? '0' : '') + s;
                    }

                    function updateProgressUI(pos, dur) {
                        if (!isScrubbing) {
                            progressBar.max = dur;
                            progressBar.value = pos;
                            posEl.textContent = formatTime(pos);
                        }
                        durEl.textContent = formatTime(dur);
                        const pct = (progressBar.value / dur) * 100 || 0;
                        progressBar.style.background = \`linear-gradient(to right, var(--text-primary) \${pct}%, #535353 \${pct}%)\`;
                    }

                    // Local interpolation for smooth 1s updates
                    setInterval(() => {
                        if (isPlaying && !isScrubbing && currentDur > 0 && currentPos < currentDur) {
                            currentPos += 1;
                            updateProgressUI(currentPos, currentDur);
                        }
                    }, 1000);

                    // Listen for messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'TRACK':
                                const newTitle = message.payload.title || 'No Media';
                                const newArtist = message.payload.artist;
                                
                                titleEl.textContent = newTitle;
                                artistEl.textContent = newArtist;
                                
                                // Auto-scroll marquees if the text overflows the container
                                setTimeout(() => {
                                    if (titleEl.scrollWidth > titleEl.clientWidth) {
                                        titleEl.innerHTML = \`<marquee scrollamount="3">\${newTitle}</marquee>\`;
                                    }
                                    if (artistEl.scrollWidth > artistEl.clientWidth) {
                                        artistEl.innerHTML = \`<marquee scrollamount="2">\${newArtist}</marquee>\`;
                                    }
                                }, 50);
                                break;
                            case 'STATE':
                                isPlaying = (message.payload.state === 'Playing');
                                if (isPlaying) {
                                    iconPlay.style.display = 'none';
                                    iconPause.style.display = 'block';
                                } else {
                                    iconPlay.style.display = 'block';
                                    iconPause.style.display = 'none';
                                }
                                break;
                            case 'THUMBNAIL':
                                const b64 = message.payload.base64;
                                if (b64 && b64.length > 0) {
                                    albumArtEl.src = 'data:image/jpeg;base64,' + b64;
                                } else {
                                    albumArtEl.src = DEFAULT_LOGO;
                                }
                                break;
                            case 'PROGRESS':
                                currentPos = message.payload.pos;
                                currentDur = message.payload.dur;
                                updateProgressUI(currentPos, currentDur);
                                break;
                        }
                    });

                    // Input Range events
                    progressBar.addEventListener('mousedown', () => isScrubbing = true);
                    progressBar.addEventListener('input', (e) => {
                        posEl.textContent = formatTime(e.target.value);
                        const pct = (e.target.value / currentDur) * 100 || 0;
                        progressBar.style.background = \`linear-gradient(to right, var(--accent-color) \${pct}%, #535353 \${pct}%)\`;
                    });
                    progressBar.addEventListener('change', (e) => {
                        isScrubbing = false;
                        vscode.postMessage({ type: 'scrub', value: e.target.value });
                    });

                    // Buttons
                    document.getElementById('btn-prev').addEventListener('click', () => {
                        vscode.postMessage({ type: 'command', value: 'previous' });
                    });
                    document.getElementById('btn-play').addEventListener('click', () => {
                        vscode.postMessage({ type: 'command', value: 'play_pause' });
                    });
                    document.getElementById('btn-next').addEventListener('click', () => {
                        vscode.postMessage({ type: 'command', value: 'next' });
                    });

                    // Tell the extension host we are fully loaded and ready to receive state
                    vscode.postMessage({ type: 'ready' });
                </script>
            </body>
            </html>`;
        }
    }

    const webviewProvider = new MediaWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('technomindz-media.hub', webviewProvider)
    );

    // ── 4. Register Commands ────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('technomindz-media.playPause', () => {
            sendCommand('play_pause');
            playItem.text = playItem.text === '$(play)' ? '$(debug-pause)' : '$(play)';
        }),

        vscode.commands.registerCommand('technomindz-media.next', () => {
            sendCommand('next');
        }),

        vscode.commands.registerCommand('technomindz-media.previous', () => {
            sendCommand('previous');
        }),

        vscode.commands.registerCommand('technomindz-media.toggleVisibility', () => {
            const allHidden = songItem.text === '';
            if (allHidden) {
                allItems.forEach(item => item.show());
            } else {
                allItems.forEach(item => item.hide());
            }
        }),
    );

    console.log('[technomindz-media] Status bar items, commands, and Webview registered.');

    // ── 5. Spawn Python Backend ────────────────────────────────────────

    try {
        mediaProcess = spawn(pythonExe, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdoutBuffer = '';
        mediaProcess.stdout.on('data', (chunk: Buffer) => {
            stdoutBuffer += chunk.toString('utf8');
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() ?? '';

            for (const rawLine of lines) {
                const line = rawLine.trim();

                if (line.startsWith('TRACK:')) {
                    const trackRaw = line.slice(6).trim();
                    const isNoMedia = !trackRaw || trackRaw === 'No Media Playing';

                    // Parse artist / title from "Artist – Title" format
                    let artist = '';
                    // Clean Windows Python stdout encoding issue (`\uFFFD`) to standard dash
                    let cleanTrackRaw = trackRaw.replace(/\uFFFD/g, '-').replace(/\u2013/g, '-');
                    let title = cleanTrackRaw;

                    const separators = [' - ', ' \u2013 ', ' \u2014 '];
                    for (const sep of separators) {
                        const idx = title.indexOf(sep);
                        if (idx !== -1) {
                            artist = title.slice(0, idx).trim();
                            title = title.slice(idx + sep.length).trim();
                            break;
                        }
                    }

                    // Update status bar with cleaned text
                    songItem.text = isNoMedia ? '$(music) No Media' : `$(music) ${cleanTrackRaw}`;

                    // Update Webview
                    if (isNoMedia) {
                        webviewProvider.updateTrack('', 'No Media Playing');
                    } else {
                        webviewProvider.updateTrack(artist, title);
                    }

                } else if (line.startsWith('STATE:')) {
                    const state = line.slice(6).trim();
                    if (state === 'Playing') {
                        playItem.text = '$(debug-pause)';
                        playItem.tooltip = 'Pause';
                    } else {
                        playItem.text = '$(play)';
                        playItem.tooltip = 'Play';
                    }
                    webviewProvider.updateState(state);

                } else if (line.startsWith('PROGRESS:')) {
                    const progRaw = line.slice(9).trim();
                    const parts = progRaw.split('/');
                    if (parts.length === 2) {
                        const pos = parseFloat(parts[0]);
                        const dur = parseFloat(parts[1]);
                        webviewProvider.updateProgress(pos, dur);
                    }
                } else if (line.startsWith('THUMBNAIL:')) {
                    const b64 = line.slice(10).trim();
                    webviewProvider.updateThumbnail(b64);
                }
            }
        });

        let stderrBuffer = '';
        mediaProcess.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8').trim();
            console.error('[technomindz-media backend stderr]', text);
            stderrBuffer += text + '\n';
        });

        mediaProcess.on('error', (err: any) => {
            if (err.code === 'ENOENT' || err.message.includes('ENOENT')) {
                vscode.window.showErrorMessage(
                    "Python is required for TechnoMindz Media Hub. Install Python 3 and run: pip install winsdk"
                );
            } else {
                vscode.window.showErrorMessage(
                    `technomindz-media: failed to start backend — ${err.message}`
                );
            }
        });

        mediaProcess.on('exit', (code: number | null) => {
            console.log(`[technomindz-media] backend exited with code ${code}`);
            if (code !== 0 && stderrBuffer.trim()) {
                vscode.window.showErrorMessage(
                    `technomindz-media: backend crashed (exit ${code}):\n${stderrBuffer.trim()}`,
                );
            }
        });

        // Initial sync
        setTimeout(() => sendCommand('get_state'), 500);

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`technomindz-media: cannot spawn Python — ${msg}`);
    }

    console.log('[technomindz-media] activated — media controller ready.');
}

// ─── Deactivate ────────────────────────────────────────────────────────────
export function deactivate(): void {
    if (mediaProcess) {
        mediaProcess.stdout.removeAllListeners();
        mediaProcess.stderr.removeAllListeners();
        mediaProcess.kill();
        mediaProcess = undefined;
    }
}
