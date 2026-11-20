param([ValidateSet('Create','Raw','Delayed','Token')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$fixtureResult = $null
try {
    if ($env:MTERM_DISPOSABLE_REFERENCE_QUALIFICATION -ne '1' -or $env:GITHUB_ACTIONS -ne 'true' -or
        $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'fixture_disposable_host_required' }
    if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'fixture_preload_rejected' }
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $fixtureLine = [Console]::ReadLine()
    if (-not $fixtureLine -or $fixtureLine.Length -gt 65536) { throw 'fixture_input_invalid' }
    $fixtureInput = $fixtureLine | ConvertFrom-Json
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Security.Principal;

public sealed class ReferenceFixtureToken {
    public int elevationType, elevated, groups, prohibitedPrivileges;
    public bool administratorPresent, administratorDenyOnly, administratorEnabled, usersPresent;
}
public sealed class ReferenceFixturePipe : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
        public int nLength; public IntPtr descriptor; public int inherit;
    }
    [StructLayout(LayoutKind.Sequential)] struct Overlapped {
        public IntPtr internalLow, internalHigh; public uint offset, offsetHigh; public IntPtr signal;
    }
    [StructLayout(LayoutKind.Sequential)] struct Luid { public uint low; public int high; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateNamedPipeW(string name, uint openMode, uint mode, uint instances,
        uint outputSize, uint inputSize, uint timeout, ref SecurityAttributes security);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ConnectNamedPipe(IntPtr handle, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(IntPtr handle, IntPtr bytes, uint size, out uint count, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteFile(IntPtr handle, IntPtr bytes, uint size, out uint count, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetOverlappedResult(IntPtr handle, IntPtr overlapped, out uint count, bool wait);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CancelIoEx(IntPtr handle, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DisconnectNamedPipe(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateEventW(IntPtr security, bool manual, bool initial, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool ImpersonateNamedPipeClient(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool RevertToSelf();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint rights, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int length, out int required);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeNameW(string system, ref Luid luid, StringBuilder name, ref int length);
    IntPtr handle;
    public bool Connected { get; private set; }
    public int BytesRead { get; private set; }
    public string ClientSid { get; private set; }
    public int Error { get; private set; }
    public Task Completion { get; private set; }
    static int TokenInteger(IntPtr token, int kind) {
        IntPtr value = Marshal.AllocHGlobal(4);
        try { int length; if (!GetTokenInformation(token, kind, value, 4, out length) || length != 4) throw new Win32Exception();
            return Marshal.ReadInt32(value); } finally { Marshal.FreeHGlobal(value); }
    }
    public static ReferenceFixtureToken Token() {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            int length; GetTokenInformation(token, 2, IntPtr.Zero, 0, out length);
            if (length < 4 || length > 65536) throw new InvalidOperationException("fixture_token_invalid");
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try {
                int returned;
                if (!GetTokenInformation(token, 2, buffer, length, out returned) || returned > length) throw new Win32Exception();
                ReferenceFixtureToken result = new ReferenceFixtureToken();
                result.elevationType = TokenInteger(token, 18); result.elevated = TokenInteger(token, 20);
                result.groups = Marshal.ReadInt32(buffer);
                int offset = IntPtr.Size == 8 ? 8 : 4, stride = IntPtr.Size == 8 ? 16 : 8;
                if (result.groups < 0 || result.groups > 4096 || offset + result.groups * stride > returned) throw new InvalidOperationException("fixture_token_invalid");
                for (int index = 0; index < result.groups; index++) {
                    IntPtr item = IntPtr.Add(buffer, offset + index * stride), sid = Marshal.ReadIntPtr(item);
                    uint attributes = unchecked((uint)Marshal.ReadInt32(item, IntPtr.Size));
                    string sidText = new SecurityIdentifier(sid).Value;
                    if (sidText == "S-1-5-32-545" && (attributes & 4) != 0 && (attributes & 0x10) == 0) result.usersPresent = true;
                    if (sidText == "S-1-5-32-544") {
                        result.administratorPresent = true; result.administratorDenyOnly = (attributes & 0x10) != 0;
                        result.administratorEnabled = (attributes & 4) != 0;
                    }
                }
                int privilegeLength; GetTokenInformation(token, 3, IntPtr.Zero, 0, out privilegeLength);
                if (privilegeLength < 4 || privilegeLength > 65536) throw new InvalidOperationException("fixture_token_invalid");
                IntPtr privileges = Marshal.AllocHGlobal(privilegeLength);
                try {
                    if (!GetTokenInformation(token, 3, privileges, privilegeLength, out returned)) throw new Win32Exception();
                    int count = Marshal.ReadInt32(privileges);
                    if (count < 0 || count > 4096 || 4 + count * 12 > returned) throw new InvalidOperationException("fixture_token_invalid");
                    string prohibited = "|SeDebugPrivilege|SeBackupPrivilege|SeRestorePrivilege|SeTakeOwnershipPrivilege|SeImpersonatePrivilege|SeTcbPrivilege|SeAssignPrimaryTokenPrivilege|SeCreateTokenPrivilege|SeLoadDriverPrivilege|SeManageVolumePrivilege|SeSecurityPrivilege|";
                    for (int index = 0; index < count; index++) {
                        IntPtr item = IntPtr.Add(privileges, 4 + index * 12);
                        Luid luid = (Luid)Marshal.PtrToStructure(item, typeof(Luid));
                        StringBuilder name = new StringBuilder(256); int characters = name.Capacity;
                        if (!LookupPrivilegeNameW(null, ref luid, name, ref characters)) throw new Win32Exception();
                        if (prohibited.Contains("|" + name.ToString() + "|")) result.prohibitedPrivileges++;
                    }
                } finally { Marshal.FreeHGlobal(privileges); }
                return result;
            } finally { Marshal.FreeHGlobal(buffer); }
        } finally { CloseHandle(token); }
    }
    public ReferenceFixturePipe(string name, string sddl, bool first, bool rejectRemote) {
        IntPtr descriptor; uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out descriptor, out size)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            SecurityAttributes security = new SecurityAttributes();
            security.nLength = Marshal.SizeOf(typeof(SecurityAttributes)); security.descriptor = descriptor; security.inherit = 0;
            handle = CreateNamedPipeW(name, 3U | 0x40000000U | (first ? 0x00080000U : 0),
                rejectRemote ? 8U : 0U, 8, 8192, 2048, 2000, ref security);
            if (handle == new IntPtr(-1)) { handle = IntPtr.Zero; throw new Win32Exception(Marshal.GetLastWin32Error()); }
        } finally { LocalFree(descriptor); }
    }
    static IntPtr NewOverlapped(out IntPtr signal) {
        signal = CreateEventW(IntPtr.Zero, true, false, null);
        if (signal == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr memory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Overlapped)));
        Overlapped value = new Overlapped(); value.signal = signal;
        Marshal.StructureToPtr(value, memory, false); return memory;
    }
    static uint Finish(IntPtr pipe, IntPtr overlapped, IntPtr signal, int timeout) {
        uint count;
        if (WaitForSingleObject(signal, (uint)timeout) != 0) {
            CancelIoEx(pipe, overlapped); GetOverlappedResult(pipe, overlapped, out count, true);
            throw new Win32Exception(1460);
        }
        if (!GetOverlappedResult(pipe, overlapped, out count, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return count;
    }
    static byte[] Transfer(IntPtr pipe, byte[] payload, int size, bool write, int timeout) {
        IntPtr memory = Marshal.AllocHGlobal(Math.Max(1, size)), signal;
        IntPtr overlapped = NewOverlapped(out signal);
        try {
            if (write) Marshal.Copy(payload, 0, memory, size);
            uint count; bool done = write ? WriteFile(pipe, memory, (uint)size, out count, overlapped) : ReadFile(pipe, memory, (uint)size, out count, overlapped);
            if (!done) {
                int error = Marshal.GetLastWin32Error(); if (error != 997) throw new Win32Exception(error);
                count = Finish(pipe, overlapped, signal, timeout);
            }
            if (write && count != (uint)size) throw new Win32Exception(1117);
            byte[] result = new byte[count]; if (!write) Marshal.Copy(memory, result, 0, (int)count);
            return result;
        } finally { Marshal.FreeHGlobal(overlapped); CloseHandle(signal); Marshal.FreeHGlobal(memory); }
    }
    static byte[] ReadExact(IntPtr pipe, int length, int timeout, Action<int> observed = null) {
        using (MemoryStream result = new MemoryStream()) {
            while (result.Length < length) {
                byte[] part = Transfer(pipe, null, length - (int)result.Length, false, timeout);
                if (part.Length == 0) throw new Win32Exception(109);
                if (observed != null) observed(part.Length);
                result.Write(part, 0, part.Length);
            }
            return result.ToArray();
        }
    }
    public void Start(bool respond) {
        Completion = Task.Run(() => {
            IntPtr signal; IntPtr overlapped = NewOverlapped(out signal);
            try {
                if (!ConnectNamedPipe(handle, overlapped)) {
                    int error = Marshal.GetLastWin32Error();
                    if (error == 997) Finish(handle, overlapped, signal, 30000);
                    else if (error != 535) throw new Win32Exception(error);
                }
                Connected = true;
                byte[] header = ReadExact(handle, 4, 5000, count => { BytesRead += count; });
                uint size = BitConverter.ToUInt32(header, 0); if (size > 2048) throw new Win32Exception(87);
                byte[] payload = ReadExact(handle, (int)size, 5000, count => { BytesRead += count; });
                if (!ImpersonateNamedPipeClient(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
                try { ClientSid = WindowsIdentity.GetCurrent().User.Value; }
                finally { if (!RevertToSelf()) throw new Win32Exception(Marshal.GetLastWin32Error()); }
                if (respond) {
                    byte[] response = Encoding.UTF8.GetBytes("fixture-remote-control");
                    byte[] frame = new byte[response.Length + 4]; Buffer.BlockCopy(BitConverter.GetBytes(response.Length), 0, frame, 0, 4);
                    Buffer.BlockCopy(response, 0, frame, 4, response.Length); Transfer(handle, frame, frame.Length, true, 5000);
                }
            } catch (Win32Exception error) { Error = error.NativeErrorCode; }
              catch { Error = -1; }
            finally { Marshal.FreeHGlobal(overlapped); CloseHandle(signal); }
        });
    }
    public static IntPtr Open(string name) {
        // Individual rights deliberately exclude 0x4 FILE_CREATE_PIPE_INSTANCE.
        IntPtr result = CreateFileW(name, 0x00120183, 0, IntPtr.Zero, 3, 0x40110000, IntPtr.Zero);
        if (result == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return result;
    }
    public static void Send(IntPtr client, byte[] frame) { Transfer(client, frame, frame.Length, true, 5000); }
    public static byte[] Receive(IntPtr client) {
        byte[] header = ReadExact(client, 4, 8000); uint size = BitConverter.ToUInt32(header, 0);
        if (size > 8192) throw new Win32Exception(87); return ReadExact(client, (int)size, 8000);
    }
    public static void CloseClient(IntPtr client) { CancelIoEx(client, IntPtr.Zero); CloseHandle(client); }
    public void Dispose() {
        if (handle != IntPtr.Zero) {
            CancelIoEx(handle, IntPtr.Zero);
            if (Completion != null && !Completion.Wait(10000)) throw new InvalidOperationException("fixture_pipe_drain_timeout");
            DisconnectNamedPipe(handle); CloseHandle(handle); handle = IntPtr.Zero;
        }
    }
}
'@
    if ($Mode -eq 'Token') {
        $fixtureResult = [ReferenceFixturePipe]::Token()
    } elseif ($Mode -eq 'Create') {
        $fixturePipe = $null
        try {
            $fixturePipe = [ReferenceFixturePipe]::new([string]$fixtureInput.name, [string]$fixtureInput.sddl,
                [bool]$fixtureInput.first, [bool]$fixtureInput.rejectRemote)
            $fixturePipe.Start([bool]$fixtureInput.respond)
            [Console]::Out.WriteLine((@{ event = 'ready'; created = $true } | ConvertTo-Json -Compress))
            $null = [Console]::ReadLine()
            $fixturePipe.Dispose()
            $fixtureResult = @{ created = $true; connected = $fixturePipe.Connected; bytesRead = $fixturePipe.BytesRead;
                clientSid = $fixturePipe.ClientSid; error = $fixturePipe.Error; disposed = $true }
        } catch {
            $fixtureNativeError = $_.Exception
            while ($null -ne $fixtureNativeError.InnerException) { $fixtureNativeError = $fixtureNativeError.InnerException }
            if ($fixtureNativeError -isnot [ComponentModel.Win32Exception]) { throw 'fixture_create_failed' }
            $fixtureResult = @{ created = $false; error = $fixtureNativeError.NativeErrorCode }
        } finally { if ($null -ne $fixturePipe) { $fixturePipe.Dispose() } }
    } else {
        $fixtureHandle = [IntPtr]::Zero
        $fixtureConnected = $false; $fixtureWritten = $false
        try {
            $fixtureHandle = [ReferenceFixturePipe]::Open([string]$fixtureInput.name); $fixtureConnected = $true
            [ReferenceFixturePipe]::Send($fixtureHandle, [Convert]::FromBase64String([string]$fixtureInput.frame)); $fixtureWritten = $true
            if ($Mode -eq 'Delayed') {
                [Console]::Out.WriteLine((@{ event = 'first_written'; connected = $true } | ConvertTo-Json -Compress))
                $fixtureExtra = [Console]::ReadLine() | ConvertFrom-Json
                [ReferenceFixturePipe]::Send($fixtureHandle, [Convert]::FromBase64String([string]$fixtureExtra.frame))
                [Console]::Out.WriteLine('{"event":"extra_written","written":true}')
            }
            $fixtureResponse = [ReferenceFixturePipe]::Receive($fixtureHandle)
            $fixtureResult = @{ connected = $true; written = $true; responseBytes = $fixtureResponse.Length;
                responseSha256 = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash($fixtureResponse)); error = 0 }
        } catch {
            $fixtureNativeError = $_.Exception
            while ($null -ne $fixtureNativeError.InnerException) { $fixtureNativeError = $fixtureNativeError.InnerException }
            if ($fixtureNativeError -isnot [ComponentModel.Win32Exception]) { throw 'fixture_raw_failed' }
            $fixtureResult = @{ connected = $fixtureConnected; written = $fixtureWritten; responseBytes = 0; error = $fixtureNativeError.NativeErrorCode }
        } finally { if ($fixtureHandle -ne [IntPtr]::Zero) { [ReferenceFixturePipe]::CloseClient($fixtureHandle) } }
    }
    [Console]::Out.WriteLine((@{ ok = $true; result = $fixtureResult } | ConvertTo-Json -Compress -Depth 8))
} catch {
    [Console]::Out.WriteLine('{"ok":false,"error":"fixture_pipe_failed"}')
    exit 1
}
