#!/usr/bin/env python3
"""Capture verified SQLCipher keys from one explicitly launched macOS process.

Derived from the MIT-licensed macOS WeChat 4.x local toolkit documented in
NOTICE.md. This helper never attaches to an existing process and never prints
key material.
"""

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import platform
import signal
import stat
import subprocess
import tempfile
import time


class HelperError(RuntimeError):
    """A fixed, public diagnostic safe to emit without private exception details."""


WARNING = (
    "The ad-hoc signed debug copy has reduced signature protection and can access "
    "real account data. It is not a sandbox: login, network and account changes "
    "may persist. Use only your own account; never edit messages in this copy. "
    "The original bundle is never modified. Developer mode is not changed by this helper. "
    "The retained .disabled bundle is still directly executable; remove that bundle after use."

)


def native_user():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise HelperError("native Apple Silicon macOS is required")
    if os.geteuid() == 0:
        raise HelperError("do not run this helper with sudo")


def checked_path(path, must_exist=True):
    path = Path(os.path.abspath(path))
    for component in (path, *path.parents):
        if component.is_symlink():
            raise HelperError("symlink paths are not permitted; use the canonical path")
    return path.resolve(strict=must_exist)


def private_directory(path):
    path = checked_path(path)
    info = path.stat()
    if not path.is_dir() or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise HelperError("state directory must be owned by this user with mode 0700")
    if not os.access(path, os.W_OK | os.X_OK):
        raise HelperError("state directory is not writable")
    return path


def cancel_on_signal(signum, frame):
    raise KeyboardInterrupt


def install_cancel_handlers():
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, cancel_on_signal)
    return previous


def restore_handlers(previous):
    for sig, handler in previous.items():
        signal.signal(sig, handler)


def defer_cancel(signum, frame):
    # Unlike SIG_IGN, a Python handler is reset to default across child exec.
    pass


def capture_preflight(bundle):
    commands = (
        ["/usr/sbin/DevToolsSecurity", "-status"],
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(bundle)],
        ["/usr/bin/pgrep", "-x", "WeChat"],
    )
    for index, command in enumerate(commands):
        if not Path(command[0]).is_file() or not os.access(command[0], os.X_OK):
            raise HelperError("required capture tool is unavailable")
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        status = (result.stdout + result.stderr).lower()
        if index == 2:
            if result.returncode != 1:
                raise HelperError("quit WeChat normally first; process lookup must succeed")
        elif result.returncode or (index == 0 and ("enabled" not in status or "disabled" in status)):
            raise HelperError("capture signature/developer prerequisites failed")


def emit(kind, **values):
    print(json.dumps({"type": kind, **values}), flush=True)


def verified(key, page):
    if len(key) != 32 or len(page) != 4096:
        return False
    hmac_salt = bytes(value ^ 0x3A for value in page[:16])
    hmac_key = hashlib.pbkdf2_hmac("sha512", key, hmac_salt, 2, 32)
    actual = hmac.new(
        hmac_key,
        page[16:4032] + b"\x01\x00\x00\x00",
        hashlib.sha512,
    ).digest()
    return hmac.compare_digest(actual, page[4032:4096])


