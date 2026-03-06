"""
media_backend.py — Windows GSMTC bridge for the technomindz-media VS Code extension.

Dependencies (install into .venv):
    pip install winsdk

Protocol:
  STDOUT (to Node)  →  "TRACK:<artist> – <title>\n"
                        "STATE:Playing\n"  |  "STATE:Paused\n"  |  "STATE:Stopped\n"
  STDIN  (from Node) →  "play_pause\n" | "next\n" | "previous\n" | "get_state\n"
"""

import asyncio
import sys
import base64
from typing import Any, Optional

from winsdk.windows.media.control import (  # type: ignore[import-untyped]
    GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    GlobalSystemMediaTransportControlsSession as MediaSession,
)


# ---------------------------------------------------------------------------
# State cache
# ---------------------------------------------------------------------------

_last_track: str = ""
_last_state: str = ""
_last_progress: str = ""
_last_thumbnail: str = ""
_manager: Optional[MediaManager] = None
_loop: Optional[asyncio.AbstractEventLoop] = None


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _emit(line: str) -> None:
    print(line, flush=True)


def _emit_track(track: str) -> None:
    global _last_track
    output = track if track else "No Media Playing"
    if output != _last_track:
        _last_track = output
        _emit(f"TRACK:{output}")


def _emit_state(state: str) -> None:
    global _last_state
    if state != _last_state:
        _last_state = state
        _emit(f"STATE:{state}")


def _emit_progress(pos: float, total: float) -> None:
    global _last_progress
    prog = f"{pos:.1f}/{total:.1f}"
    if prog != _last_progress:
        _last_progress = prog
        _emit(f"PROGRESS:{prog}")


def _emit_thumbnail(b64: str) -> None:
    global _last_thumbnail
    if b64 != _last_thumbnail:
        _last_thumbnail = b64
        # We don't emit the actual string if empty, we just emit THUMBNAIL:
        # The frontend handles empty as fallback.
        _emit(f"THUMBNAIL:{b64}")


# ---------------------------------------------------------------------------
# Playback status helper (integer-based, version-safe)
# ---------------------------------------------------------------------------

def _playback_state_string(playback_info) -> str:
    """
    Windows MediaPlaybackStatus integers (stable WinRT contract):
      0 = Closed   → Stopped
      1 = Opening  → Paused
      2 = Changing → Paused
      3 = Stopped  → Stopped
      4 = Playing  → Playing
      5 = Paused   → Paused
    """
    try:
        val = int(playback_info.playback_status)
    except Exception:
        return "Paused"
    if val == 4:
        return "Playing"
    if val in (0, 3):
        return "Stopped"
    return "Paused"


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

async def _read_session(session: MediaSession) -> None:
    """Emit TRACK and STATE for the given session."""
    try:
        props = await session.try_get_media_properties_async()
        artist = (props.artist or "").strip()
        title  = (props.title  or "").strip()
        if artist and title:
            track = f"{artist} \u2013 {title}"
        else:
            track = title or artist or "Playing\u2026"
    except Exception:
        track = ""

    _emit_track(track)

    try:
        thumb_ref = props.thumbnail
        if thumb_ref:
            from winsdk.windows.storage.streams import DataReader # type: ignore
            stream = await thumb_ref.open_read_async()
            reader = DataReader(stream)
            await reader.load_async(stream.size)
            ibuffer = reader.read_buffer(stream.size)
            # ibuffer implements the buffer protocol in winsdk
            b64 = base64.b64encode(memoryview(ibuffer).tobytes()).decode("utf-8")
            _emit_thumbnail(b64)
        else:
            _emit_thumbnail("")
    except Exception as e:
        _emit(f"ERROR: Thumbnail extraction failed: {e}")
        _emit_thumbnail("")

    try:
        info  = session.get_playback_info()
        state = _playback_state_string(info)
    except Exception:
        state = "Paused"

    _emit_state(state)

    try:
        timeline = session.get_timeline_properties()
        # duration is a timedelta in microseconds; divided by 10^6 for seconds
        pos_sec = timeline.position.total_seconds()
        end_sec = timeline.end_time.total_seconds()
        _emit_progress(pos_sec, end_sec)
    except Exception:
        pass


def _is_session_alive(session: Optional[MediaSession]) -> bool:
    """Check if a session is still alive and usable."""
    if session is None:
        return False
    try:
        info = session.get_playback_info()
        status = int(info.playback_status)
        # 0 = Closed — session is dead
        return status != 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Event callbacks
# ---------------------------------------------------------------------------

def _on_playback_info_changed(session: MediaSession, _args) -> None:  # type: ignore[type-arg]
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_read_session(session), _loop)


def _on_media_properties_changed(session: MediaSession, _args) -> None:  # type: ignore[type-arg]
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_read_session(session), _loop)


