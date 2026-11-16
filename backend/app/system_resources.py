"""CPU, memory and disk of the computer that is running this program."""

from __future__ import annotations

import os
import platform
import shutil
import socket
import time
from pathlib import Path

_cpu_lock = __import__("threading").Lock()
_cpu_cache: tuple[float, float | None] | None = None
_proc_sample: tuple[float, float] | None = None


def _sqlite_dir() -> Path:
    try:
        from .database import _sqlite_file

        path = _sqlite_file()
        if path is not None:
            return path if path.is_dir() else path.parent
    except Exception:
        pass
    return Path.cwd()


def _cpu_ticks() -> tuple[int, int] | None:
    """Return (busy, total) tick counters, or None when the OS hides them."""
    if os.name == "nt":
        import ctypes

        class FILETIME(ctypes.Structure):
            _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

        idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None

        def ticks(item: FILETIME) -> int:
            return (item.dwHighDateTime << 32) + item.dwLowDateTime

        idle_t = ticks(idle)
        kernel_t = ticks(kernel)
        user_t = ticks(user)
        # Kernel time already includes idle time.
        total = kernel_t + user_t
        busy = (kernel_t - idle_t) + user_t
        return busy, total
    stat = Path("/proc/stat")
    if not stat.is_file():
        return None
    parts = stat.read_text(encoding="utf-8").splitlines()[0].split()
    nums = [int(part) for part in parts[1:] if part.isdigit()]
    if len(nums) < 4:
        return None
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    total = sum(nums)
    return total - idle, total


def _cpu_percent() -> float | None:
    """Machine CPU busy percent. A short sample, reused for two seconds."""
    global _cpu_cache
    now = time.monotonic()
    with _cpu_lock:
        if _cpu_cache is not None and now - _cpu_cache[0] < 2:
            return _cpu_cache[1]
    first = _cpu_ticks()
    if first is None:
        return None
    time.sleep(0.2)
    second = _cpu_ticks()
    if second is None:
        return None
    busy = second[0] - first[0]
    total = second[1] - first[1]
    percent = None if total <= 0 else max(0.0, min(100.0, 100.0 * busy / total))
    with _cpu_lock:
        _cpu_cache = (time.monotonic(), percent)
    return percent


def _memory() -> tuple[int, int] | None:
    """Return (total_bytes, used_bytes)."""
    if os.name == "nt":
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        total = int(status.ullTotalPhys)
        used = total - int(status.ullAvailPhys)
        return total, used
    info: dict[str, int] = {}
    meminfo = Path("/proc/meminfo")
    if not meminfo.is_file():
        return None
    for line in meminfo.read_text(encoding="utf-8").splitlines():
        key, _, rest = line.partition(":")
        digits = "".join(ch for ch in rest if ch.isdigit())
        if digits:
            info[key] = int(digits) * 1024
    total = info.get("MemTotal")
    if not total:
        return None
    available = info.get("MemAvailable", info.get("MemFree", 0))
    return total, max(0, total - available)


def _process_ram_bytes() -> int | None:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return None
        return int(counters.WorkingSetSize)
    status = Path("/proc/self/status")
    if not status.is_file():
        return None
    for line in status.read_text(encoding="utf-8").splitlines():
        if line.startswith("VmRSS:"):
            digits = "".join(ch for ch in line if ch.isdigit())
            return int(digits) * 1024 if digits else None
    return None


def _process_cpu_seconds() -> float | None:
    if os.name == "nt":
        import ctypes

        class FILETIME(ctypes.Structure):
            _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

        creation, exit_, kernel, user = FILETIME(), FILETIME(), FILETIME(), FILETIME()
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        if not ctypes.windll.kernel32.GetProcessTimes(
            handle, ctypes.byref(creation), ctypes.byref(exit_), ctypes.byref(kernel), ctypes.byref(user)
        ):
            return None

        def ticks(item: FILETIME) -> int:
            return (item.dwHighDateTime << 32) + item.dwLowDateTime

        # 100-nanosecond ticks.
        return (ticks(kernel) + ticks(user)) / 10_000_000
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF)
        return float(usage.ru_utime + usage.ru_stime)
    except Exception:
        return None


def _process_cpu_percent(cpu_count: int) -> float | None:
    """Share of the whole machine used by this program since the previous sample."""
    global _proc_sample
    now = time.monotonic()
    seconds = _process_cpu_seconds()
    if seconds is None:
        return None
    with _cpu_lock:
        previous = _proc_sample
        _proc_sample = (now, seconds)
    if previous is None:
        return None
    wall = now - previous[0]
    if wall <= 0.05:
        return None
    share = (seconds - previous[1]) / wall / max(cpu_count, 1) * 100.0
    return max(0.0, min(100.0, share))


def _round(value: float | None, digits: int = 1) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def snapshot() -> dict:
    cpu_count = os.cpu_count() or 1
    cpu_percent = _cpu_percent()
    memory = _memory()
    disk_path = _sqlite_dir()
    disk = shutil.disk_usage(disk_path)
    process_ram = _process_ram_bytes()
    process_cpu = _process_cpu_percent(cpu_count)

    ram_total = memory[0] if memory else None
    ram_used = memory[1] if memory else None
    ram_percent = (100.0 * ram_used / ram_total) if ram_total and ram_used is not None else None
    disk_percent = (100.0 * disk.used / disk.total) if disk.total else None
    process_ram_percent = (100.0 * process_ram / ram_total) if process_ram and ram_total else None
    if cpu_percent is not None and ram_percent is not None:
        engaged = cpu_percent * 0.65 + ram_percent * 0.35
    else:
        engaged = cpu_percent if cpu_percent is not None else ram_percent

    return {
        "hostname": socket.gethostname(),
        "platform": f"{platform.system()} {platform.release()}".strip(),
        "cpu_count": cpu_count,
        "cpu_percent": _round(cpu_percent),
        "ram_total_mb": round(ram_total / (1024 * 1024)) if ram_total else None,
        "ram_used_mb": round(ram_used / (1024 * 1024)) if ram_used is not None else None,
        "ram_percent": _round(ram_percent),
        "disk_path": str(disk_path),
        "disk_total_gb": _round(disk.total / (1024**3), 1),
        "disk_used_gb": _round(disk.used / (1024**3), 1),
        "disk_free_gb": _round(disk.free / (1024**3), 1),
        "disk_percent": _round(disk_percent),
        "process_ram_mb": round(process_ram / (1024 * 1024)) if process_ram else None,
        "process_ram_percent": _round(process_ram_percent),
        "process_cpu_percent": _round(process_cpu),
        "engaged_percent": _round(engaged),
    }
