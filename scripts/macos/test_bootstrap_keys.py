"""Synthetic-only tests. Run: python3 -B -m unittest discover -s scripts/macos -p 'test_*.py'."""

import contextlib
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent))
import bootstrap_keys as bootstrap
import capture_keys as capture


class SyntheticTests(unittest.TestCase):
    def test_system_tool_paths_exist_on_macos(self):
        if sys.platform != 'darwin':
            self.skipTest('macOS system paths')
        for tool in bootstrap.TOOLS.values():
            self.assertTrue(Path(tool).is_file(), tool)
            self.assertTrue(os.access(tool, os.X_OK), tool)

    def test_acknowledgement_required_before_actions(self):
        for module, argv in ((bootstrap, ['bootstrap', '--db-root', '/synthetic', '--state-dir', '/synthetic-state']), (capture, ['capture', '--exe', '/synthetic', '--db-root', '/synthetic', '--out', '/synthetic-output'])):
            with self.subTest(module=module.__name__), patch.object(sys, 'argv', argv), patch.object(module, 'native_user') as native, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    module.main()
                self.assertEqual(raised.exception.code, 2)
                native.assert_not_called()

    def test_missing_tool_rejected_before_paths(self):
        with patch.object(sys, 'argv', ['bootstrap', '--db-root', '/synthetic', '--state-dir', '/synthetic-state', '--acknowledge-debug-copy']), patch.object(bootstrap, 'native_user'), patch.object(Path, 'is_file', return_value=False), patch.object(bootstrap, 'checked_path') as paths:
            with self.assertRaises(RuntimeError):
                bootstrap.main()
            paths.assert_not_called()

    def test_capture_preflight_disabled_or_running_fails_closed(self):
        for results in (
            [SimpleNamespace(returncode=0, stdout='disabled', stderr='')],
            [SimpleNamespace(returncode=0, stdout='enabled', stderr=''), SimpleNamespace(returncode=1, stdout='', stderr='synthetic')],
            [SimpleNamespace(returncode=0, stdout='enabled', stderr=''), SimpleNamespace(returncode=0, stdout='', stderr=''), SimpleNamespace(returncode=0, stdout='123', stderr='')],
        ):
            with self.subTest(results=results), patch.object(Path, 'is_file', return_value=True), patch.object(capture.os, 'access', return_value=True), patch.object(capture.subprocess, 'run', side_effect=results):
                with self.assertRaises(RuntimeError):
                    capture.capture_preflight(Path('/synthetic.app'))

    def test_hmac_verification(self):
        key = bytes(range(32))
        page = bytearray((index % 251 for index in range(4096)))
        salt = bytes(value ^ 0x3A for value in page[:16])
        hkey = hashlib.pbkdf2_hmac('sha512', key, salt, 2, 32)
        page[4032:] = hmac.new(hkey, bytes(page[16:4032]) + b'\x01\0\0\0', hashlib.sha512).digest()
        self.assertTrue(capture.verified(key, bytes(page)))
        self.assertFalse(capture.verified(bytes(32), bytes(page)))
        page[32] ^= 1
        self.assertFalse(capture.verified(key, bytes(page)))
        self.assertFalse(capture.verified(key, bytes(page[:100])))

    def test_database_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / 'plain.db').write_bytes(b'SQLite format 3\0' + bytes(4080))
            (root / 'short.db').write_bytes(b'x')
            (root / 'synthetic.db').write_bytes(bytes(4096))
            rows = capture.encrypted_database_pages(root)
            self.assertEqual([row[0] for row in rows], ['synthetic.db'])

    def test_native_and_root_rejected(self):
        with patch.object(capture.platform, 'system', return_value='Windows'):
            with self.assertRaises(RuntimeError):
                capture.native_user()
        with patch.object(capture.platform, 'system', return_value='Darwin'), patch.object(capture.platform, 'machine', return_value='arm64'), patch.object(capture.os, 'geteuid', return_value=0, create=True):
            with self.assertRaises(RuntimeError):
                capture.native_user()

    def test_run_hides_command_output(self):
        result = SimpleNamespace(returncode=1, stdout='SYNTHETIC_PRIVATE', stderr='SYNTHETIC_PRIVATE')
        with patch.object(bootstrap.subprocess, 'run', return_value=result) as command:
            with self.assertRaises(RuntimeError) as raised:
                bootstrap.run(['/synthetic/tool'])
            self.assertNotIn('SYNTHETIC_PRIVATE', str(raised.exception))
            self.assertEqual(command.call_args.kwargs['timeout'], 30)

    def test_process_lookup_fails_closed(self):
        for code, output in ((2, ''), (0, ''), (0, 'not-a-pid')):
            with self.subTest(code=code, output=output), patch.object(bootstrap.subprocess, 'run', return_value=SimpleNamespace(returncode=code, stdout=output)):
                with self.assertRaises(RuntimeError):
                    bootstrap.running_commands()
        with patch.object(bootstrap.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
            self.assertEqual(bootstrap.running_commands(), [])

    def test_stop_capture_escalates_only_owned_child(self):
        process = MagicMock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('synthetic', 15), subprocess.TimeoutExpired('synthetic', 5), 0]
        with patch.object(bootstrap, 'emit') as emit, self.assertRaises(bootstrap.HelperError):
            bootstrap.stop_capture(process)
        emit.assert_called_once_with('manual_restore_required', reason='capture_forced_termination')
        process.send_signal.assert_called_once()
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertEqual(process.wait.call_count, 3)

    def test_stop_capture_term_success_still_requires_recovery(self):
        process = MagicMock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('synthetic', 15), 0]
        with patch.object(bootstrap, 'emit') as emit, self.assertRaises(bootstrap.HelperError):
            bootstrap.stop_capture(process)
        emit.assert_called_once_with('manual_restore_required', reason='capture_forced_termination')
        process.terminate.assert_called_once()
        process.kill.assert_not_called()
        self.assertEqual(process.wait.call_count, 2)

    def test_stop_capture_already_exited(self):
        process = MagicMock()
        process.poll.return_value = 0
        bootstrap.stop_capture(process)
        process.send_signal.assert_not_called()

    def test_atomic_publication_and_failure_cleanup_with_mocked_modes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(capture, 'private_directory'), patch.object(capture.os, 'fchmod', create=True), patch.object(capture.stat, 'S_IMODE', return_value=0o600):
            root = Path(directory).resolve()
            output = root / 'synthetic.json'
            identity = capture.write_private_json(output, {'keys': {}})
            with self.assertRaises(FileExistsError):
                capture.write_private_json(output, {'replacement': True})
            capture.write_private_json(output, {'updated': True}, identity)
            self.assertEqual(json.loads(output.read_text()), {'updated': True})
            with self.assertRaises(RuntimeError):
                capture.write_private_json(output, {}, (-1, -1))
            with patch.object(capture.json, 'dump', side_effect=OSError('synthetic')):
                with self.assertRaises(OSError):
                    capture.write_private_json(root / 'failure.json', {})
            self.assertEqual([p.name for p in root.iterdir()], ['synthetic.json'])

    def test_private_directory_rejects_owner_mode_or_access(self):
        directory = MagicMock()
        for owner, mode, writable in ((41, 0o700, True), (42, 0o755, True), (42, 0o700, False)):
            directory.stat.return_value = SimpleNamespace(st_uid=owner, st_mode=stat.S_IFDIR | mode)
            with self.subTest(owner=owner, mode=mode, writable=writable), patch.object(capture, 'checked_path', return_value=directory), patch.object(capture.os, 'geteuid', return_value=42, create=True), patch.object(capture.os, 'access', return_value=writable):
                with self.assertRaises(RuntimeError):
                    capture.private_directory(directory)

    @unittest.skipUnless(os.name == 'posix', 'requires POSIX ownership and mode semantics')
    def test_private_output_atomic_and_no_clobber(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            root.chmod(0o700)
            output = root / 'synthetic.json'
            identity = capture.write_private_json(output, {'keys': {}})
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                capture.write_private_json(output, {'replacement': True})
            capture.write_private_json(output, {'updated': True}, identity)
            self.assertEqual(json.loads(output.read_text()), {'updated': True})
            with self.assertRaises(RuntimeError):
                capture.write_private_json(output, {}, (-1, -1))
            with patch.object(capture.json, 'dump', side_effect=OSError('synthetic')):
                with self.assertRaises(OSError):
                    capture.write_private_json(root / 'failure.json', {})
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['synthetic.json'])

    @unittest.skipUnless(os.name == 'posix', 'requires POSIX symlinks and modes')
    def test_permissions_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            root.chmod(0o755)
            with self.assertRaises(RuntimeError):
                capture.private_directory(root)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o755)
            root.chmod(0o700)
            (root / 'link').symlink_to(root / 'absent')
            with self.assertRaises(RuntimeError):
                capture.write_private_json(root / 'link', {})
            bundle = root / 'copy.app'
            bundle.mkdir()
            (bundle / 'external').symlink_to(root)
            with self.assertRaises(RuntimeError):
                bootstrap.validate_bundle_links(bundle)
            (bundle / 'external').unlink()
            (bundle / 'real').mkdir()
            (bundle / 'internal').symlink_to(bundle / 'real')
            bootstrap.validate_bundle_links(bundle)

    def test_restore_refuses_changed_original_but_disables_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            copy = root / 'copy.app'
            copy.mkdir()
            disabled = root / 'disabled'
            with patch.object(bootstrap, 'run', side_effect=['', 'different', '']), patch.object(bootstrap, 'running_commands', return_value=[]), patch.object(bootstrap.subprocess, 'Popen') as launch:
                with self.assertRaises(RuntimeError):
                    bootstrap.restore_original(root / 'original.app', 'signature', copy, disabled, True)
                self.assertTrue(disabled.is_dir())
                launch.assert_not_called()

    def test_restore_never_stops_unrelated_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            copy = root / 'copy.app'
            copy.mkdir()
            disabled = root / 'disabled'
            with patch.object(bootstrap, 'run', return_value='signature'), patch.object(bootstrap, 'running_commands', return_value=['/unrelated/WeChat']), patch.object(bootstrap.subprocess, 'Popen') as launch:
                bootstrap.restore_original(root / 'original.app', 'signature', copy, disabled, True)
                self.assertTrue(disabled.is_dir())
                launch.assert_not_called()

    def test_restore_refuses_running_copy(self):
        copy = Path('/synthetic/copy.app')
        with patch.object(bootstrap, 'run', return_value='signature'), patch.object(bootstrap, 'running_commands', return_value=[str(copy / 'Contents/MacOS/WeChat')]), patch.object(bootstrap.subprocess, 'Popen') as launch:
            with self.assertRaises(RuntimeError):
                bootstrap.restore_original(Path('/original.app'), 'signature', copy, Path('/disabled'), True)
            launch.assert_not_called()

    def test_unregister_failure_still_disables_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            copy = root / 'copy.app'
            copy.mkdir()
            disabled = root / 'disabled'
            with patch.object(bootstrap, 'run', side_effect=['', 'signature', RuntimeError('synthetic')]), patch.object(bootstrap, 'running_commands', return_value=[]), patch.object(bootstrap.subprocess, 'Popen') as launch:
                with self.assertRaises(RuntimeError):
                    bootstrap.restore_original(root / 'original.app', 'signature', copy, disabled, True)
                self.assertTrue(disabled.is_dir())
                launch.assert_not_called()

    def test_original_launch_request_not_claimed_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with patch.object(bootstrap, 'run', return_value='signature'), patch.object(bootstrap, 'running_commands', return_value=[]), patch.object(bootstrap.subprocess, 'Popen') as launch, patch.object(bootstrap.time, 'sleep'):
                launch.return_value.pid = 123
                launch.return_value.poll.return_value = 1
                with self.assertRaises(RuntimeError):
                    bootstrap.restore_original(root / 'original.app', 'signature', root / 'absent', root / 'disabled', True)
                launch.assert_called_once()