def _on_timeline_properties_changed(session: MediaSession, _args) -> None:  # type: ignore[type-arg]
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_read_session(session), _loop)


def _on_session_changed(_manager_arg, _args) -> None:  # type: ignore[type-arg]
    """Called when Windows switches the 'current' session."""
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_evaluate_sessions(), _loop)


# ---------------------------------------------------------------------------
# Session wiring — STICKY: we don't follow Windows' "current" blindly
# ---------------------------------------------------------------------------

_current_session: Optional[MediaSession] = None
_playback_token: Any  = None
_props_token:    Any  = None
_timeline_token: Any  = None


async def _evaluate_sessions() -> None:
    """Find the best session and hook into it."""
    global _manager, _current_session, _playback_token, _props_token

    if _manager is None:
        return

    best_session: Optional[MediaSession] = None
    try:
        sessions = _manager.get_sessions()
        
        # 1. Prefer any PLAYING session
        for s in sessions:
            try:
                if int(s.get_playback_info().playback_status) == 4:  # type: ignore
                    best_session = s
                    break
            except Exception:
                pass
        
        # 2. Stick to current session if still around and nothing else is playing
        if best_session is None and _current_session is not None:
            try:
                curr_id = _current_session.source_app_user_model_id
                for s in sessions:
                    if s.source_app_user_model_id == curr_id:  # type: ignore
                        best_session = s
                        break
            except Exception:
                pass
                
        # 3. Fallback to Windows 'current'
        if best_session is None:
            best_session = _manager.get_current_session()
            
    except Exception:
        best_session = None

    # Compare by App ID to see if we changed apps
    curr_id = ""
    if _current_session is not None:
        try:
            curr_id = _current_session.source_app_user_model_id
        except Exception:
            pass
            
    best_id = ""
    if best_session is not None:
        try:
            best_id = best_session.source_app_user_model_id
        except Exception:
            pass
            
    if best_session is not None and curr_id == best_id and curr_id != "":
        # Same application, don't detach/reattach listeners
        await _read_session(_current_session)
        return

    # Actually changing apps! Detach old
    if _current_session is not None:
        try:
            if _playback_token is not None:
                _current_session.remove_playback_info_changed(_playback_token)  # type: ignore[arg-type]
            if _props_token is not None:
                _current_session.remove_media_properties_changed(_props_token)  # type: ignore[arg-type]
            if _timeline_token is not None:
                _current_session.remove_timeline_properties_changed(_timeline_token)  # type: ignore[arg-type]
        except Exception:
            pass

    _current_session = best_session
    _playback_token  = None
    _props_token     = None
    _timeline_token  = None

    if best_session is None:
        _emit_track("")
        _emit_state("Stopped")
        _emit_progress(0, 0)
        _emit_thumbnail("")
        return

    # Attach new
    _playback_token = best_session.add_playback_info_changed(_on_playback_info_changed)
    _props_token    = best_session.add_media_properties_changed(_on_media_properties_changed)
    _timeline_token = best_session.add_timeline_properties_changed(_on_timeline_properties_changed)

    await _read_session(best_session)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

async def initialise() -> None:
    global _manager
    _manager = await MediaManager.request_async()  # type: ignore[assignment]
    _manager.add_current_session_changed(_on_session_changed)  # type: ignore[union-attr]
    await _evaluate_sessions()


async def listen_commands() -> None:
    loop = asyncio.get_event_loop()
    while True:
        line: str = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break

        command = line.strip().lower()

        if command == "get_state":
            # Force re-emit current track + state + progress + thumb
            global _last_track, _last_state, _last_progress, _last_thumbnail
            _last_track = ""
            _last_state = ""
            _last_progress = ""
            _last_thumbnail = ""
            await _evaluate_sessions()
            continue

        session = _current_session
        if not session:
            continue

        try:
            if command == "play_pause":
                await session.try_toggle_play_pause_async()
            elif command == "next":
                await session.try_skip_next_async()
            elif command == "previous":
                await session.try_skip_previous_async()
            elif command.startswith("scrub:"):
                try:
                    target_sec = float(command.split(":", 1)[1])
                    # TimeSpan expects 100-nanosecond ticks (1 sec = 10_000_000 ticks)
                    ticks = int(target_sec * 10_000_000)
                    await session.try_change_playback_position_async(ticks)  # type: ignore[arg-type]
                except ValueError:
                    pass
        except Exception as exc:
            _emit(f"ERROR:{exc}")


async def heartbeat() -> None:
    """Re-read session every 1s. Evaluate to ensure we are on best session."""
    while True:
        await asyncio.sleep(1)
        await _evaluate_sessions()


async def main() -> None:
    global _loop
    _loop = asyncio.get_event_loop()
    await initialise()
    await asyncio.gather(
        listen_commands(),
        heartbeat(),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
