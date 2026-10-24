<#
  NoldOJ native sandbox host (Windows).
  Runs a single untrusted process inside a Job Object with CPU / memory /
  process-count limits and kill-on-close, created suspended and assigned to the
  job before it is resumed (prevents race-condition escapes).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File sandbox-host.ps1 <jobFile> <resultFile>

  The job file is JSON: { exe, args[], cwd, stdinFile, stdoutFile, stderrFile,
    timeLimitMs, memoryLimitKb, processLimit, lowIntegrity, restrictedToken }

  The result file is JSON: { ok, error, exitCode, timedOut, memoryExceeded,
    wallMs, cpuMs, memoryKb, tokenMode }
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$JobFile,
  [Parameter(Mandatory = $true)][string]$ResultFile
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class NoldSandbox
{
    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectExtendedLimitInformation = 9;

    const uint JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002;
    const uint JOB_OBJECT_LIMIT_JOB_TIME = 0x00000004;
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
        public int dwFlags; public short wShowWindow; public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess; public IntPtr hThread;
        public int dwProcessId; public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
        public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, IntPtr info, uint length, IntPtr retLen);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string appName, StringBuilder cmdLine, IntPtr procAttr, IntPtr threadAttr,
        bool inheritHandles, uint creationFlags, IntPtr env, string cwd,
        ref STARTUPINFO si, out PROCESS_INFORMATION pi);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr hThread);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr hObject, uint mask, uint flags);

    const uint HANDLE_FLAG_INHERIT = 0x00000001;

    static string Quote(string a)
    {
        if (a == null) a = "";
        if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return a;
        return "\"" + a.Replace("\"", "\\\"") + "\"";
    }

    public static string JsonEscape(string s)
    {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    public static string Result(bool ok, string error, int exitCode, bool timedOut, bool memExceeded,
        long wallMs, long cpuMs, long memKb, string tokenMode)
    {
        return "{\"ok\":" + (ok ? "true" : "false")
            + ",\"error\":\"" + JsonEscape(error) + "\""
            + ",\"exitCode\":" + exitCode
            + ",\"timedOut\":" + (timedOut ? "true" : "false")
            + ",\"memoryExceeded\":" + (memExceeded ? "true" : "false")
            + ",\"wallMs\":" + wallMs
            + ",\"cpuMs\":" + cpuMs
            + ",\"memoryKb\":" + memKb
            + ",\"tokenMode\":\"" + JsonEscape(tokenMode) + "\"}";
    }

    public static string Run(string exe, string[] args, string cwd, string stdinFile, string stdoutFile,
        string stderrFile, int timeLimitMs, int memoryLimitKb, int processLimit, bool restricted)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr envBlock = IntPtr.Zero;
        IntPtr siPtr = IntPtr.Zero;
        FileStream fin = null, fout = null, ferr = null;
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        string tokenMode = "normal";
        try
        {
            StringBuilder cmd = new StringBuilder();
            string exePath = exe;
            bool resolvedLocal = false;
            bool hasDir = exe.IndexOf('\\') >= 0 || exe.IndexOf('/') >= 0 || exe.IndexOf(':') >= 0;
            if (!hasDir && cwd != null)
            {
                string candidate = Path.Combine(cwd, exe);
                if (File.Exists(candidate)) { exePath = candidate; resolvedLocal = true; }
            }
            cmd.Append(Quote(exePath));
            foreach (string a in args)
            {
                cmd.Append(" ").Append(Quote(a));
            }
            string appName = resolvedLocal ? exePath : null;

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return Result(false, "CreateJobObject failed", 0, false, false, 0, 0, 0, tokenMode);

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            ext.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            if (timeLimitMs > 0)
            {
                ext.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_TIME | JOB_OBJECT_LIMIT_JOB_TIME;
                long ticks = (long)timeLimitMs * 10000L;
                ext.BasicLimitInformation.PerProcessUserTimeLimit = ticks;
                ext.BasicLimitInformation.PerJobUserTimeLimit = ticks;
            }
            if (memoryLimitKb > 0)
            {
                ext.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
                ext.ProcessMemoryLimit = (UIntPtr)((ulong)memoryLimitKb * 1024UL);
                ext.JobMemoryLimit = (UIntPtr)((ulong)memoryLimitKb * 1024UL);
            }
            if (processLimit > 0)
            {
                ext.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                ext.BasicLimitInformation.ActiveProcessLimit = (uint)processLimit;
            }
            int extSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr extPtr = Marshal.AllocHGlobal(extSize);
            Marshal.StructureToPtr(ext, extPtr, false);
            bool okLimits = SetInformationJobObject(job, JobObjectExtendedLimitInformation, extPtr, (uint)extSize);
            Marshal.FreeHGlobal(extPtr);
            if (!okLimits) return Result(false, "SetInformationJobObject failed: " + Marshal.GetLastWin32Error(), 0, false, false, 0, 0, 0, tokenMode);

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = (int)STARTF_USESTDHANDLES;

            fin = new FileStream(stdinFile, FileMode.OpenOrCreate, FileAccess.Read, FileShare.ReadWrite);
            fout = new FileStream(stdoutFile, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
            ferr = new FileStream(stderrFile, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
            si.hStdInput = fin.SafeFileHandle.DangerousGetHandle();
            si.hStdOutput = fout.SafeFileHandle.DangerousGetHandle();
            si.hStdError = ferr.SafeFileHandle.DangerousGetHandle();
            SetHandleInformation(si.hStdInput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            SetHandleInformation(si.hStdOutput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            SetHandleInformation(si.hStdError, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

            uint flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED;
            Stopwatch sw = new Stopwatch();
            sw.Start();
            bool created = CreateProcess(appName, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, envBlock, cwd, ref si, out pi);
            if (!created)
            {
                return Result(false, "CreateProcess failed: " + Marshal.GetLastWin32Error(), 0, false, false, 0, 0, 0, tokenMode);
            }

            if (!AssignProcessToJobObject(job, pi.hProcess))
            {
                TerminateJobObject(job, 1);
                return Result(false, "AssignProcessToJobObject failed: " + Marshal.GetLastWin32Error(), 0, false, false, 0, 0, 0, tokenMode);
            }

            ResumeThread(pi.hThread);

            uint wait = WaitForSingleObject(pi.hProcess, (uint)Math.Max(1, timeLimitMs + 2000));
            bool timedOut = wait == 0x102;
            if (timedOut) TerminateJobObject(job, 124);
            else if (wait == INFINITE) { }
            sw.Stop();

            uint exitCode = 0;
            GetExitCodeProcess(pi.hProcess, out exitCode);

            long cpuMs = 0;
            int acctSize = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr acctPtr = Marshal.AllocHGlobal(acctSize);
            if (QueryInformationJobObject(job, JobObjectBasicAccountingInformation, acctPtr, (uint)acctSize, IntPtr.Zero))
            {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION acct =
                    (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(acctPtr, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                cpuMs = (acct.TotalUserTime + acct.TotalKernelTime) / 10000L;
            }
            Marshal.FreeHGlobal(acctPtr);

            long memKb = 0;
            extSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            extPtr = Marshal.AllocHGlobal(extSize);
            if (QueryInformationJobObject(job, JobObjectExtendedLimitInformation, extPtr, (uint)extSize, IntPtr.Zero))
            {
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION info =
                    (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)Marshal.PtrToStructure(extPtr, typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                ulong peak = (ulong)info.PeakJobMemoryUsed;
                if (peak == 0) peak = (ulong)info.PeakProcessMemoryUsed;
                memKb = (long)(peak / 1024UL);
            }
            Marshal.FreeHGlobal(extPtr);

            bool memExceeded = memoryLimitKb > 0 && !timedOut && memKb >= (long)memoryLimitKb && exitCode != 0;

            return Result(true, "", (int)exitCode, timedOut, memExceeded, sw.ElapsedMilliseconds, cpuMs, memKb, tokenMode);
        }
        catch (Exception ex)
        {
            return Result(false, ex.GetType().Name + ": " + ex.Message, 0, false, false, 0, 0, 0, tokenMode);
        }
        finally
        {
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (job != IntPtr.Zero)
            {
                TerminateJobObject(job, 1);
                CloseHandle(job);
            }
            if (fin != null) fin.Dispose();
            if (fout != null) fout.Dispose();
            if (ferr != null) ferr.Dispose();
        }
    }

    public static bool IsElevated()
    {
        try
        {
            using (WindowsIdentity id = WindowsIdentity.GetCurrent())
            {
                return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
            }
        }
        catch { return false; }
    }
}
'@

try {
  Add-Type -TypeDefinition $source -Language CSharp | Out-Null
} catch {
  $err = @{ ok = $false; error = "Add-Type failed: $($_.Exception.Message)"; exitCode = 0; timedOut = $false; memoryExceeded = $false; wallMs = 0; cpuMs = 0; memoryKb = 0; tokenMode = 'none' } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($ResultFile, $err, (New-Object System.Text.UTF8Encoding($false)))
  exit 1
}

$job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json

$argsList = @()
if ($job.args) { $argsList = @($job.args) }

$workDir = if ($job.cwd) { $job.cwd } else { (Get-Location).Path }
$stdin = if ($job.stdinFile) { $job.stdinFile } else { [System.IO.Path]::GetTempFileName() }
$stdout = if ($job.stdoutFile) { $job.stdoutFile } else { [System.IO.Path]::GetTempFileName() }
$stderr = if ($job.stderrFile) { $job.stderrFile } else { [System.IO.Path]::GetTempFileName() }
$memKb = if ($job.memoryLimitKb) { [int]$job.memoryLimitKb } else { 0 }
$procLimit = if ($job.processLimit) { [int]$job.processLimit } else { 0 }

$result = [NoldSandbox]::Run(
  $job.exe, $argsList, $workDir, $stdin, $stdout, $stderr,
  [int]$job.timeLimitMs, $memKb, $procLimit, [bool]$job.restrictedToken
)

[System.IO.File]::WriteAllText($ResultFile, $result, (New-Object System.Text.UTF8Encoding($false)))
