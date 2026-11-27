import os from 'node:os';
import { runCommand } from '../lib/command-runner.mjs';

async function ps(script, timeoutMs = 16000) {
  if (process.platform !== 'win32') throw new Error('windows_host_required');
  const encoded = Buffer.from("$ErrorActionPreference='Stop'; " + script, 'utf16le').toString('base64');
  const result = await runCommand('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { timeoutMs, maxOutput: 36000 });
  if (result.timedOut) throw new Error('powershell_timeout');
  if (!result.ok || result.truncated) throw new Error('infrastructure_command_failed');
  try { return JSON.parse(result.output.trim() || 'null'); }
  catch { throw new Error('invalid_infrastructure_result'); }
}

function vmName(args) {
  if (typeof safeArgs.name !== 'string' || !/^[a-zA-Z0-9_. ()-]{1,80}$/.test(safeArgs.name)) {
    throw new Error('invalid_vm_name');
  }
  // The name cannot contain PowerShell quotation characters.
  return "'" + safeArgs.name + "'";
}

const json = script => `& { ${script} } | ConvertTo-Json -Depth 6 -Compress`;

export async function vmOperation(name, args = {}) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  if (name === 'mterm_vm_list') return ps(json('Get-VM | Select-Object Name,State,Generation,ProcessorCount,MemoryStartup,MemoryAssigned,Uptime'));
  if (name === 'mterm_vm_network_map') return ps(json('[pscustomobject]@{ switches=@(Get-VMSwitch | Select-Object Name,SwitchType,NetAdapterInterfaceDescription); adapters=@(Get-VMNetworkAdapter -All | Select-Object VMName,Name,SwitchName,MacAddress,Status,IPAddresses) }'));
  if (name === 'mterm_vm_disk_health') return ps(json('@(Get-VMHardDiskDrive -VMName (Get-VM).Name | ForEach-Object { $d=$_; $v=Get-VHD -Path $d.Path -ErrorAction Stop; [pscustomobject]@{vm=$d.VMName;path=$d.Path;size=$v.Size;fileSize=$v.FileSize;type=$v.VhdType} })'));
  if (name === 'mterm_vm_diagnostics') {
    const hours = safeArgs.hours === undefined ? 24 : safeArgs.hours;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('invalid_hours');
    return ps(json(`Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Hyper-V-VMMS-Admin';StartTime=(Get-Date).AddHours(-${hours});Level=2,3} -MaxEvents 40 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,LevelDisplayName,Message`));
  }
  const nameLiteral = vmName(args);
  if (name === 'mterm_vm_inspect') {
    return ps(json(`[pscustomobject]@{ vm=(Get-VM -Name ${nameLiteral} | Select-Object Name,State,Generation,ProcessorCount,MemoryStartup,MemoryAssigned,AutomaticStartAction,AutomaticStopAction); adapters=@(Get-VMNetworkAdapter -VMName ${nameLiteral} | Select-Object Name,SwitchName,MacAddress,Status,IPAddresses); disks=@(Get-VMHardDiskDrive -VMName ${nameLiteral} | Select-Object ControllerType,ControllerNumber,ControllerLocation,Path); checkpoints=@(Get-VMSnapshot -VMName ${nameLiteral} | Select-Object Name,CreationTime,SnapshotType) }`));
  }
  if (name === 'mterm_vm_change_plan') {
    if (!['start', 'shutdown', 'checkpoint'].includes(safeArgs.action)) throw new Error('invalid_vm_action');
    const inspected = await ps(json(`Get-VM -Name ${nameLiteral} | Select-Object Name,State`));
    return { previewOnly: true, vm: inspected, action: safeArgs.action,
      risk: safeArgs.action === 'checkpoint' ? 'Check available space on each attached disk volume; checkpoints may grow significantly.' :
        safeArgs.action === 'shutdown' ? 'A graceful shutdown can interrupt services running inside the guest.' : 'Starting a VM consumes host resources.',
      prerequisites: ['Global managed policy must allow writes.', 'VM power capability must be explicitly enabled.', 'The exact VM name must be confirmed.'] };
  }
  if (safeArgs.confirmName !== safeArgs.name) throw new Error('vm_confirmation_mismatch');
  if (name === 'mterm_vm_start') return ps(json(`Start-VM -Name ${nameLiteral} -Passthru | Select-Object Name,State`), 30000);
  if (name === 'mterm_vm_shutdown') return ps(json(`Stop-VM -Name ${nameLiteral} -Shutdown -Passthru | Select-Object Name,State`), 30000);
  if (name === 'mterm_vm_checkpoint_create') {
    // A failed or unmeasurable volume preflight blocks the checkpoint.
    const script = `$disks=@(Get-VMHardDiskDrive -VMName ${nameLiteral}); if($disks.Count -eq 0){throw 'No attached disks'}; foreach($disk in $disks){$drive=[IO.Path]::GetPathRoot($disk.Path); $letter=$drive.Substring(0,1); $volume=Get-PSDrive -Name $letter -ErrorAction Stop; if($null -eq $volume.Free -or $volume.Free -lt 10GB){throw 'Insufficient or unknown disk headroom'} }; $snapshot='MTerm-CLI-'+(Get-Date -Format yyyyMMdd-HHmmss); Checkpoint-VM -Name ${nameLiteral} -SnapshotName $snapshot -ErrorAction Stop; [pscustomobject]@{name=$snapshot;vm=${nameLiteral};created=$true}`;
    return ps(json(script), 30000);
  }
  throw new Error('unknown_vm_operation');
}

export async function systemOperation(name) {
  if (name === 'mterm_system_inventory') {
    const base = { platform: process.platform, release: os.release(), arch: os.arch(),
      cpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() };
    if (process.platform !== 'win32') return base;
    let hardware = null;
    try { hardware = await ps(json('[pscustomobject]@{gpus=@(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion);disks=@(Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystem,Size,SizeRemaining)}')); }
    catch { /* Host info remains useful if WMI is unavailable. */ }
    return { ...base, hardware };
  }
  if (name === 'mterm_container_list') {
    const docker = await runCommand('docker', ['ps', '-a', '--format', '{{json .}}'], { timeoutMs: 12000, maxOutput: 14000 });
    const wsl = process.platform === 'win32' ? await runCommand('wsl.exe', ['--list', '--quiet'], { timeoutMs: 10000, maxOutput: 4000 }) : null;
    return { docker: { available: docker.ok, output: docker.output, truncated: docker.truncated },
      wsl: wsl && { available: wsl.ok, output: wsl.output.replace(/\0/g, ''), truncated: wsl.truncated } };
  }
  throw new Error('unknown_system_operation');
}

export function bytesToGib(bytes, decimals = 2) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return 0;
  const places = typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 2;
  return Number((bytes / (1024 ** 3)).toFixed(places));
}

export function formatDurationSeconds(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 1000);
}

export function formatPercent(part, whole, decimals = 1) {
  if (typeof part !== "number" || typeof whole !== "number" || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0 || part < 0) return 0;
  const places = typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 1;
  return Number(((part / whole) * 100).toFixed(places));
}