def write_private_json(path, data, expected=None):
    destination = checked_path(path, must_exist=False)
    private_directory(destination.parent)
    if expected is not None:
        current = destination.lstat()
        if (current.st_dev, current.st_ino) != expected or stat.S_IMODE(current.st_mode) != 0o600:
            raise HelperError("private output changed unexpectedly")
    descriptor, name = tempfile.mkstemp(prefix=".keys-", dir=destination.parent)
    temporary = Path(name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = None
            json.dump(data, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        if expected is None:
            # Atomic no-clobber publication, including dangling symlinks.
            os.link(temporary, destination)
        else:
            os.replace(temporary, destination)
        info = destination.stat()
        return info.st_dev, info.st_ino
    finally:
        if descriptor is not None:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def encrypted_database_pages(root):
    rows = []
    if not root.is_dir() or not os.access(root, os.R_OK | os.X_OK):
        raise HelperError("database root must be a readable directory")
    for database in sorted(root.rglob("*.db")):
        checked_path(database)
        if not database.is_file():
            raise HelperError("database must be a regular file")
        with database.open("rb") as stream:
            page = stream.read(4096)
        if len(page) == 4096 and not page.startswith(b"SQLite format 3\0"):
            rows.append((str(database.relative_to(root)), page))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--db-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--acknowledge-debug-copy", action="store_true", help=WARNING)
    args = parser.parse_args()

    if not args.acknowledge_debug_copy:
        parser.error("requires --acknowledge-debug-copy: " + WARNING)
    native_user()
    if not 10 <= args.timeout <= 300:
        raise HelperError("timeout must be between 10 and 300 seconds")
    output = checked_path(args.out, must_exist=False)
    private_directory(output.parent)
    if os.path.lexists(output):
        raise HelperError("output already exists; select a new private path")
    executable = checked_path(args.exe)
    bundle = output.parent / "WeChat-trial.app"
    if executable != bundle / "Contents/MacOS/WeChat" or not executable.is_file() or not os.access(executable, os.X_OK):
        raise HelperError("only the private temporary bundle executable may be launched")
    root = checked_path(args.db_root)
    if root == output.parent or root in output.parents or output.parent in root.parents:
        raise HelperError("database and state directories must not overlap")
    rows = encrypted_database_pages(root)
    if not rows:
        raise HelperError("no encrypted database pages found")

    capture_preflight(bundle)
    salts = {page[:16] for _, page in rows}
    hmac_salts = {bytes(value ^ 0x3A for value in salt): salt for salt in salts}
    found = {}
    counts = {"pbkdf_calls": 0, "matched_salt_calls": 0}
    import lldb

    debugger = None
    process = None
    output_identity = None
    handlers = install_cancel_handlers()
    old_umask = os.umask(0o077)
    try:
        debugger = lldb.SBDebugger.Create(False)
        debugger.SetAsync(True)
        debugger.SkipLLDBInitFiles(True)
        debugger.SkipAppInitFiles(True)
        listener = debugger.GetListener()
        target = debugger.CreateTarget(str(executable))
        if not target.IsValid():
            raise HelperError("invalid launch target")
        if not target.GetTriple().startswith("arm64"):
            raise HelperError("only native Apple Silicon capture is supported")
        breakpoint = target.BreakpointCreateByName("CCKeyDerivationPBKDF")
        if not breakpoint.IsValid():
            raise HelperError("PBKDF breakpoint creation failed")

        launch = lldb.SBLaunchInfo([])
        for fd in (0, 1, 2):
            if not launch.AddSuppressFileAction(fd, fd == 0, fd != 0):
                raise HelperError("could not suppress target IO")
        launch.SetWorkingDirectory(str(executable.parent))
        error = lldb.SBError()
        process = target.Launch(launch, error)
        if error.Fail() or not process.IsValid():
            emit("launch_failed", error="debugger_launch_failed")
            return 2
        emit(
            "launched",
            pid=process.GetProcessID(),
            database_count=len(rows),
            breakpoint_locations=breakpoint.GetNumLocations(),
        )
        deadline = time.monotonic() + min(max(args.timeout, 10), 300)
        last_update = time.monotonic()

        def read_memory(address, size):
            read_error = lldb.SBError()
            data = process.ReadMemory(address, size, read_error)
            return bytes(data) if read_error.Success() and len(data) == size else b""

        while time.monotonic() < deadline:
            event = lldb.SBEvent()
            if not listener.WaitForEvent(1, event):
                if time.monotonic() - last_update > 15:
                    emit("waiting", verified_databases=len(found), **counts)
                    last_update = time.monotonic()
                continue
            if not lldb.SBProcess.EventIsProcessEvent(event):
                continue
            state = lldb.SBProcess.GetStateFromEvent(event)
            if state in (lldb.eStateExited, lldb.eStateCrashed, lldb.eStateDetached):
                emit("process_ended", state=state, exit_status=process.GetExitStatus())
                break
            if state == lldb.eStateStopped:
                for thread in process:
                    if thread.GetStopReason() != lldb.eStopReasonBreakpoint:
                        continue
                    if (
                        thread.GetStopReasonDataCount() < 2
                        or thread.GetStopReasonDataAtIndex(0) != breakpoint.GetID()
                    ):
                        continue
                    counts["pbkdf_calls"] += 1
                    frame = thread.GetFrameAtIndex(0)
                    register = lambda name: frame.FindRegister(name).GetValueAsUnsigned()
                    password_pointer, password_length, salt_pointer, salt_length, prf, rounds = [
                        register(f"x{index}") for index in range(1, 7)
                    ]
                    if not (
                        salt_length == 16
                        and 0 < password_length <= 256
                        and prf == 5
                        and rounds in (2, 256_000)
                    ):
                        continue
                    salt_argument = read_memory(salt_pointer, 16)
                    salt = salt_argument if rounds == 256_000 else hmac_salts.get(salt_argument)
                    if salt not in salts:
                        continue
                    counts["matched_salt_calls"] += 1
                    secret = read_memory(password_pointer, password_length)
                    if len(secret) != password_length:
                        continue
                    key = (
                        hashlib.pbkdf2_hmac("sha512", secret, salt, 256_000, 32)
                        if rounds == 256_000
                        else secret
                    )
                    if len(key) != 32:
                        continue
                    changed = False
                    for relative, page in rows:
                        if relative not in found and page[:16] == salt and verified(key, page):
                            found[relative] = {"enc_key": key.hex()}
                            changed = True
                    if changed:
                        output_identity = write_private_json(output, {"keys": found}, output_identity)
                        emit(
                            "verified_progress",
                            verified_databases=len(found),
                            total_databases=len(rows),
                            **counts,
                        )
                continue_error = process.Continue()
                if continue_error.Fail():
                    raise HelperError("could not resume launched process")
            if len(found) == len(rows):
                break
            if time.monotonic() - last_update > 15:
                emit("waiting", verified_databases=len(found), **counts)
                last_update = time.monotonic()

        emit(
            "capture_finished",
            verified_databases=len(found),
            total_databases=len(rows),
            **counts,
        )
        # Partial output remains private but is never reported as complete success.
        return 0 if len(found) == len(rows) else 3
    finally:
        try:
            for sig in handlers:
                signal.signal(sig, defer_cancel)
            if process is not None and process.IsValid():
                state = process.GetState()
                if state == lldb.eStateDetached:
                    emit("manual_restore_required", reason="owned_process_detached")
                    raise HelperError("owned process cleanup could not be confirmed")
                if state not in (lldb.eStateExited, lldb.eStateInvalid):
                    result = process.Kill()
                    if result.Fail():
                        emit("manual_restore_required", reason="owned_process_kill_failed")
                        raise HelperError("owned process cleanup failed")
                    deadline = time.monotonic() + 5
                    while process.GetState() != lldb.eStateExited and time.monotonic() < deadline:
                        time.sleep(0.05)
                    if process.GetState() != lldb.eStateExited:
                        raise HelperError("owned process exit was not confirmed")
                    emit("owned_process_closed", pid=process.GetProcessID())
        finally:
            try:
                if debugger is not None:
                    lldb.SBDebugger.Destroy(debugger)
            finally:
                restore_handlers(handlers)
                os.umask(old_umask)


if __name__ == "__main__":
    try:
        exit_code = main()
    except KeyboardInterrupt:
        emit("capture_cancelled")
        exit_code = 130
    except HelperError as caught:
        emit("capture_error", error=str(caught))
        exit_code = 2
    except Exception:
        emit("capture_error", error="capture_failed; check prerequisites and private state")
        exit_code = 2
    raise SystemExit(exit_code)
