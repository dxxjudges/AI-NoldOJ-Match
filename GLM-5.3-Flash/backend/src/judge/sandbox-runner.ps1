# NoldOJ Windows Sandbox Runner (PowerShell 5.1 compatible)
#
# Native three-layer security architecture:
#   L1: SUSPENDED CreateProcess -> AssignProcessToJobObject BEFORE ResumeThread
#       (prevents race-condition escape; breakaway not enabled => children cannot escape)
#   L2: Restricted token (DISABLE_MAX_PRIVILEGE strips SeDebug/SeImpersonate/etc.)
#       + Low integrity level (S-1-16-4096). Safe fallback to plain token on API failure.
#   L3: Job Object fallback limits: process count / memory / CPU time,
#       KILL_ON_JOB_CLOSE force-terminates the whole process tree on exit.
#
# Output: JSON line on stdout: {exitCode,timeMs,memoryKb,cpuMs,mode}
param(
  [string]$Target = '',
  [string]$TargetArgs = '[]',
  [string]$InputPath = '',
  [string]$OutputPath = '',
  [int]$TimeLimitMs = 1000,
  [int]$MemoryLimitMB = 256,
  [int]$ProcessLimit = 64
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($Target)) {
  Write-Output '{"error":"no_target","exitCode":-1,"timeMs":0,"memoryKb":0,"cpuMs":0,"mode":"fallback"}'
  exit 0
}

$type = @'
using System;
using System.Runtime.InteropServices;

namespace NoldOJ {
public static class Runner {
  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFOW {
    public uint cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput, hStdOutput, hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime, TotalKernelTime;
    public long ThisProcessTotalUserTime, ThisProcessTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }

