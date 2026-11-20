$ErrorActionPreference = 'Stop'

function Initialize-RuntimeNative {
    if ('MTechLabs.DevRuntime.ProcessSnapshot' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.Principal;
namespace MTechLabs.DevRuntime {
  public sealed class ProcessSnapshot : IDisposable {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr handle, uint flags, StringBuilder name, ref int length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("userenv.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserProfileDirectoryW(IntPtr token, StringBuilder profile, ref int length);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CommandLineToArgvW(string value, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    IntPtr process = IntPtr.Zero, token = IntPtr.Zero;
    public string Image, Sid, Profile, Created;
    public bool Alive { get { return process != IntPtr.Zero && WaitForSingleObject(process, 0) == 258; } }
    public ProcessSnapshot(int pid) {
      try {
        process = OpenProcess(0x00101000, false, pid); // limited query + synchronize only
        if (process == IntPtr.Zero || !Alive) throw new Exception("process_unavailable");
        var image = new StringBuilder(32768); int length = image.Capacity;
        if (!QueryFullProcessImageNameW(process, 0, image, ref length)) throw new Exception("image_unavailable");
        long created, exited, kernel, user;
        if (!GetProcessTimes(process, out created, out exited, out kernel, out user)) throw new Exception("time_unavailable");
        if (!OpenProcessToken(process, 8, out token)) throw new Exception("token_unavailable");
        using (var identity = new WindowsIdentity(token)) { Sid = identity.User.Value; }
        var profile = new StringBuilder(32768); length = profile.Capacity;
        if (!GetUserProfileDirectoryW(token, profile, ref length)) throw new Exception("profile_unavailable");
        Image = image.ToString(); Profile = profile.ToString(); Created = created.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (!Alive) throw new Exception("process_exited");
      } catch { Dispose(); throw; }
    }
    public void Dispose() {
      if (token != IntPtr.Zero) { CloseHandle(token); token = IntPtr.Zero; }
      if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
    }
    public static string[] Arguments(string command) {
      if (String.IsNullOrWhiteSpace(command) || command.Length > 32767 || command.IndexOf('\0') >= 0) return null;
      int count; IntPtr pointer = CommandLineToArgvW(command, out count);
      try {
        if (pointer == IntPtr.Zero || count != 4) return null;
        var result = new string[count];
        for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size));
        return result;
      } finally { if (pointer != IntPtr.Zero && LocalFree(pointer) != IntPtr.Zero) throw new Exception("argument_cleanup_failed"); }
    }
  }
}
'@ | Out-Null
}

function Test-RuntimePath {
    param([string]$Actual, [string]$Expected)
    if ($Actual -notmatch '^[A-Za-z]:[\\/]' -or $Expected -notmatch '^[A-Za-z]:[\\/]') { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($Actual), [IO.Path]::GetFullPath($Expected), [StringComparison]::OrdinalIgnoreCase)
}

function Test-RuntimeInvocation {
    param($Owner, $Expected, $Snapshot, [int]$ExpectedPid)
    try {
        if ($null -eq $Owner -or @($Owner).Count -ne 1 -or $Owner.ProcessId -ne $ExpectedPid -or
            -not (Test-RuntimePath $Owner.ExecutablePath $Expected.nodePath) -or
            -not (Test-RuntimePath $Snapshot.Image $Expected.nodePath)) { return $false }
        Initialize-RuntimeNative
        $arguments = [MTechLabs.DevRuntime.ProcessSnapshot]::Arguments($Owner.CommandLine)
        return $null -ne $arguments -and $arguments.Count -eq 4 -and
            (Test-RuntimePath $arguments[0] $Expected.nodePath) -and
            (Test-RuntimePath $arguments[1] $Expected.entryPath) -and
            [string]::Equals($arguments[2], '--config', [StringComparison]::Ordinal) -and
            (Test-RuntimePath $arguments[3] $Expected.configPath)
    } catch { return $false }
}

function Get-RuntimeNativeSnapshot {
    param([int]$ProcessId)
    Initialize-RuntimeNative
    return New-Object -TypeName MTechLabs.DevRuntime.ProcessSnapshot -ArgumentList $ProcessId
}

function Get-RuntimeListeners {
    param([int]$Port)
    # Query failures remain unknown. Filtering a successful table distinguishes
    # an absent listener without swallowing access/provider errors as absence.
    $rows = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port })
    $known = @('Closed', 'Listen', 'SynSent', 'SynReceived', 'Established', 'FinWait1', 'FinWait2',
        'CloseWait', 'Closing', 'LastAck', 'TimeWait', 'DeleteTCB', 'Bound')
    foreach ($row in $rows) {
        if ($null -eq $row.State -or [string]$row.State -notin $known) { throw 'listener_state_unavailable' }
        if ([string]$row.State -eq 'Listen') {
            if ($row.RemotePort -ne 0) { throw 'listener_state_inconsistent' }
            $row
        }
    }
}

