import { Router } from "express";
import { readFileSync, existsSync, statSync } from "fs";

const router = Router();
const LOG_FILE = "/var/log/vps-backup-manager.log";

// GET /api/v1/logs — Get backup logs (paginated)
router.get("/", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const search = req.query.search || "";

    if (!existsSync(LOG_FILE)) {
      return res.json({ logs: [], total: 0, page, pages: 0 });
    }

    const content = readFileSync(LOG_FILE, "utf-8");
    let lines = content.split("\n").filter(Boolean).reverse(); // Newest first

    if (search) {
      lines = lines.filter((l) =>
        l.toLowerCase().includes(search.toLowerCase()),
      );
    }

    const total = lines.length;
    const pages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedLines = lines.slice(start, start + limit);

    const logs = paginatedLines.map((line, i) => {
      const match = line.match(/^\[([^\]]+)\]\s+(.*)/);
      return {
        id: start + i,
        timestamp: match ? match[1] : "",
        message: match ? match[2] : line,
        raw: line,
        level:
          line.includes("FAILED") || line.includes("ERROR")
            ? "error"
            : line.includes("WARNING")
              ? "warning"
              : line.includes("completed") || line.includes("Success")
                ? "success"
                : "info",
      };
    });

    res.json({ logs, total, page, pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/logs/stream — SSE live log stream
router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let lastSize = 0;
  try {
    if (existsSync(LOG_FILE)) {
      lastSize = statSync(LOG_FILE).size;
    }
  } catch {}

  const interval = setInterval(() => {
    try {
      if (!existsSync(LOG_FILE)) return;

      const currentSize = statSync(LOG_FILE).size;
      if (currentSize > lastSize) {
        const content = readFileSync(LOG_FILE, "utf-8");
        const allBytes = Buffer.byteLength(content, "utf-8");
        // Get only new content
        const newContent = content.substring(
          content.length - (currentSize - lastSize),
        );
        const newLines = newContent.split("\n").filter(Boolean);

        for (const line of newLines) {
          const match = line.match(/^\[([^\]]+)\]\s+(.*)/);
          const logEntry = {
            timestamp: match ? match[1] : new Date().toISOString(),
            message: match ? match[2] : line,
            level:
              line.includes("FAILED") || line.includes("ERROR")
                ? "error"
                : line.includes("WARNING")
                  ? "warning"
                  : line.includes("completed") || line.includes("Success")
                    ? "success"
                    : "info",
          };
          res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        }

        lastSize = currentSize;
      }
    } catch {}
  }, 2000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// GET /api/v1/logs/info — Log file info
router.get("/info", (req, res) => {
  try {
    if (!existsSync(LOG_FILE)) {
      return res.json({ exists: false, size: 0, path: LOG_FILE });
    }
    const stat = statSync(LOG_FILE);
    res.json({
      exists: true,
      size: stat.size,
      sizeHuman: formatBytes(stat.size),
      modified: stat.mtime,
      path: LOG_FILE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export default router;