  const uint CREATE_SUSPENDED = 0x4;
  const uint STARTF_USESTDHANDLES = 0x100;
  const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
  const uint FILE_SHARE_READ = 0x1;
  const uint OPEN_EXISTING = 3, CREATE_ALWAYS = 2;
  const int JOB_OBJECT_LIMIT_PROCESS_TIME = 0x2;
  const int JOB_OBJECT_LIMIT_JOB_TIME = 0x4;
  const int JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x10;
  const int JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100;
  const int JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200;
  const int JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  const int JobObjectExtendedLimitInformation = 9;
  const int JobObjectBasicAccountingInformation = 1;
  const uint TOKEN_DUPLICATE = 0x2, TOKEN_ASSIGN_PRIMARY = 0x1, TOKEN_QUERY = 0x8;
  const int TokenPrimary = 1;
  const int TokenIntegrityLevel = 25;

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string app, string cmd, ref SECURITY_ATTRIBUTES pa, ref SECURITY_ATTRIBUTES ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUserW(IntPtr tok, string app, string cmd, ref SECURITY_ATTRIBUTES pa, ref SECURITY_ATTRIBUTES ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr h, out uint code);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr h);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr h);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr a, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProc);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, out JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size, IntPtr ret);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int size, IntPtr ret);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr hJob, uint code);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr h, uint ms);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint disp, uint flags, IntPtr tmpl);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr h, uint desired, out IntPtr tokh);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool DuplicateTokenEx(IntPtr tok, uint desired, IntPtr attrs, int impLevel, int type, out IntPtr outTok);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(IntPtr tok, uint flags, uint numSid, IntPtr sids, uint numPriv, IntPtr privs, uint numAttr, IntPtr attrs, out IntPtr outTok);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr tok, int cls, IntPtr info, uint len);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool ConvertStringSidToSidW(string sid, out IntPtr psid);

  static readonly IntPtr INVALID = new IntPtr(-1);

  // Build the low-integrity token label buffer "S-1-16-4096"
  static IntPtr MakeIntegrityLabelBuffer(out IntPtr sidPtr) {
    IntPtr sid;
    if (!ConvertStringSidToSidW("S-1-16-4096", out sid)) { sidPtr = IntPtr.Zero; return IntPtr.Zero; }
    sidPtr = sid;
    var label = new TOKEN_MANDATORY_LABEL();
    label.Label.Sid = sid;
    label.Label.Attributes = 0;
    IntPtr buf = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)));
    Marshal.StructureToPtr(label, buf, false);
    return buf;
  }

  public static string Run(string target, string argsJson, string inputPath, string outputPath, int timeMs, int memMB, int procLimit) {
    string mode = "fallback";
    uint exitCode = 4294967295u;
    long peakMemBytes = 0, cpuMs = 0;
    IntPtr job = IntPtr.Zero, tok = IntPtr.Zero, dTok = IntPtr.Zero, rTok = IntPtr.Zero;
    IntPtr hIn = IntPtr.Zero, hOut = IntPtr.Zero, hErr = IntPtr.Zero, sidPtr = IntPtr.Zero;
    var pi = new PROCESS_INFORMATION();
    try {
      var sa = new SECURITY_ATTRIBUTES();
      sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
      sa.bInheritHandle = 1;
      sa.lpSecurityDescriptor = IntPtr.Zero;

      // --- stdio as inheritable handles ---
      string inName = (inputPath != null && inputPath.Length > 0) ? inputPath : "NUL";
      hIn = CreateFileW(inName, GENERIC_READ, FILE_SHARE_READ, ref sa, OPEN_EXISTING, 0, IntPtr.Zero);
      hOut = CreateFileW(outputPath, GENERIC_WRITE, 0, ref sa, CREATE_ALWAYS, 0, IntPtr.Zero);
      hErr = CreateFileW(outputPath + ".err", GENERIC_WRITE, 0, ref sa, CREATE_ALWAYS, 0, IntPtr.Zero);
      if (hIn == INVALID || hIn == IntPtr.Zero || hOut == INVALID || hOut == IntPtr.Zero) {
        return "{\"error\":\"stdio_open_failed\",\"exitCode\":-1,\"timeMs\":0,\"memoryKb\":0,\"cpuMs\":0,\"mode\":\"fallback\"}";
      }

      var si = new STARTUPINFOW();
      si.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOW));
      si.dwFlags = STARTF_USESTDHANDLES;
      si.hStdInput = hIn; si.hStdOutput = hOut; si.hStdError = hErr;

      // --- command line: quoted target + JSON array args ---
      string cmdline = "\"" + target + "\"";
      if (!string.IsNullOrEmpty(argsJson) && argsJson != "[]") {
        string seg = argsJson.Trim();
        if (seg.StartsWith("[")) seg = seg.Substring(1, seg.Length - 2);
        string cur = null; bool inQ = false;
        var parts = new System.Collections.Generic.List<string>();
        for (int i = 0; i < seg.Length; i++) {
          char c = seg[i];
          if (c == '"') { inQ = !inQ; continue; }
          if (c == ',' && !inQ) { if (cur != null) { parts.Add(cur.Trim()); cur = null; } continue; }
          if (cur == null) cur = ""; cur += c;
        }
        if (cur != null && cur.Trim().Length > 0) parts.Add(cur.Trim());
        foreach (string p in parts) {
          string v = p.Replace("\"", "");
          if (v.Length > 0) cmdline += " \"" + v + "\"";
        }
      }

      // --- L2: restricted token attempt ---
      bool usedToken = false;
      try {
        OpenProcessToken(new IntPtr(-1) /* pseudo-current */, TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY, out tok);
        if (tok != IntPtr.Zero && tok != INVALID) {
          if (DuplicateTokenEx(tok, MAX_ALLOWED, IntPtr.Zero, SecurityIdentificationInt, TokenPrimary, out dTok)) {
            uint rflags = 0x1; // DISABLE_MAX_PRIVILEGE: strips SeDebug/SeImpersonate/etc.
            if (CreateRestrictedToken(dTok, rflags, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out rTok)) {
              IntPtr labBuf = MakeIntegrityLabelBuffer(out sidPtr);
              if (labBuf != IntPtr.Zero) {
                SetTokenInformation(rTok, TokenIntegrityLevel, labBuf, (uint)Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)));
                if (CreateProcessAsUserW(rTok, target, cmdline, ref sa, ref sa, true, CREATE_SUSPENDED, IntPtr.Zero, null, ref si, out pi)) {
                  mode = "sandbox";
                  usedToken = true;
                }
              }
            }
          }
        }
      } catch {
        usedToken = false; // safe fallback below
      }

      // --- fallback CreateProcess (still suspended first) ---
      if (!usedToken) {
        if (!CreateProcessW(target, cmdline, ref sa, ref sa, true, CREATE_SUSPENDED, IntPtr.Zero, null, ref si, out pi)) {
          return "{\"error\":\"create_process_failed\",\"exitCode\":-1,\"timeMs\":0,\"memoryKb\":0,\"cpuMs\":0,\"mode\":\"fallback\"}";
        }
      }

      // --- L3: job object BEFORE resume (race-condition-safe binding) ---
      job = CreateJobObjectW(IntPtr.Zero, null);
      if (job == IntPtr.Zero || job == INVALID) {
        ResumeThread(pi.hThread);
        var swNoJob = System.Diagnostics.Stopwatch.StartNew();
        WaitForSingleObject(pi.hProcess, (uint)timeMs + 100);
        GetExitCodeProcess(pi.hProcess, out exitCode);
        return "{\"exitCode\":" + exitCode + ",\"timeMs\":" + swNoJob.ElapsedMilliseconds + ",\"memoryKb\":0,\"cpuMs\":0,\"mode\":\"no-job\"}";
      }
      var jli = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      jli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_TIME | JOB_OBJECT_LIMIT_JOB_TIME |
          JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY |
          JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      jli.BasicLimitInformation.ActiveProcessLimit = (uint)Math.Max(1, procLimit);
      jli.BasicLimitInformation.PerJobUserTimeLimit = (long)timeMs * 10000; // 100ns units
      jli.ProcessMemoryLimit = (UIntPtr)((ulong)memMB * 1024UL * 1024UL);
      jli.JobMemoryLimit = jli.ProcessMemoryLimit;
      SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref jli, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
      AssignProcessToJobObject(job, pi.hProcess);

      ResumeThread(pi.hThread);

      var sw = System.Diagnostics.Stopwatch.StartNew();
      while (true) {
        uint w = WaitForSingleObject(pi.hProcess, 10);
        if (w == 0 /*WAIT_OBJECT_0*/) break;
        if (sw.ElapsedMilliseconds >= (uint)timeMs) {
          TerminateJobObject(job, 0x99);
          break;
        }
      }
      GetExitCodeProcess(pi.hProcess, out exitCode);

      var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      QueryInformationJobObject(job, JobObjectExtendedLimitInformation, out ext, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)), IntPtr.Zero);
      peakMemBytes = (long)(ulong)ext.PeakProcessMemoryUsed;

      var acc = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
      QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out acc, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero);
      cpuMs = acc.TotalUserTime / 10000;

      return "{\"exitCode\":" + exitCode + ",\"timeMs\":" + sw.ElapsedMilliseconds + ",\"memoryKb\":" + (peakMemBytes / 1024) + ",\"cpuMs\":" + cpuMs + ",\"mode\":\"" + mode + "\"}";
    } catch (Exception e) {
      string msg = e.Message.Replace("\\", "/").Replace("\"", "'");
      return "{\"error\":\"" + msg + "\",\"exitCode\":" + exitCode + ",\"timeMs\":0,\"memoryKb\":0,\"cpuMs\":0,\"mode\":\"" + mode + "\"}";
    } finally {
      if (job != IntPtr.Zero && job != INVALID) { TerminateJobObject(job, 0); CloseHandle(job); } // whole tree killed
      if (pi.hProcess != IntPtr.Zero && pi.hProcess != INVALID) CloseHandle(pi.hProcess);
      if (pi.hThread != IntPtr.Zero && pi.hThread != INVALID) CloseHandle(pi.hThread);
      foreach (IntPtr h in new IntPtr[] { hIn, hOut, hErr, tok, dTok, rTok, sidPtr }) {
        if (h != IntPtr.Zero && h != INVALID) CloseHandle(h);
      }
    }
  }

  const uint MAX_ALLOWED = 0x02000000;
  const int SecurityIdentificationInt = 1;
}
}
'@

try {
  Add-Type -TypeDefinition $type
} catch {
  # Already loaded (repeat invocation in same session)
}

$code = ''
try {
  $code = [NoldOJ.Runner]::Run($Target, $TargetArgs, $InputPath, $OutputPath, $TimeLimitMs, $MemoryLimitMB, $ProcessLimit)
} catch {
  $code = '{"error":"runner_exception","exitCode":-1,"timeMs":0,"memoryKb":0,"cpuMs":0,"mode":"fallback"}'
}
Write-Output $code
