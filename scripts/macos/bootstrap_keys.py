#!/usr/bin/env python3
"""Create and debug a private temporary WeChat copy without changing the original."""

import argparse
import os
from pathlib import Path
import signal
import subprocess
import time

from capture_keys import (
    HelperError, WARNING, checked_path, encrypted_database_pages, emit, install_cancel_handlers,
    defer_cancel, native_user, private_directory, restore_handlers,
)


TOOLS = {
    name: "/usr/bin/" + name
    for name in ("codesign", "xcrun", "ditto", "chmod", "xattr", "pgrep", "ps", "python3")
}
TOOLS["developer"] = "/usr/sbin/DevToolsSecurity"
TOOLS["lsregister"] = (
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/"
    "LaunchServices.framework/Support/lsregister"
)


def run(arguments, timeout=30, **kwargs):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, **kwargs)
    if result.returncode:
        raise HelperError("required command failed")
    return (result.stdout or "") + (result.stderr or "")


def running_commands():
    result = subprocess.run([TOOLS["pgrep"], "-x", "WeChat"], capture_output=True, text=True, timeout=5)
    if result.returncode == 1:
        return []
    if result.returncode != 0:
        raise HelperError("could not determine running WeChat processes")
    commands = []
    for pid in result.stdout.split():
        if not pid.isdecimal():
            raise HelperError("invalid process listing")
        # A racing process exit is treated as uncertain, not as permission to relaunch.
        commands.append(run([TOOLS["ps"], "-p", pid, "-o", "comm="], timeout=5).strip())
    if not commands or any(not command for command in commands):
        raise HelperError("incomplete process listing")
    return commands


def stop_capture(process):
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def validate_bundle_links(bundle):
    # ditto preserves bundle symlinks. Reject escaping links before any recursive
    # chmod/xattr/signing operation can touch content outside the private copy.
    for entry in bundle.rglob("*"):
        if entry.is_symlink() and not entry.resolve(strict=True).is_relative_to(bundle):
            raise HelperError("bundle contains an external symlink")


