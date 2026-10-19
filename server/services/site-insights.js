import { existsSync, openSync, readSync, closeSync, statSync } from "fs";
import { promises as dns } from "dns";
import { networkInterfaces } from "os";
import { run } from "../lib/shell.js";

const MAX_READ = 24 * 1024 * 1024; // newest 24 MB of each log file
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
// nginx "combined" format
const LINE =
  /^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "(?:(\S+) (\S+)[^"]*|[^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;
const BOTS =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|curl|wget|python-requests|httpclient|monitor|uptime/i;
const ASSET =
  /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot)(?:\?|$)/i;

function readTail(file) {
  if (!existsSync(file)) return "";
  const size = statSync(file).size;
  const length = Math.min(size, MAX_READ);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString("utf-8");
  return length < size ? text.slice(text.indexOf("\n") + 1) : text; // drop the partial first line
}

function parseTime(m) {
  const tz = m[8];
  const offset =
    (parseInt(tz.slice(1, 3)) * 60 + parseInt(tz.slice(3))) *
    (tz[0] === "-" ? -1 : 1);
  return (
    Date.UTC(+m[4], MONTHS[m[3]], +m[2], +m[5], +m[6], +m[7]) - offset * 60000
  );
}

function top(map, n = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

/**
 * Visitor statistics for the last `days` days from an nginx access log
 * (and its first rotation, access.log.1).
 */
export function trafficStats(logFile, { days = 7 } = {}) {
  const now = Date.now();
  const since = now - days * 86400000;
  const daySince = now - 86400000;
  const hourly = Array.from({ length: 24 }, () => ({ requests: 0, bytes: 0 }));
  const daily = Array.from({ length: days }, () => ({
    requests: 0,
    visitors: new Set(),
    bytes: 0,
  }));
  const status = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const paths = new Map();
  const referrers = new Map();
  const notFound = new Map();
  const visitors = new Set();
  const visitors24 = new Set();
  let requests = 0;
  let requests24 = 0;
  let bytes = 0;
  let bots = 0;
  let parsed = 0;

  for (const file of [`${logFile}.1`, logFile]) {
    for (const line of readTail(file).split("\n")) {
      const m = line.match(LINE);
      if (!m) continue;
      parsed++;
      const t = parseTime(m);
      if (t < since || t > now + 60000) continue;
      const [ip, path, code, size, referrer, agent] = [
        m[1],
        m[10] || "",
        m[11],
        m[12],
        m[13],
        m[14],
      ];
      const sent = size === "-" ? 0 : parseInt(size);
      requests++;
      bytes += sent;
      status[`${code[0]}xx`] = (status[`${code[0]}xx`] || 0) + 1;
      const isBot = BOTS.test(agent);
      if (isBot) bots++;
      else visitors.add(ip);

      const dayIndex = days - 1 - Math.floor((now - t) / 86400000);
      if (dayIndex >= 0 && dayIndex < days) {
        daily[dayIndex].requests++;
        daily[dayIndex].bytes += sent;
        if (!isBot) daily[dayIndex].visitors.add(ip);
      }
      if (t >= daySince) {
        requests24++;
        if (!isBot) visitors24.add(ip);
        const hourIndex = 23 - Math.floor((now - t) / 3600000);
        if (hourIndex >= 0) {
          hourly[hourIndex].requests++;
          hourly[hourIndex].bytes += sent;
        }
      }
      const clean = path.split("?")[0].slice(0, 200);
      if (code === "404") notFound.set(clean, (notFound.get(clean) || 0) + 1);
      else if (!ASSET.test(clean) && !isBot)
        paths.set(clean, (paths.get(clean) || 0) + 1);
      if (referrer && referrer !== "-" && !isBot) {
        try {
          const host = new URL(referrer).hostname;
          referrers.set(host, (referrers.get(host) || 0) + 1);
        } catch {}
      }
    }
  }

  return {
    available: existsSync(logFile),
    logFile,
    days,
    parsedLines: parsed,
    totals: { requests, visitors: visitors.size, bytes, bots },
    last24h: { requests: requests24, visitors: visitors24.size },
    status,
    hourly,
    daily: daily.map((d, i) => ({
      date: new Date(now - (days - 1 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      requests: d.requests,
      visitors: d.visitors.size,
      bytes: d.bytes,
    })),
    topPaths: top(paths),
    topReferrers: top(referrers, 6),
    notFound: top(notFound, 6),
  };
}

/**
 * Public addresses of this server's network interfaces (PANEL_PUBLIC_IP adds one behind NAT).
 */
export function serverAddresses() {
  const out = new Set();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (
        a.internal ||
        a.address.startsWith("fe80") ||
        a.address.startsWith("169.254.")
      )
        continue;
      out.add(a.address);
    }
  }
  for (const ip of (process.env.PANEL_PUBLIC_IP || "")
    .split(/[\s,]+/)
    .filter(Boolean))
    out.add(ip);
  return [...out];
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DNS lookup timed out")), ms),
    ),
  ]);
}

/**
 * Where a domain's A/AAAA records point, and whether that is this server.
 */
export async function checkDns(domain) {
  const ips = serverAddresses();
  const lookup = async (fn) => {
    try {
      return await withTimeout(fn(domain), 5000);
    } catch (err) {
      return err.code === "ENODATA" || err.code === "ENOTFOUND" ? [] : null;
    }
  };
  const [a, aaaa] = await Promise.all([
    lookup(dns.resolve4),
    lookup(dns.resolve6),
  ]);
  const records = [...(a || []), ...(aaaa || [])];
  return {
    domain,
    a: a || [],
    aaaa: aaaa || [],
    serverIps: ips,
    resolves: records.length > 0,
    pointsHere: records.some((ip) => ips.includes(ip)),
    error: a === null && aaaa === null ? "DNS lookup failed" : null,
  };
}

const diskCache = new Map(); // path → { at, bytes, pending }

/**
 * Size of a website folder (du), cached for 10 minutes.
 * Returns null while the first measurement is still running.
 */
export function diskUsage(path) {
  if (!path || !existsSync(path)) return { bytes: 0, measuredAt: null };
  const cached = diskCache.get(path);
  const fresh =
    cached && cached.bytes !== null && Date.now() - cached.at < 600000;
  if (!fresh && !cached?.pending) {
    const entry = {
      at: cached?.at || 0,
      bytes: cached?.bytes ?? null,
      pending: true,
    };
    diskCache.set(path, entry);
    run("du", ["-sk", path], { timeout: 300000 }).then((r) => {
      const kb = parseInt(r.stdout.split("\t")[0]);
      diskCache.set(path, {
        at: Date.now(),
        bytes: Number.isNaN(kb) ? null : kb * 1024,
        pending: false,
      });
    });
  }
  const current = diskCache.get(path);
  return {
    bytes: current.bytes,
    measuredAt: current.at ? new Date(current.at).toISOString() : null,
    measuring: !!current.pending,
  };
}