function Get-RuntimeProcess {
    param([int]$ProcessId)
    $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop)
    if ($rows.Count -ne 1 -or $rows[0].ProcessId -ne $ProcessId -or $null -eq $rows[0].CreationDate) { throw 'process_unavailable' }
    return $rows[0]
}

function Test-RuntimeCreation {
    param($Owner, $Snapshot)
    try {
        # CIM datetime has microsecond precision; FILETIME has 100 ns units.
        # Decimal arithmetic avoids losing bits by converting FILETIME to double.
        $cimTime = ([datetime]$Owner.CreationDate).ToUniversalTime().ToFileTimeUtc()
        return [decimal]::Truncate([decimal]$cimTime / 10) -eq
            [decimal]::Truncate([decimal]::Parse($Snapshot.Created, [Globalization.CultureInfo]::InvariantCulture) / 10)
    } catch { return $false }
}

function Get-RuntimeListenerObservation {
    param($Expected)
    $snapshot = $null
    try {
        $listeners = @(Get-RuntimeListeners $Expected.port)
        if ($listeners.Count -eq 0) { return @{ status = 'absent' } }
        if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { return @{ status = 'unverified' } }
        $targetId = [int]$listeners[0].OwningProcess
        if ($targetId -le 0) { return @{ status = 'unverified' } }
        $before = Get-RuntimeProcess $targetId
        $snapshot = Get-RuntimeNativeSnapshot $targetId
        if (-not (Test-RuntimeCreation $before $snapshot) -or
            -not (Test-RuntimeInvocation $before $Expected $snapshot $targetId)) { return @{ status = 'unverified' } }
        $after = Get-RuntimeProcess $targetId
        $final = @(Get-RuntimeListeners $Expected.port)
        if ($before.CreationDate -ne $after.CreationDate -or -not $snapshot.Alive -or
            -not (Test-RuntimeCreation $after $snapshot) -or -not (Test-RuntimeInvocation $after $Expected $snapshot $targetId) -or
            $final.Count -ne 1 -or $final[0].LocalAddress -ne '127.0.0.1' -or $final[0].OwningProcess -ne $targetId) {
            return @{ status = 'unverified' }
        }
        return @{ status = 'observed'; pid = $targetId; sid = $snapshot.Sid; profileDirectory = $snapshot.Profile;
            creationFileTime = $snapshot.Created; invocationMatched = $true }
    } catch { return @{ status = 'unverified' } }
    finally { if ($null -ne $snapshot) { $snapshot.Dispose() } }
}

function Get-RuntimeCurrentObservation {
    param([int]$ParentId, [string]$ExpectedImage)
    $snapshot = $null
    try {
        $self = Get-RuntimeProcess $PID
        if ($self.ParentProcessId -ne $ParentId -or $ParentId -le 0) { return @{ status = 'unverified' } }
        $parent = Get-RuntimeProcess $ParentId
        $snapshot = Get-RuntimeNativeSnapshot $ParentId
        if (-not $snapshot.Alive -or -not (Test-RuntimeCreation $parent $snapshot) -or
            ([datetime]$parent.CreationDate) -gt ([datetime]$self.CreationDate) -or
            -not (Test-RuntimePath $snapshot.Image $ExpectedImage)) { return @{ status = 'unverified' } }
        return @{ status = 'observed'; pid = $ParentId; sid = $snapshot.Sid; profileDirectory = $snapshot.Profile;
            creationFileTime = $snapshot.Created }
    } catch { return @{ status = 'unverified' } }
    finally { if ($null -ne $snapshot) { $snapshot.Dispose() } }
}

try {
    # Only fixed numeric PID/port and expected path data; no executable command.
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $buffer = New-Object char[] 16385
    $length = 0
    while ($length -lt $buffer.Length) {
        $read = [Console]::In.Read($buffer, $length, $buffer.Length - $length)
        if ($read -eq 0) { break }
        $length += $read
    }
    if ($length -gt 16384) { throw 'input_too_large' }
    $raw = [string]::new($buffer, 0, $length)
    $inputData = $raw | ConvertFrom-Json
    $result = @{ schemaVersion = 1; current = Get-RuntimeCurrentObservation $inputData.currentProcessId $inputData.currentImage }
    if ($null -ne $inputData.production) { $result.production = Get-RuntimeListenerObservation $inputData.production }
    if ($null -ne $inputData.development) { $result.development = Get-RuntimeListenerObservation $inputData.development }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
} catch {
    [Console]::Error.WriteLine('runtime_observation_failed')
    exit 1
}