class CaptureLifecycleTests(unittest.TestCase):
    def exercise(self, failure=None):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory).resolve()
            state = root / 'state'
            executable = state / 'WeChat-trial.app/Contents/MacOS/WeChat'
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b'synthetic')
            executable.chmod(0o700)
            databases = root / 'db'
            databases.mkdir()
            lldb = MagicMock()
            lldb.eStateExited, lldb.eStateInvalid, lldb.eStateDetached = 10, 0, 9
            lldb.eStateCrashed, lldb.eStateStopped = 8, 5
            debugger = lldb.SBDebugger.Create.return_value
            target = debugger.CreateTarget.return_value
            target.GetTriple.return_value = 'arm64-apple-macosx'
            process = target.Launch.return_value
            process.GetProcessID.return_value = 123
            target.BreakpointCreateByName.return_value.GetNumLocations.return_value = 1
            process.GetState.side_effect = [5, 10, 10]
            lldb.SBError.return_value.Fail.return_value = False
            process.Kill.return_value.Fail.return_value = False
            debugger.GetListener.return_value.WaitForEvent.side_effect = KeyboardInterrupt
            if failure == 'target':
                target.IsValid.return_value = False
            elif failure == 'launch':
                lldb.SBError.return_value.Fail.return_value = True
            elif failure == 'kill':
                process.Kill.return_value.Fail.return_value = True
            stack.enter_context(patch.dict(sys.modules, {'lldb': lldb}))
            stack.enter_context(patch.object(sys, 'argv', ['capture', '--exe', str(executable), '--db-root', str(databases), '--out', str(state / 'keys.json'), '--timeout', '10', '--acknowledge-debug-copy']))
            stack.enter_context(patch.object(capture, 'native_user'))
            stack.enter_context(patch.object(capture, 'capture_preflight'))
            stack.enter_context(patch.object(capture, 'private_directory'))
            stack.enter_context(patch.object(capture, 'encrypted_database_pages', return_value=[('synthetic.db', bytes(4096))]))
            stack.enter_context(patch.object(capture, 'install_cancel_handlers', return_value={}))
            stack.enter_context(patch.object(capture, 'restore_handlers'))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if failure == 'timeout':
                stack.enter_context(patch.object(capture.time, 'monotonic', side_effect=iter(range(0, 1000, 20))))
                self.assertEqual(capture.main(), 3)
                self.assertIn('capture_finished', output.getvalue())
            elif failure == 'launch':
                lldb.SBError.return_value.GetCString.return_value = 'SYNTHETIC_PRIVATE'
                self.assertEqual(capture.main(), 2)
                self.assertNotIn('SYNTHETIC_PRIVATE', output.getvalue())
            else:
                with self.assertRaises(RuntimeError if failure in ('target', 'kill') else KeyboardInterrupt):
                    capture.main()
            lldb.SBDebugger.Create.assert_called_once_with(False)
            lldb.SBDebugger.Destroy.assert_called_once_with(debugger)
            if failure != 'target':
                process.Kill.assert_called_once()
            else:
                target.Launch.assert_not_called()

    def test_cancel_closes_owned_process_and_debugger(self):
        self.exercise()

    def test_invalid_target_destroys_debugger(self):
        self.exercise('target')

    def test_launch_failure_cleans_valid_process(self):
        self.exercise('launch')

    def test_kill_failure_is_not_success(self):
        self.exercise('kill')

    def test_capture_timeout_is_not_success(self):
        self.exercise('timeout')


