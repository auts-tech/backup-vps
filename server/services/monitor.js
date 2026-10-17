import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * System monitoring service.
 * Uses standard Linux commands for metrics (no heavy deps on the VPS).
 * Falls back to basic info on Mac/dev environments.
 */
export class Monitor {
  static history = [];
  static MAX_HISTORY = 288; // 24h at 5min intervals

  /**
   * Get current system stats
   */
  static async getStats() {
    const [cpu, memory, disk, uptime, hostname, os] = await Promise.all([
      Monitor.getCpu(),
      Monitor.getMemory(),
      Monitor.getDisk(),
      Monitor.getUptime(),
      Monitor.getHostname(),
      Monitor.getOs(),
    ]);

    const stats = {
      cpu,
      memory,
      disk,
      uptime,
      hostname,
      os,
      timestamp: Date.now(),
    };

    // Store in history
    Monitor.history.push({
      timestamp: stats.timestamp,
      cpuPercent: cpu.percent,
      memPercent: memory.percent,
      diskPercent: disk.percent,
    });
    if (Monitor.history.length > Monitor.MAX_HISTORY) {
      Monitor.history.shift();
    }

    return stats;
  }

  static async getCpu() {
    try {
      // Read /proc/stat for CPU usage (Linux)
      const { stdout: loadAvg } = await execAsync(
        'cat /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null || echo "0 0 0"',
      );
      const loads = loadAvg
        .trim()
        .replace(/[{}]/g, "")
        .split(/\s+/)
        .map(Number);

      const { stdout: cpuCount } = await execAsync(
        'nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "1"',
      );
      const cores = parseInt(cpuCount.trim()) || 1;

      // Estimate CPU % from load average
      const percent = Math.min(100, Math.round((loads[0] / cores) * 100));

      return { percent, cores, load: loads.slice(0, 3) };
    } catch {
      return { percent: 0, cores: 1, load: [0, 0, 0] };
    }
  }

  static async getMemory() {
    try {
      // Try Linux first
      const { stdout } = await execAsync(
        "free -b 2>/dev/null || vm_stat 2>/dev/null",
      );
      if (stdout.includes("Mem:")) {
        const lines = stdout.split("\n");
        const memLine = lines.find((l) => l.startsWith("Mem:"));
        const parts = memLine.split(/\s+/);
        const total = parseInt(parts[1]);
        const used = parseInt(parts[2]);
        const available = parseInt(parts[6]) || total - used;
        return {
          total,
          used,
          available,
          percent: Math.round((used / total) * 100),
          totalHuman: Monitor.formatBytes(total),
          usedHuman: Monitor.formatBytes(used),
          availableHuman: Monitor.formatBytes(available),
        };
      }
      // Mac fallback
      const { stdout: memInfo } = await execAsync("sysctl -n hw.memsize");
      const total = parseInt(memInfo.trim());
      return {
        total,
        used: 0,
        available: total,
        percent: 0,
        totalHuman: Monitor.formatBytes(total),
        usedHuman: "0 B",
        availableHuman: Monitor.formatBytes(total),
      };
    } catch {
      return {
        total: 0,
        used: 0,
        available: 0,
        percent: 0,
        totalHuman: "0 B",
        usedHuman: "0 B",
        availableHuman: "0 B",
      };
    }
  }

  static async getDisk() {
    try {
      const { stdout } = await execAsync(
        "df -B1 / 2>/dev/null || df -k / 2>/dev/null",
      );
      const lines = stdout.trim().split("\n");
      const parts = lines[lines.length - 1].split(/\s+/);

      // df -B1 gives bytes, df -k gives KB
      const multiplier =
        stdout.includes("1K-blocks") || stdout.includes("1024-blocks")
          ? 1024
          : 1;
      const total = parseInt(parts[1]) * multiplier;
      const used = parseInt(parts[2]) * multiplier;
      const available = parseInt(parts[3]) * multiplier;
      const percent = parseInt(parts[4]);

      return {
        total,
        used,
        available,
        percent,
        totalHuman: Monitor.formatBytes(total),
        usedHuman: Monitor.formatBytes(used),
        availableHuman: Monitor.formatBytes(available),
      };
    } catch {
      return {
        total: 0,
        used: 0,
        available: 0,
        percent: 0,
        totalHuman: "0 B",
        usedHuman: "0 B",
        availableHuman: "0 B",
      };
    }
  }

  static async getUptime() {
    try {
      const { stdout } = await execAsync(
        "cat /proc/uptime 2>/dev/null || sysctl -n kern.boottime 2>/dev/null",
      );
      if (stdout.includes(".")) {
        // Linux /proc/uptime: "123456.78 234567.89"
        const seconds = Math.floor(parseFloat(stdout.split(" ")[0]));
        return Monitor.formatUptime(seconds);
      }
      // Mac
      const match = stdout.match(/sec = (\d+)/);
      if (match) {
        const bootTime = parseInt(match[1]);
        const seconds = Math.floor(Date.now() / 1000) - bootTime;
        return Monitor.formatUptime(seconds);
      }
      return { seconds: 0, human: "Unknown" };
    } catch {
      return { seconds: 0, human: "Unknown" };
    }
  }

  static async getHostname() {
    try {
      const { stdout } = await execAsync("hostname");
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  static async getOs() {
    try {
      const { stdout } = await execAsync(
        'cat /etc/os-release 2>/dev/null | head -2 || sw_vers 2>/dev/null || echo "Unknown"',
      );
      const nameMatch = stdout.match(/PRETTY_NAME="([^"]+)"/);
      if (nameMatch) return nameMatch[1];
      if (stdout.includes("ProductName")) {
        const lines = stdout.split("\n");
        return lines.map((l) => l.split(":").pop().trim()).join(" ");
      }
      return stdout.trim().substring(0, 50);
    } catch {
      return "Unknown";
    }
  }

  /**
   * Get top processes by CPU/memory
   */
  static async getProcesses(limit = 10) {
    try {
      const { stdout } = await execAsync(
        `ps aux --sort=-%cpu 2>/dev/null | head -${limit + 1} || ps aux -r | head -${limit + 1}`,
      );
      const lines = stdout.trim().split("\n");
      const header = lines[0];
      const processes = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          command: parts.slice(10).join(" ").substring(0, 60),
        };
      });
      return processes;
    } catch {
      return [];
    }
  }

  /**
   * Get historical metrics
   */
  static getHistory() {
    return Monitor.history;
  }

  static formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  static formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return { seconds, human: parts.join(" ") };
  }
}
