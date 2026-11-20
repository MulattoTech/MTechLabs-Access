using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace MTechLabs.ReferenceTransport {
  public static class Native {
    const string SystemSid = "S-1-5-18", AdminSid = "S-1-5-32-544";
    const string InstallerSid = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    const uint ClientRights = 0x00120183; // data, attributes, READ_CONTROL, SYNCHRONIZE; never CREATE_PIPE_INSTANCE
    // The target policy also applies to selected directories, so it includes
    // DELETE_CHILD and is a strict superset of the ancestor replacement policy.
    const uint FileDanger = 0x500D0156, AncestorDanger = 0x500D0140;
    const int Lifetime = 30000;
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    static readonly string[] Sources = {
      "package.json", "inspect-dev-runtime.mjs", "reference-server.mjs", "manage-dev.ps1",
      "windows-reference.ps1", "windows-reference-native.cs", "windows-runtime-probe.ps1",
      "lib/reference-bootstrap.mjs", "lib/reference-transport.mjs", "lib/production-reference.mjs",
      "lib/dev-runtime-reference.mjs", "lib/runtime-files.mjs", "lib/runtime-identity.mjs",
      "lib/dev-runtime-plan.mjs", "lib/dev-instance.mjs", "lib/config.mjs", "lib/token.mjs"
    };
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {
      public uint Attributes; public FileTime Created, Accessed, Written;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int Length; public IntPtr Descriptor; public int Inherit; }
    [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder value, uint length, uint flags);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetKernelObjectSecurity(IntPtr handle, uint information, byte[] descriptor, uint length, out uint needed);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string value, uint revision, out IntPtr descriptor, out uint length);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint maximum, uint output, uint input, uint timeout, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CancelIoEx(SafePipeHandle handle, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool PeekNamedPipe(SafePipeHandle handle, IntPtr buffer, uint length, IntPtr read, out uint available, IntPtr remaining);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool ImpersonateNamedPipeClient(SafePipeHandle pipe);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool RevertToSelf();
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, byte[] information, int length, out int needed);
    [DllImport("advapi32.dll", EntryPoint="GetTokenInformation", SetLastError=true)] static extern bool GetTokenInformationPointer(IntPtr token, int kind, IntPtr information, int length, out int needed);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeNameW(string system, ref Luid luid, StringBuilder name, ref int size);

    static Exception Untrusted() { return new Exception("runtime_reference_bootstrap_untrusted"); }
    static Exception Unavailable() { return new Exception("runtime_reference_unavailable"); }
    static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) return String.Concat(sha.ComputeHash(bytes).Select(x => x.ToString("x2"))); }
    static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = 196608, RecursionLimit = 32 }; }
    static Dictionary<string, object> ObjectValue(object value) { var result = value as Dictionary<string, object>; if (result == null) throw Untrusted(); return result; }
    static string Field(Dictionary<string, object> value, string name) { object field; if (!value.TryGetValue(name, out field) || !(field is string)) throw Untrusted(); return (string)field; }
    static bool Hex(string value) { return value != null && value.Length == 64 && value.All(c => (c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')); }
    static bool Same(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
    static void OrdinaryDeclaration(string filename) {
      if (filename == null || filename.Length > 32760 || !System.Text.RegularExpressions.Regex.IsMatch(filename, @"^[A-Za-z]:[\\/]")) throw Untrusted();
      foreach (string part in filename.Substring(3).Split(new[] { '\\', '/' })) {
        if (part == "." || part == "..") continue;
        if (part.EndsWith(".") || part.EndsWith(" ") || part.Any(c => c < 32 || c == 127 || "<>:\"|?*".IndexOf(c) >= 0) ||
            System.Text.RegularExpressions.Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) throw Untrusted();
      }
    }
    static bool SystemPath(string path) {
      if (Same(path, Path.GetPathRoot(path))) return true;
      foreach (string root in new[] { @"C:\Windows", @"C:\Program Files", @"C:\Program Files (x86)" })
        if (Same(path, root) || path.StartsWith(root + @"\", StringComparison.OrdinalIgnoreCase)) return true;
      return false;
    }
    static bool TrustedSid(string sid, string path) { return sid == SystemSid || sid == AdminSid || (sid == InstallerSid && SystemPath(path)); }
    static RawSecurityDescriptor Descriptor(IntPtr handle) {
      uint needed;
      GetKernelObjectSecurity(handle, 5, null, 0, out needed);
      if (needed == 0 || needed > 65536) throw Untrusted();
      byte[] bytes = new byte[needed];
      if (!GetKernelObjectSecurity(handle, 5, bytes, needed, out needed)) throw Untrusted();
      return new RawSecurityDescriptor(bytes, 0);
    }
    static void ProtectedAcl(RawSecurityDescriptor security, string filename, bool target, bool privateFile, string authority) {
      if (security.Owner == null || !TrustedSid(security.Owner.Value, filename) || security.DiscretionaryAcl == null) throw Untrusted();
      uint danger = target ? FileDanger : AncestorDanger;
      foreach (GenericAce raw in security.DiscretionaryAcl) {
        CommonAce ace = raw as CommonAce;
        if (ace == null || ace.IsCallback || (ace.AceQualifier != AceQualifier.AccessAllowed && ace.AceQualifier != AceQualifier.AccessDenied)) throw Untrusted();
        if ((ace.AceFlags & AceFlags.InheritOnly) != 0 || ace.AceQualifier == AceQualifier.AccessDenied) continue;
        string sid = ace.SecurityIdentifier.Value;
        uint mask = unchecked((uint)ace.AccessMask);
        if (!TrustedSid(sid, filename) && (mask & danger) != 0) throw Untrusted();
        if (privateFile && !TrustedSid(sid, filename) && sid != authority && (mask & 0x90000001) != 0) throw Untrusted();
      }
    }
    static byte[] TokenInfo(IntPtr token, int kind) {
      int needed;
      GetTokenInformation(token, kind, null, 0, out needed);
      if (needed <= 0 || needed > 65536) throw Unavailable();
      byte[] value = new byte[needed];
      if (!GetTokenInformation(token, kind, value, value.Length, out needed)) throw Unavailable();
      return value;
    }
    static void StandardUser(WindowsIdentity identity) {
      if (identity.User == null) throw Unavailable();
      // WindowsIdentity.Groups omits deny-only and disabled groups. Inspect the
      // actual TokenGroups buffer so filtered administrator tokens cannot pass.
      int needed;
      GetTokenInformationPointer(identity.Token, 2, IntPtr.Zero, 0, out needed);
      if (needed < 4 || needed > 65536) throw Unavailable();
      IntPtr groups = Marshal.AllocHGlobal(needed);
      try {
        if (!GetTokenInformationPointer(identity.Token, 2, groups, needed, out needed)) throw Unavailable();
        int groupCount = Marshal.ReadInt32(groups);
        int first = IntPtr.Size, stride = IntPtr.Size == 8 ? 16 : 8;
        if (groupCount < 0 || groupCount > 4096 || needed < first + groupCount * stride) throw Unavailable();
        long beginning = groups.ToInt64(), end = beginning + needed;
        for (int i = 0; i < groupCount; i++) {
          IntPtr sid = Marshal.ReadIntPtr(groups, first + i * stride);
          long at = sid.ToInt64();
          if (at < beginning + first + groupCount * stride || at > end - 8) throw Unavailable();
          int subauthorities = Marshal.ReadByte(sid, 1);
          if (subauthorities > 15 || at + 8 + subauthorities * 4 > end || new SecurityIdentifier(sid).Value == AdminSid) throw Unavailable();
        }
      } finally { Marshal.FreeHGlobal(groups); }
      if (BitConverter.ToInt32(TokenInfo(identity.Token, 18), 0) != 1) throw Unavailable(); // no linked/full/limited token
      if (BitConverter.ToInt32(TokenInfo(identity.Token, 20), 0) != 0) throw Unavailable(); // TokenElevation
      byte[] privileges = TokenInfo(identity.Token, 3);
      int count = BitConverter.ToInt32(privileges, 0);
      if (count < 0 || count > 256 || privileges.Length < 4 + count * 12) throw Unavailable();
      var prohibited = new HashSet<string>(new[] { "SeDebugPrivilege", "SeBackupPrivilege", "SeRestorePrivilege", "SeTakeOwnershipPrivilege",
        "SeImpersonatePrivilege", "SeTcbPrivilege", "SeAssignPrimaryTokenPrivilege", "SeCreateTokenPrivilege", "SeLoadDriverPrivilege", "SeManageVolumePrivilege", "SeSecurityPrivilege" });
      for (int i = 0; i < count; i++) {
        Luid luid = new Luid { Low = BitConverter.ToUInt32(privileges, 4 + i * 12), High = BitConverter.ToInt32(privileges, 8 + i * 12) };
        var name = new StringBuilder(256); int length = name.Capacity;
        if (!LookupPrivilegeNameW(null, ref luid, name, ref length) || prohibited.Contains(name.ToString())) throw Unavailable();
      }
    }

    public sealed class Bootstrap : IDisposable {
      readonly List<IDisposable> held = new List<IDisposable>();
      readonly Dictionary<string, string> records = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      readonly Dictionary<string, byte[]> contents = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
      readonly Dictionary<string, SafeFileHandle> handles = new Dictionary<string, SafeFileHandle>(StringComparer.OrdinalIgnoreCase);
      readonly HashSet<string> checkedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      public string Trust, Registration, PrivateKey, NodePath, Sid, SnapshotSha256, AuthoritySid, DevelopmentSid, PipeName;
      public bool IsClient;
      void OpenAncestors(string filename) {
        string current = Path.GetDirectoryName(Path.GetFullPath(filename));
        var names = new List<string>();
        while (current != null) { names.Add(current); string parent = Path.GetDirectoryName(current); if (parent == current) break; current = parent; }
        names.Reverse();
        foreach (string name in names) Open(name, true, false, false, null, 0);
      }
      byte[] Open(string filename, bool directory, bool target, bool secret, string authority, int maximum) {
        OrdinaryDeclaration(filename);
        filename = Path.GetFullPath(filename);
        if (!System.Text.RegularExpressions.Regex.IsMatch(filename, @"^[A-Za-z]:\\") || filename.Length > 32760 ||
            GetDriveTypeW(Path.GetPathRoot(filename)) != 3) throw Untrusted();
        if (checkedPaths.Contains(filename)) {
          if (target || secret) ProtectedAcl(Descriptor(handles[filename].DangerousGetHandle()), filename, target, secret, authority);
          byte[] previous; return contents.TryGetValue(filename, out previous) ? previous : null;
        }
        uint access = directory ? 0x20080u : 0x80000000u;
        // Keep directory namespaces nondeletable, and immutable selected files
        // nonwritable/nondeletable, for this bootstrap/transport lifetime.
        IntPtr pointer = CreateFileW(filename, access, directory ? 3u : 1u, IntPtr.Zero, 3,
          0x00200000u | (directory ? 0x02000000u : 0u), IntPtr.Zero);
        var handle = new SafeFileHandle(pointer, true);
        if (handle.IsInvalid) { handle.Dispose(); throw Untrusted(); }
        held.Add(handle);
        handles[filename] = handle;
        FileInfo before;
        if (!GetFileInformationByHandle(handle, out before) || (before.Attributes & 0x400) != 0 ||
            ((before.Attributes & 0x10) != 0) != directory || (!directory && before.Links != 1)) throw Untrusted();
        var name = new StringBuilder(32768);
        uint count = GetFinalPathNameByHandleW(handle, name, (uint)name.Capacity, 0);
        if (count == 0 || count >= name.Capacity || !name.ToString().StartsWith(@"\\?\", StringComparison.Ordinal)) throw Untrusted();
        string canonical = name.ToString().Substring(4);
        if (!System.Text.RegularExpressions.Regex.IsMatch(canonical, @"^[A-Za-z]:\\")) throw Untrusted();
        RawSecurityDescriptor descriptor = Descriptor(handle.DangerousGetHandle());
        ProtectedAcl(descriptor, canonical, target, secret, authority);
        byte[] bytes = null;
        long size = ((long)before.SizeHigh << 32) | before.SizeLow;
        if (!directory) {
          if (size < 0 || size > maximum) throw Untrusted();
          {
            var stream = new FileStream(handle, FileAccess.Read, 65536, false);
            held.Remove(handle); held.Add(stream);
            bytes = new byte[(int)size]; int at = 0;
            while (at < bytes.Length) { int read = stream.Read(bytes, at, bytes.Length - at); if (read == 0) throw Untrusted(); at += read; }
            if (stream.ReadByte() != -1) throw Untrusted();
            FileInfo after;
            if (!GetFileInformationByHandle(handle, out after) || after.SizeHigh != before.SizeHigh || after.SizeLow != before.SizeLow ||
                after.Written.High != before.Written.High || after.Written.Low != before.Written.Low || after.Links != before.Links) throw Untrusted();
            // FileStream owns its SafeFileHandle; retain this stream instead of
            // disposing it while the selected bootstrap is in use.
            contents[filename] = bytes;
            records[filename] = canonical.ToLowerInvariant() + "|" + before.Volume + "|" + before.IndexHigh + "|" + before.IndexLow + "|" + size + "|" +
              before.Written.High + "|" + before.Written.Low + "|" + descriptor.GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access) + "|" + Hash(bytes);
            checkedPaths.Add(filename);
            GC.KeepAlive(stream);
          }
        } else {
          records[filename] = canonical.ToLowerInvariant() + "|" + before.Volume + "|" + before.IndexHigh + "|" + before.IndexLow + "|" +
            descriptor.GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
          checkedPaths.Add(filename);
        }
        return bytes;
      }
      byte[] File(string filename, int maximum, bool secret, string authority) {
        OrdinaryDeclaration(filename);
        OpenAncestors(filename); return Open(filename, false, true, secret, authority, maximum);
      }
      public Bootstrap(string installation, string role) {
        try {
          if (role != "Authority" && role != "Client") throw Untrusted();
          IsClient = role == "Client";
          string trustRoot = Path.Combine(installation, "reference-bootstrap"), trustFile = Path.Combine(trustRoot, "trust.json");
          OpenAncestors(trustFile); Open(trustRoot, true, true, false, null, 0);
          Trust = Utf8.GetString(File(trustFile, 32768, false, null));
          var document = ObjectValue(Json().DeserializeObject(Trust));
          AuthoritySid = Field(document, "authoritySid"); DevelopmentSid = Field(document, "developmentSid");
          if (AuthoritySid == DevelopmentSid || !AuthoritySid.StartsWith("S-1-5-21-") || !DevelopmentSid.StartsWith("S-1-5-21-")) throw Untrusted();
          new SecurityIdentifier(AuthoritySid); new SecurityIdentifier(DevelopmentSid);
          using (var identity = WindowsIdentity.GetCurrent()) {
            Sid = identity.User.Value;
            if (Sid != (IsClient ? DevelopmentSid : AuthoritySid)) throw Untrusted();
            if (IsClient) StandardUser(identity);
          }
          var pins = ObjectValue(document["sourceSha256"]);
          if (pins.Count != Sources.Length) throw Untrusted();
          foreach (string source in Sources) {
            string expected = Field(pins, source);
            if (!Hex(expected) || Hash(File(Path.Combine(installation, source.Replace('/', '\\')), 1048576, false, null)) != expected) throw Untrusted();
          }
          string declaredNode = Field(document, "nodePath"), nodeHash = Field(document, "nodeSha256");
          if (!Hex(nodeHash) || Hash(File(declaredNode, 268435456, false, null)) != nodeHash) throw Untrusted();
          using (var item = new FileStream(declaredNode, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            var name = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandleW(item.SafeFileHandle, name, (uint)name.Capacity, 0);
            if (length == 0 || length >= name.Capacity || !name.ToString().StartsWith(@"\\?\")) throw Untrusted();
            NodePath = name.ToString().Substring(4);
          }
          string digest = Field(document, "registrationSha256");
          if (!Hex(digest)) throw Untrusted();
          PipeName = @"\\.\pipe\mterm-dev-reference-v1-" + digest;
          if (!IsClient) {
            string privateRoot = Path.Combine(trustRoot, "authority");
            Open(privateRoot, true, true, true, AuthoritySid, 0);
            Registration = Utf8.GetString(File(Path.Combine(privateRoot, "registration.json"), 65536, true, AuthoritySid));
            PrivateKey = Convert.ToBase64String(File(Path.Combine(privateRoot, "signing-key.pk8"), 4096, true, AuthoritySid));
          }
          SnapshotSha256 = Hash(Utf8.GetBytes(String.Join("\n", records.OrderBy(x => x.Key, StringComparer.OrdinalIgnoreCase).Select(x => x.Value))));
        } catch { Dispose(); throw Untrusted(); }
      }
      public string JsonValue() {
        return Json().Serialize(new { schemaVersion = 1, trust = Trust, registration = Registration, privateKey = PrivateKey,
          nodePath = NodePath, sid = Sid, snapshotSha256 = SnapshotSha256,
          standardUser = IsClient ? (bool?)true : null,
          administratorGroup = IsClient ? (bool?)false : null,
          elevated = IsClient ? (bool?)false : null });
      }
      public void Dispose() { for (int i = held.Count - 1; i >= 0; i--) held[i].Dispose(); held.Clear(); }
    }

    static string PipeSddl(Bootstrap bootstrap) {
      return "O:" + bootstrap.AuthoritySid + "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;" + bootstrap.AuthoritySid + ")(A;;0x00120183;;;" + bootstrap.DevelopmentSid + ")";
    }
    static void VerifyPipe(SafePipeHandle pipe, Bootstrap bootstrap) {
      var security = Descriptor(pipe.DangerousGetHandle());
      if (security.Owner == null || security.Owner.Value != bootstrap.AuthoritySid || security.DiscretionaryAcl == null ||
          (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || security.DiscretionaryAcl.Count != 4) throw Unavailable();
      var expected = new Dictionary<string, uint> { { SystemSid, 0x001F01FF }, { AdminSid, 0x001F01FF },
        { bootstrap.AuthoritySid, 0x001F01FF }, { bootstrap.DevelopmentSid, ClientRights } };
      foreach (GenericAce raw in security.DiscretionaryAcl) {
        var ace = raw as CommonAce; uint mask;
        if (ace == null || ace.IsCallback || ace.AceQualifier != AceQualifier.AccessAllowed || ace.AceFlags != AceFlags.None ||
            !expected.TryGetValue(ace.SecurityIdentifier.Value, out mask) || unchecked((uint)ace.AccessMask) != mask) throw Unavailable();
        expected.Remove(ace.SecurityIdentifier.Value);
      }
      if (expected.Count != 0) throw Unavailable();
    }
    static NamedPipeServerStream NewServer(Bootstrap bootstrap, bool first) {
      IntPtr descriptor; uint length;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(PipeSddl(bootstrap), 1, out descriptor, out length)) throw Unavailable();
      try {
        var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor, Inherit = 0 };
        IntPtr pointer = CreateNamedPipeW(bootstrap.PipeName, 3u | 0x40000000u | (first ? 0x00080000u : 0u),
          8u, 8u, 8196u, 2052u, Lifetime, ref attributes); // byte mode + PIPE_REJECT_REMOTE_CLIENTS
        var handle = new SafePipeHandle(pointer, true);
        if (handle.IsInvalid) { handle.Dispose(); throw Unavailable(); }
        try { VerifyPipe(handle, bootstrap); return new NamedPipeServerStream(PipeDirection.InOut, true, false, handle); }
        catch { handle.Dispose(); throw; }
      } finally { LocalFree(descriptor); }
    }
    static void Authenticate(NamedPipeServerStream pipe, Bootstrap bootstrap) {
      bool impersonated = false;
      try {
        if (!ImpersonateNamedPipeClient(pipe.SafePipeHandle)) throw Unavailable();
        impersonated = true;
        using (var identity = WindowsIdentity.GetCurrent(true)) {
          if (identity == null || identity.User == null || identity.User.Value != bootstrap.DevelopmentSid ||
              identity.ImpersonationLevel != TokenImpersonationLevel.Identification) throw Unavailable();
          StandardUser(identity);
        }
      } finally {
        // No asynchronous operation or owner observation can execute while
        // impersonating. A failed revert terminates this helper immediately.
        if (impersonated && !RevertToSelf()) { Console.Error.WriteLine("runtime_reference_unavailable"); Environment.Exit(1); }
      }
    }
    static async Task<byte[]> ReadExact(Stream stream, int length, CancellationToken token) {
      byte[] result = new byte[length]; int at = 0;
      while (at < length) { int read = await stream.ReadAsync(result, at, length - at, token).ConfigureAwait(false); if (read == 0) throw Unavailable(); at += read; }
      return result;
    }
    static async Task<byte[]> ReadFrame(Stream stream, int maximum, CancellationToken token) {
      byte[] header = await ReadExact(stream, 4, token).ConfigureAwait(false);
      uint length = BitConverter.ToUInt32(header, 0);
      if (length == 0 || length > maximum) throw Unavailable();
      byte[] result = await ReadExact(stream, (int)length, token).ConfigureAwait(false);
      Utf8.GetString(result); return result;
    }
    static async Task WriteFrame(Stream stream, byte[] bytes, CancellationToken token) {
      byte[] header = BitConverter.GetBytes((uint)bytes.Length);
      await stream.WriteAsync(header, 0, header.Length, token).ConfigureAwait(false);
      await stream.WriteAsync(bytes, 0, bytes.Length, token).ConfigureAwait(false);
      await stream.FlushAsync(token).ConfigureAwait(false);
    }
    static string ReadLineBounded(int maximum) {
      var result = new StringBuilder();
      while (true) {
        int value = Console.In.Read();
        if (value < 0) return result.Length == 0 ? null : result.ToString();
        if (value == 10) return result.ToString().TrimEnd('\r');
        if (result.Length >= maximum) throw Unavailable();
        result.Append((char)value);
      }
    }

    sealed class Server : IDisposable {
      readonly Bootstrap bootstrap;
      readonly NamedPipeServerStream[] pipes = new NamedPipeServerStream[8];
      readonly CancellationTokenSource stopped = new CancellationTokenSource();
      readonly object output = new object(), pendingLock = new object();
      readonly Dictionary<long, TaskCompletionSource<byte[]>> pending = new Dictionary<long, TaskCompletionSource<byte[]>>();
      long sequence;
      public Server(Bootstrap value) {
        bootstrap = value;
        try { for (int i = 0; i < pipes.Length; i++) pipes[i] = NewServer(value, i == 0); }
        catch { Dispose(); throw; }
      }
      void Emit(string value) { lock (output) { Console.Out.WriteLine(value); Console.Out.Flush(); } }
      async Task Worker(NamedPipeServerStream pipe) {
        while (!stopped.IsCancellationRequested) {
          long id = 0;
          try {
            await pipe.WaitForConnectionAsync(stopped.Token).ConfigureAwait(false);
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(stopped.Token)) {
              deadline.CancelAfter(Lifetime);
              using (deadline.Token.Register(() => CancelIoEx(pipe.SafePipeHandle, IntPtr.Zero))) {
                byte[] request = await ReadFrame(pipe, 2048, deadline.Token).ConfigureAwait(false);
                uint extra;
                if (!PeekNamedPipe(pipe.SafePipeHandle, IntPtr.Zero, 0, IntPtr.Zero, out extra, IntPtr.Zero) || extra != 0) throw Unavailable();
                Authenticate(pipe, bootstrap);
                id = Interlocked.Increment(ref sequence);
                var completion = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
                lock (pendingLock) { pending.Add(id, completion); }
                Emit("Q " + id + " " + Convert.ToBase64String(request));
                Task<int> monitor = pipe.ReadAsync(new byte[1], 0, 1, deadline.Token);
                Task winner = await Task.WhenAny(completion.Task, monitor, Task.Delay(Lifetime, deadline.Token)).ConfigureAwait(false);
                bool cancelled = winner != completion.Task || deadline.IsCancellationRequested || monitor.IsCompleted;
                if (cancelled) {
                  Emit("C " + id);
                  CancelIoEx(pipe.SafePipeHandle, IntPtr.Zero);
                  try { await monitor.ConfigureAwait(false); } catch { }
                  try { pipe.Disconnect(); } catch { }
                  // Keep this connection slot reserved until the Node callback
                  // really settles, even after timeout/client disconnect.
                  try { await completion.Task.ConfigureAwait(false); } catch { }
                } else {
                  CancelIoEx(pipe.SafePipeHandle, IntPtr.Zero);
                  bool observedInput = false;
                  try { await monitor.ConfigureAwait(false); observedInput = true; } catch { }
                  if (observedInput) throw Unavailable();
                  byte[] response = await completion.Task.ConfigureAwait(false);
                  if (deadline.IsCancellationRequested) throw Unavailable();
                  uint trailing;
                  if (!PeekNamedPipe(pipe.SafePipeHandle, IntPtr.Zero, 0, IntPtr.Zero, out trailing, IntPtr.Zero) || trailing != 0) throw Unavailable();
                  await WriteFrame(pipe, response, deadline.Token).ConfigureAwait(false);
                  // DisconnectNamedPipe can discard unread buffered bytes. Keep
                  // the connection until the client closes after its full frame,
                  // or the same bounded deadline expires; never dispatch again.
                  int afterResponse = await pipe.ReadAsync(new byte[1], 0, 1, deadline.Token).ConfigureAwait(false);
                  if (afterResponse != 0) throw Unavailable();
                }
              }
            }
          } catch { if (id != 0) Emit("C " + id); }
          finally {
            if (id != 0) { lock (pendingLock) { pending.Remove(id); } }
            try { if (pipe.IsConnected) pipe.Disconnect(); } catch { }
          }
        }
      }
      public void Run() {
        Emit("READY " + bootstrap.SnapshotSha256);
        var workers = pipes.Select(pipe => Worker(pipe)).ToArray();
        try {
          while (true) {
            string line = ReadLineBounded(16384);
            if (line == null || line == "STOP") break;
            string[] parts = line.Split(' '); long id;
            if (parts.Length != 3 || !Int64.TryParse(parts[1], out id) || id <= 0 || (parts[0] != "R" && parts[0] != "E")) throw Unavailable();
            TaskCompletionSource<byte[]> completion;
            lock (pendingLock) { if (!pending.TryGetValue(id, out completion)) continue; }
            if (parts[0] == "E") completion.TrySetException(Unavailable());
            else {
              byte[] bytes = Convert.FromBase64String(parts[2]);
              if (bytes.Length == 0 || bytes.Length > 8192 || Convert.ToBase64String(bytes) != parts[2]) throw Unavailable();
              Utf8.GetString(bytes); completion.TrySetResult(bytes);
            }
          }
        } finally { Dispose(); try { Task.WaitAll(workers); } catch { } }
      }
      public void Dispose() {
        if (!stopped.IsCancellationRequested) stopped.Cancel();
        TaskCompletionSource<byte[]>[] completions;
        lock (pendingLock) { completions = pending.Values.ToArray(); }
        foreach (var entry in completions) entry.TrySetCanceled();
        foreach (var pipe in pipes) if (pipe != null) pipe.Dispose();
      }
    }
    public static void Serve(Bootstrap bootstrap) { if (bootstrap.IsClient) throw Untrusted(); using (var server = new Server(bootstrap)) server.Run(); }
    public static void Exchange(Bootstrap bootstrap) {
      if (!bootstrap.IsClient) throw Untrusted();
      Console.Out.WriteLine("READY " + bootstrap.SnapshotSha256); Console.Out.Flush();
      byte[] request;
      using (var memory = new MemoryStream()) {
        byte[] buffer = new byte[2049]; int length = 0, read;
        var input = Console.OpenStandardInput();
        while (length < buffer.Length && (read = input.Read(buffer, length, buffer.Length - length)) > 0) length += read;
        if (length == 0 || length > 2048) throw Unavailable();
        request = buffer.Take(length).ToArray(); Utf8.GetString(request);
      }
      // Identification-only SQOS prevents an authority from impersonating this
      // client to perform filesystem/process operations as the client.
      IntPtr pointer = CreateFileW(bootstrap.PipeName, ClientRights, 0, IntPtr.Zero, 3,
        0x40000000u | 0x00100000u | 0x00010000u, IntPtr.Zero);
      var handle = new SafePipeHandle(pointer, true);
      if (handle.IsInvalid) {
        int error = Marshal.GetLastWin32Error(); handle.Dispose();
        Console.Out.WriteLine("ERROR " + (error == 231 ? "runtime_reference_busy" : "runtime_reference_unavailable")); return;
      }
      using (handle) {
        VerifyPipe(handle, bootstrap);
        using (var pipe = new NamedPipeClientStream(PipeDirection.InOut, true, true, handle))
        using (var deadline = new CancellationTokenSource(Lifetime))
        using (deadline.Token.Register(() => CancelIoEx(handle, IntPtr.Zero))) {
          WriteFrame(pipe, request, deadline.Token).GetAwaiter().GetResult();
          byte[] response = ReadFrame(pipe, 8192, deadline.Token).GetAwaiter().GetResult();
          uint extra;
          if (!PeekNamedPipe(handle, IntPtr.Zero, 0, IntPtr.Zero, out extra, IntPtr.Zero) || extra != 0) throw Unavailable();
          VerifyPipe(handle, bootstrap);
          Console.Out.WriteLine("RESPONSE " + Convert.ToBase64String(response)); Console.Out.Flush();
        }
      }
    }
  }
}
