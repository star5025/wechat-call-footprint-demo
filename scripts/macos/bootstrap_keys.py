#!/usr/bin/env python3
"""Create and debug a private temporary WeChat copy without changing the original."""

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time


def emit(kind, **values):
    print(json.dumps({"type": kind, **values}), flush=True)


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"command_failed: {Path(arguments[0]).name}")
    return result.stdout or result.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, default=Path("/Applications/WeChat.app"))
    parser.add_argument("--db-root", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--acknowledge-debug-copy", action="store_true")
    args = parser.parse_args()

    if not args.acknowledge_debug_copy:
        parser.error("requires --acknowledge-debug-copy after reading the project warning")
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("native Apple Silicon macOS is required")
    if os.geteuid() == 0:
        raise RuntimeError("do not run this helper with sudo")
    developer_mode = subprocess.run(
        ["/usr/sbin/DevToolsSecurity", "-status"], capture_output=True, text=True
    )
    developer_status = (developer_mode.stdout + developer_mode.stderr).lower()
    if developer_mode.returncode or "enabled" not in developer_status:
        raise RuntimeError(
            "macOS developer mode is disabled; run `sudo DevToolsSecurity -enable` "
            "in Terminal, then retry without sudo"
        )
    if subprocess.run(["pgrep", "-x", "WeChat"], capture_output=True).returncode == 0:
        raise RuntimeError("quit WeChat normally first; no process was stopped")

    application = args.app.resolve(strict=True)
    database_root = args.db_root.resolve(strict=True)
    if not list(database_root.rglob("*.db")):
        raise RuntimeError("the selected account has no databases")
    state = args.state_dir.resolve()
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(state, 0o700)
    keys = state / "keys.json"
    temporary_app = state / "WeChat-trial.app"
    disabled_app = state / "WeChat-trial.disabled"
    if keys.exists() or temporary_app.exists() or disabled_app.exists():
        raise RuntimeError("state already contains bootstrap data; select a new directory")

    os.umask(0o077)
    original_signature = run(["codesign", "-dvv", str(application)])
    (state / "original-signature.txt").write_text(original_signature, encoding="utf-8")
    original_executable = application / "Contents/MacOS/WeChat"
    run(["codesign", "--verify", "--deep", "--strict", str(application)])
    lldb_python = run(["xcrun", "lldb", "-P"]).strip()
    environment = {**os.environ, "PYTHONPATH": lldb_python}

    run(["ditto", str(application), str(temporary_app)])
    # Finder metadata and quarantine/resource-fork xattrs are not executable
    # content and can make ad-hoc signing of nested helpers fail. Only strip
    # them from the private copy; the original bundle remains untouched.
    run(["chmod", "-R", "u+w", str(temporary_app)])
    run(["xattr", "-cr", str(temporary_app)])
    run(["codesign", "--force", "--deep", "--sign", "-", str(temporary_app)])
    run(["codesign", "--verify", "--deep", "--strict", str(temporary_app)])
    emit(
        "copy_prepared",
        instruction="Use only the temporary window and complete local login confirmation if requested.",
    )

    return_code = 2
    try:
        command = [
            "/usr/bin/python3",
            str(Path(__file__).with_name("capture_keys.py")),
            "--exe",
            str(temporary_app / "Contents/MacOS/WeChat"),
            "--db-root",
            str(database_root),
            "--out",
            str(keys),
            "--timeout",
            str(args.timeout),
        ]
        process = subprocess.Popen(command, env=environment)
        try:
            return_code = process.wait()
        except KeyboardInterrupt:
            process.wait(timeout=15)
            return_code = 130
    finally:
        if run(["codesign", "-dvv", str(application)]) != original_signature:
            raise RuntimeError("original WeChat signature changed unexpectedly")
        running = subprocess.run(
            ["pgrep", "-x", "WeChat"], capture_output=True, text=True
        ).stdout.split()
        commands = [run(["ps", "-p", pid, "-o", "comm="]).strip() for pid in running]
        if any(str(temporary_app) in command for command in commands):
            emit("manual_restore_required", reason="the temporary process is still running")
        else:
            launch_services = (
                "/System/Library/Frameworks/CoreServices.framework/Frameworks/"
                "LaunchServices.framework/Support/lsregister"
            )
            subprocess.run([launch_services, "-u", str(temporary_app)], capture_output=True)
            temporary_app.rename(disabled_app)
            if not commands:
                restored = subprocess.Popen(
                    [str(original_executable)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                time.sleep(1)
                emit(
                    "original_launch_requested",
                    pid=restored.pid,
                    exited=restored.poll() is not None,
                )
            emit("original_signature_unchanged", temporary_bundle_disabled=True)

    if keys.exists():
        count = len(json.loads(keys.read_text(encoding="utf-8"))["keys"])
        emit(
            "keys_saved_privately",
            verified_databases=count,
            permissions=oct(keys.stat().st_mode & 0o777),
        )
    return return_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as caught:
        emit("bootstrap_error", reason=str(caught))
        raise SystemExit(2)