def restore_original(application, signature, temporary_app, disabled_app, launch_original):
    verification_failed = False
    try:
        run([TOOLS["codesign"], "--verify", "--deep", "--strict", str(application)])
        verification_failed = run([TOOLS["codesign"], "-dvv", str(application)]) != signature
    except Exception:
        verification_failed = True
    # A failed original check must not bypass cleanup of the modified copy.
    commands = running_commands()
    if any(command == str(temporary_app / "Contents/MacOS/WeChat") or
           command.startswith(str(temporary_app) + "/") for command in commands):
        raise HelperError("temporary process is still running")
    if temporary_app.exists():
        if os.path.lexists(disabled_app):
            raise HelperError("disabled bundle destination already exists")
        # Disable even if LaunchServices unregister fails, but do not claim full restoration.
        try:
            run([TOOLS["lsregister"], "-u", str(temporary_app)])
        finally:
            temporary_app.rename(disabled_app)
    if verification_failed:
        raise HelperError("original signature could not be confirmed; automatic relaunch refused")
    emit("original_signature_unchanged", temporary_bundle_disabled=disabled_app.exists())
    if launch_original and not commands:
        restored = subprocess.Popen(
            [str(application / "Contents/MacOS/WeChat")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        time.sleep(1)
        exited = restored.poll() is not None
        emit("original_launch_requested", pid=restored.pid, exited=exited)
        if exited:
            raise HelperError("original launch exited; open original manually")


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=WARNING)
    parser.add_argument("--app", type=Path, default=Path("/Applications/WeChat.app"))
    parser.add_argument("--db-root", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--acknowledge-debug-copy", action="store_true", help=WARNING)
    args = parser.parse_args()

    if not args.acknowledge_debug_copy:
        parser.error("requires --acknowledge-debug-copy: " + WARNING)
    native_user()
    if not 10 <= args.timeout <= 300:
        raise HelperError("timeout must be between 10 and 300 seconds")
    for tool in TOOLS.values():
        if not Path(tool).is_file() or not os.access(tool, os.X_OK):
            raise HelperError("required macOS tool is missing or not executable")
    application = checked_path(args.app)
    original_executable = checked_path(application / "Contents/MacOS/WeChat")
    if application.suffix != ".app" or not original_executable.is_file() or not os.access(original_executable, os.X_OK):
        raise HelperError("invalid original application bundle")
    database_root = checked_path(args.db_root)
    if not encrypted_database_pages(database_root):
        raise HelperError("the selected account has no encrypted databases")
    state = checked_path(args.state_dir, must_exist=False)
    for protected in (application, database_root):
        if state == protected or state in protected.parents or protected in state.parents:
            raise HelperError("state, application and database paths must not overlap")
    if application == database_root or application in database_root.parents or database_root in application.parents:
        raise HelperError("application and database paths must not overlap")
    # Do not chmod existing directories or create chains under untrusted parents.
    parent = state.parent.stat()
    if parent.st_uid not in (0, os.geteuid()) or (parent.st_mode & 0o022 and not parent.st_mode & 0o1000):
        raise HelperError("state parent directory is not trusted")
    if state.exists():
        private_directory(state)
        if any(state.iterdir()):
            raise HelperError("state directory must be empty")
    else:
        state.mkdir(mode=0o700)
        private_directory(state)
    helper = checked_path(Path(__file__).with_name("capture_keys.py"))
    if not helper.is_file():
        raise HelperError("capture helper is missing")
    developer_status = run([TOOLS["developer"], "-status"]).lower()
    if "enabled" not in developer_status or "disabled" in developer_status:
        raise HelperError("developer mode must already be enabled; helper never changes system policy")
    if running_commands():
        raise HelperError("quit WeChat normally first; no process was stopped")
    run([TOOLS["codesign"], "--verify", "--deep", "--strict", str(application)])
    original_signature = run([TOOLS["codesign"], "-dvv", str(application)])
    lldb_python = run([TOOLS["xcrun"], "lldb", "-P"]).strip()
    if not lldb_python or "\n" in lldb_python or not Path(lldb_python).is_absolute() or not Path(lldb_python).is_dir():
        raise HelperError("invalid LLDB Python module location")
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(("PYTHON", "DYLD_"))}
    environment.update(PYTHONPATH=lldb_python, PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1",
                       PATH="/usr/bin:/bin:/usr/sbin:/sbin")
    run([TOOLS["python3"], "-s", "-c", "import lldb; assert hasattr(lldb, 'SBDebugger')"],
        env=environment, cwd=state)

    keys = state / "keys.json"
    temporary_app = state / "WeChat-trial.app"
    disabled_app = state / "WeChat-trial.disabled"
    process = None
    launch_original = False
    return_code = 2
    old_umask = os.umask(0o077)
    handlers = install_cancel_handlers()
    emit("debug_copy_warning", instruction=WARNING)
    try:
        run([TOOLS["ditto"], str(application), str(temporary_app)], timeout=120)
        validate_bundle_links(temporary_app)
        run([TOOLS["chmod"], "-R", "u+w", str(temporary_app)])
        run([TOOLS["xattr"], "-cr", str(temporary_app)])
        run([TOOLS["codesign"], "--force", "--deep", "--sign", "-", str(temporary_app)], timeout=120)
        run([TOOLS["codesign"], "--verify", "--deep", "--strict", str(temporary_app)])
        # Recheck immediately before launching: never attach or stop another instance.
        if running_commands():
            raise HelperError("WeChat started during preparation; capture refused")
        emit("copy_prepared", instruction="Use only the temporary window; do not edit messages or drafts.")
        command = [TOOLS["python3"], "-s", str(helper), "--exe",
                   str(temporary_app / "Contents/MacOS/WeChat"), "--db-root", str(database_root),
                   "--out", str(keys), "--timeout", str(args.timeout), "--acknowledge-debug-copy"]
        process = subprocess.Popen(command, env=environment, cwd=state, start_new_session=True)
        launch_original = True
        try:
            return_code = process.wait(timeout=args.timeout + 30)
        except subprocess.TimeoutExpired:
            emit("capture_timeout")
            return_code = 3
    except KeyboardInterrupt:
        emit("bootstrap_cancelled")
        return_code = 130
    finally:
        try:
            # Repeated cancellation must not interrupt owned-process cleanup.
            for sig in handlers:
                signal.signal(sig, defer_cancel)
            if process is not None:
                try:
                    stop_capture(process)
                except Exception:
                    launch_original = False
                    return_code = 2
                    emit("manual_restore_required", reason="capture_child_exit_unconfirmed")
        finally:
            try:
                restore_original(application, original_signature, temporary_app, disabled_app, launch_original)
            except Exception:
                emit("manual_restore_required", reason="cleanup_or_original_verification_failed",
                     instruction="Quit the temporary copy normally; verify and open the original manually. Keep state private.")
                return_code = 2
            finally:
                restore_handlers(handlers)
                os.umask(old_umask)
    if keys.exists():
        emit("keys_saved_privately", complete=return_code == 0, permissions=oct(keys.stat().st_mode & 0o777))
    return return_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        emit("bootstrap_cancelled")
        raise SystemExit(130)
    except HelperError as caught:
        emit("bootstrap_error", reason=str(caught))
        raise SystemExit(2)
    except Exception:
        emit("bootstrap_error", reason="bootstrap_failed; check prerequisites and private state")
        raise SystemExit(2)
