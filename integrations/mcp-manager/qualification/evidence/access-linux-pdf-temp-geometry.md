# Linux PDF socket-path investigation

**Supported path-geometry hypothesis; the ad4 failure cause is not proven.** No upstream code was executed and no source or production state was changed.

The retained ad4 Linux results identify an owned root under `/home/runner/work/_temp`. Exact ad4 `qualificationEnvironment` code derives each lane's `temp` directory as TMPDIR; the published PDF implementation inherits the Linux environment and allocates its own profile under the temporary directory. The result receipts do not retain the actual browser binary/version or singleton socket path.

## Primary-source mechanism

Chromium's [process singleton source](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/process_singleton_posix.cc), reviewed blob `827a8a94b0a185638678d63e3e8f9f5e380cca28`, creates a temporary socket directory, checks mode0700, appends `SingletonSocket`, and rejects an address pathname at least as long as its socket-address field. The [Linux manual source](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/cd95675fc3e38b6175ecd568cca4c4694d3db76d/man7/unix.7) defines that field as108bytes; this Chromium path therefore permits at most107pathname bytes.

The reviewed [POSIX temporary-file implementation](https://chromium.googlesource.com/chromium/src/+/master/base/files/file_util_posix.cc), blob `1bc9e08aa3d59e05078b381f40013ce1156d55e7`, reads TMPDIR and uses the Google Chrome or Chromium brand plus six random characters for an empty-prefix temporary directory. Current code omits the leading dot for directories; older versions included it. Both variants exceed the cap here. These sources establish a mechanism, not identity with the unrecorded hosted browser binary.

## Derived path lengths

| Lane | Exact-source TMPDIR bytes | Current Chrome / older hidden Chrome socket bytes | Current Chromium / older hidden Chromium socket bytes | With proposed short prefix, worst socket bytes |
|---|---:|---:|---:|---:|
| Control | 72 | 113 /114 |117 /118 |97 |
| Candidate |74 |115 /116 |119 /120 |99 |

The proposed prefix change saves **21 bytes**:29bytes to8. It preserves the same random six-character mkdtemp allocation inside the same owned parent. The shorter paths fit this runner layout without a browser exception.

## Recommendation

A bounded experiment may shorten the active owned prefix to `mterm-q-`, update only its artifact glob, and add fixed `socket_path_too_long` and `process_singleton` diagnostic signals. Keep the change explicitly a hypothesis test. Preserve historical receipts, private modes, nonce/device/inode/link/containment checks, separate lanes and every existing Chrome/security/PDF/readback/cleanup gate.

Add an actual failing geometry regression based on the real workspace and lane-environment construction, the retained runner-parent byte length and the longest reviewed suffix. Do not test only a hard-coded prefix literal. Both upstream versions must freshly pass all real stages on Linux and Windows.

The observed ad4 messages are only693/695UTF-8 bytes with `browser_launch` and `filesystem_missing`, no error codes and no truncation. A missing-path signal could also come from an accompanying browser diagnostic. Chromium's [DBus source](https://chromium.googlesource.com/chromium/src/+/HEAD/dbus/bus.cc) logs the underlying connection error; an optional fixed DBus signal can separate such evidence. No specific DBus or singleton line has yet been observed.

The JSON report retains exact source/report hashes, source references and path calculations. No raw tool error text is stored.
