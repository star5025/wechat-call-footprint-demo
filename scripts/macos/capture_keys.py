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
import time


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


def write_private_json(path, data):
    destination = Path(path)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(destination.parent, 0o700)
    temporary = destination.with_suffix(".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def encrypted_database_pages(root):
    rows = []
    for database in sorted(root.rglob("*.db")):
        with database.open("rb") as stream:
            page = stream.read(4096)
        if len(page) == 4096 and not page.startswith(b"SQLite format 3\0"):
            rows.append((str(database.relative_to(root)), page))
    return rows


def main():
    import lldb

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--db-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()

    if args.out.exists():
        raise RuntimeError("output already exists; select a new private path")
    executable = args.exe.resolve(strict=True)
    root = args.db_root.resolve(strict=True)
    rows = encrypted_database_pages(root)
    if not rows:
        raise RuntimeError("no encrypted database pages found")

    salts = {page[:16] for _, page in rows}
    hmac_salts = {bytes(value ^ 0x3A for value in salt): salt for salt in salts}
    found = {}
    counts = {"pbkdf_calls": 0, "matched_salt_calls": 0}
    os.umask(0o077)

    debugger = lldb.SBDebugger.Create()
    debugger.SetAsync(True)
    debugger.SkipLLDBInitFiles(True)
    listener = debugger.GetListener()
    target = debugger.CreateTarget(str(executable))
    if not target.IsValid():
        raise RuntimeError("invalid launch target")
    if not target.GetTriple().startswith("arm64"):
        raise RuntimeError("only native Apple Silicon capture is supported")
    breakpoint = target.BreakpointCreateByName("CCKeyDerivationPBKDF")
    if not breakpoint.IsValid():
        raise RuntimeError("PBKDF breakpoint creation failed")

    launch = lldb.SBLaunchInfo([])
    launch.AddSuppressFileAction(0, True, False)
    launch.AddSuppressFileAction(1, False, True)
    launch.AddSuppressFileAction(2, False, True)
    launch.SetWorkingDirectory(str(executable.parent))
    error = lldb.SBError()
    process = None

    try:
        process = target.Launch(launch, error)
        if error.Fail() or not process.IsValid():
            emit("launch_failed", error=error.GetCString())
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
                        write_private_json(args.out, {"keys": found})
                        emit(
                            "verified_progress",
                            verified_databases=len(found),
                            total_databases=len(rows),
                            **counts,
                        )
                continue_error = process.Continue()
                if continue_error.Fail():
                    raise RuntimeError("could not resume launched process")
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
        return 0 if found else 3
    finally:
        if (
            process is not None
            and process.IsValid()
            and process.GetState()
            not in (lldb.eStateExited, lldb.eStateDetached, lldb.eStateInvalid)
        ):
            process.Kill()
            emit("owned_process_closed", pid=process.GetProcessID())
        lldb.SBDebugger.Destroy(debugger)


if __name__ == "__main__":
    try:
        exit_code = main()
    except Exception as caught:
        emit("capture_error", error=str(caught))
        exit_code = 2
    raise SystemExit(exit_code)