class BootstrapLifecycleTests(unittest.TestCase):
    def exercise(self, scenario):
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            root = Path(directory).resolve()
            app = root / 'original.app'
            exe = app / 'Contents/MacOS/WeChat'
            exe.parent.mkdir(parents=True)
            exe.write_bytes(b'synthetic original')
            exe.chmod(0o700)
            databases = root / 'db'
            databases.mkdir()
            modules = root / 'modules'
            modules.mkdir()
            tools = {name: str(root / name) for name in bootstrap.TOOLS}
            for name in tools.values():
                Path(name).write_bytes(b'synthetic tool, never executed')
                Path(name).chmod(0o700)
            state = root / 'state'
            argv = ['bootstrap', '--app', str(app), '--db-root', str(databases), '--state-dir', str(state), '--timeout', '10', '--acknowledge-debug-copy']
            if scenario == 'overlap':
                argv[argv.index('--state-dir') + 1] = str(app / 'state')
            if scenario == 'timeout_invalid':
                argv[argv.index('--timeout') + 1] = '301'
            def run(command, **kwargs):
                if command[0] == tools['developer']:
                    return 'Developer mode is enabled.'
                if command[0] == tools['xcrun']:
                    return str(modules)
                if command[0] == tools['ditto']:
                    if scenario == 'prepare_failure':
                        raise RuntimeError('synthetic preparation failure')
                    (state / 'WeChat-trial.app').mkdir()
                return 'synthetic signature'
            original_stat = Path.stat
            def path_stat(path, *args, **kwargs):
                info = original_stat(path, *args, **kwargs)
                if path == root:
                    values = list(info)
                    values[0], values[4] = stat.S_IFDIR | 0o700, 0
                    return os.stat_result(values)
                return info
            stack.enter_context(patch.object(sys, 'argv', argv))
            stack.enter_context(patch.object(bootstrap, 'native_user'))
            stack.enter_context(patch.object(bootstrap.os, 'geteuid', return_value=0, create=True))
            stack.enter_context(patch.object(Path, 'stat', path_stat))
            stack.enter_context(patch.dict(bootstrap.TOOLS, tools))
            stack.enter_context(patch.object(bootstrap, 'private_directory'))
            stack.enter_context(patch.object(bootstrap, 'encrypted_database_pages', return_value=[('synthetic.db', bytes(4096))]))
            stack.enter_context(patch.object(bootstrap, 'run', side_effect=run))
            stack.enter_context(patch.object(bootstrap, 'running_commands', return_value=[]))
            stack.enter_context(patch.object(bootstrap, 'install_cancel_handlers', return_value={}))
            stack.enter_context(patch.object(bootstrap, 'restore_handlers'))
            restore = stack.enter_context(patch.object(bootstrap, 'restore_original'))
            stop = stack.enter_context(patch.object(bootstrap, 'stop_capture'))
            launch = stack.enter_context(patch.object(bootstrap.subprocess, 'Popen'))
            if scenario == 'timeout':
                launch.return_value.wait.side_effect = subprocess.TimeoutExpired('synthetic', 40)
            elif scenario == 'cancel':
                launch.return_value.wait.side_effect = KeyboardInterrupt
            else:
                launch.return_value.wait.return_value = 0
            if scenario == 'restore_failure':
                restore.side_effect = RuntimeError('synthetic restore failure')
            if scenario == 'child_cleanup_failure':
                stop.side_effect = RuntimeError('synthetic child cleanup failure')
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if scenario in ('prepare_failure', 'overlap', 'timeout_invalid'):
                with self.assertRaises(RuntimeError):
                    bootstrap.main()
            else:
                result = bootstrap.main()
                self.assertEqual(result, {'timeout': 3, 'cancel': 130, 'restore_failure': 2, 'child_cleanup_failure': 2, 'success': 0}[scenario])
            if scenario in ('overlap', 'timeout_invalid'):
                restore.assert_not_called()
                launch.assert_not_called()
            else:
                restore.assert_called_once()
                if scenario == 'prepare_failure':
                    launch.assert_not_called()
                else:
                    stop.assert_called_once_with(launch.return_value)
                    self.assertEqual(launch.return_value.wait.call_args.kwargs['timeout'], 40)
                    if scenario in ('restore_failure', 'child_cleanup_failure'):
                        self.assertIn('manual_restore_required', output.getvalue())
                    if scenario == 'child_cleanup_failure':
                        self.assertFalse(restore.call_args.args[-1])
            self.assertEqual(exe.read_bytes(), b'synthetic original')

    def test_prepare_failure_enters_cleanup(self):
        self.exercise('prepare_failure')

    def test_timeout_is_bounded_and_cleaned(self):
        self.exercise('timeout')

    def test_cancel_is_cleaned(self):
        self.exercise('cancel')

    def test_restore_failure_returns_nonzero(self):
        self.exercise('restore_failure')

    def test_success_lifecycle(self):
        self.exercise('success')

    def test_unconfirmed_child_exit_refuses_original_launch(self):
        self.exercise('child_cleanup_failure')

    def test_path_overlap_rejected_before_copy(self):
        self.exercise('overlap')

    def test_timeout_range_rejected(self):
        self.exercise('timeout_invalid')


if __name__ == '__main__':
    unittest.main()
