import mysql from "mysql2";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { DATA_DIR, httpError } from "../lib/config.js";
import { run, which, serviceActive } from "../lib/shell.js";
import { strongPassword } from "../lib/passwords.js";

// Credentials live outside the git-tracked config.json
const CREDS_FILE = join(DATA_DIR, "mysql.json");
const DEFAULTS_FILE = join(DATA_DIR, ".panel-my.cnf");
const PANEL_USER = "vpspanel";

export const SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);
const PROTECTED_USERS = new Set([
  "root",
  "mysql",
  "mariadb.sys",
  "mysql.sys",
  "mysql.session",
  "mysql.infoschema",
  "debian-sys-maint",
  PANEL_USER,
]);
const SOCKETS = [
  "/run/mysqld/mysqld.sock",
  "/var/run/mysqld/mysqld.sock",
  "/var/lib/mysql/mysql.sock",
  "/tmp/mysql.sock",
];

const DB_NAME = /^[A-Za-z0-9_$-]{1,64}$/;
const USER_NAME = /^[A-Za-z0-9_.-]{1,32}$/;
const HOST_NAME = /^[A-Za-z0-9_.%:-]{1,255}$/;
const MAX_ROWS = 1000;

export function assertDbName(name) {
  if (!DB_NAME.test(name || ""))
    throw httpError(
      400,
      "Database names may only contain letters, numbers, _ $ - (max 64)",
    );
}
export function assertUser(user, host = "localhost") {
  if (!USER_NAME.test(user || ""))
    throw httpError(
      400,
      "User names may only contain letters, numbers, _ . - (max 32)",
    );
  if (!HOST_NAME.test(host || ""))
    throw httpError(400, "Invalid host (use localhost, %, or an IP address)");
}

/**
 * In GRANT statements _ and % in a database name are wildcards; escape them.
 */
function grantDbName(db) {
  return db.replace(/([_%])/g, "\\$1");
}

function formatValue(v) {
  if (Buffer.isBuffer(v)) {
    const text = v.toString("utf8");
    if (!text.includes("�") && !/[\x00-\x08\x0E-\x1F]/.test(text)) return text;
    return `0x${v.subarray(0, 32).toString("hex")}${v.length > 32 ? "…" : ""} (${v.length} bytes)`;
  }
  return v;
}

/**
 * MySQL / MariaDB manager. Talks to the server with mysql2 using a dedicated
 * panel account (created once through root socket auth), and uses the
 * mysqldump / mysql CLIs for export and import.
 */
export class MysqlManager {
  static async binaries() {
    const [mariadb, mysqlCli, mariadbDump, mysqldump, mariadbd, mysqld] =
      await Promise.all(
        [
          "mariadb",
          "mysql",
          "mariadb-dump",
          "mysqldump",
          "mariadbd",
          "mysqld",
        ].map((b) => which(b)),
      );
    const serverBin =
      mariadbd ||
      mysqld ||
      (existsSync("/usr/sbin/mariadbd") && "/usr/sbin/mariadbd") ||
      (existsSync("/usr/sbin/mysqld") && "/usr/sbin/mysqld") ||
      null;
    return {
      client: mariadb || mysqlCli,
      dump: mariadbDump || mysqldump,
      server: serverBin,
      service: serverBin && serverBin.includes("mariadb") ? "mariadb" : "mysql",
    };
  }

  static socketPath() {
    return SOCKETS.find((s) => existsSync(s)) || null;
  }

  static getCreds() {
    try {
      return JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
    } catch {
      return null;
    }
  }

  static saveCreds(creds) {
    writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
    chmodSync(CREDS_FILE, 0o600);
    MysqlManager.writeDefaultsFile(creds);
  }

  /**
   * Option file for the mysql/mysqldump CLIs, so passwords never appear in `ps`.
   */
  static writeDefaultsFile(creds) {
    const quote = (v) =>
      `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const lines = [
      "[client]",
      `user=${quote(creds.user)}`,
      `password=${quote(creds.password || "")}`,
    ];
    if (creds.socketPath) lines.push(`socket=${quote(creds.socketPath)}`);
    else {
      lines.push(`host=${quote(creds.host || "127.0.0.1")}`);
      lines.push(`port=${parseInt(creds.port) || 3306}`);
    }
    writeFileSync(DEFAULTS_FILE, lines.join("\n") + "\n", { mode: 0o600 });
    chmodSync(DEFAULTS_FILE, 0o600);
    return DEFAULTS_FILE;
  }

  static defaultsFile() {
    const creds = MysqlManager.getCreds();
    if (!creds) throw httpError(409, "Database server is not connected yet");
    return existsSync(DEFAULTS_FILE)
      ? DEFAULTS_FILE
      : MysqlManager.writeDefaultsFile(creds);
  }

  static connectionOptions(creds, database) {
    const base = creds.socketPath
      ? { socketPath: creds.socketPath }
      : { host: creds.host || "127.0.0.1", port: parseInt(creds.port) || 3306 };
    return {
      ...base,
      user: creds.user,
      password: creds.password || "",
      database: database || undefined,
      multipleStatements: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 10000,
    };
  }

  static async connect(database, creds = MysqlManager.getCreds()) {
    if (!creds) {
      const err = httpError(409, "Database server is not connected yet");
      err.code = "NEEDS_SETUP";
      throw err;
    }
    const conn = mysql
      .createConnection(MysqlManager.connectionOptions(creds, database))
      .promise();
    // A dropped idle connection emits 'error'; without a listener that would crash the panel
    conn.connection.on("error", () => {});
    try {
      await conn.connect();
    } catch (err) {
      conn.destroy?.();
      throw httpError(
        502,
        `Cannot connect to the database server: ${err.message}`,
      );
    }
    return conn;
  }

  static async with(fn, database) {
    const conn = await MysqlManager.connect(database);
    try {
      return await fn(conn);
    } catch (err) {
      if (err.errno === 1819)
        throw httpError(400, await MysqlManager.policyMessage(conn));
      if (err.sqlMessage) throw httpError(400, err.sqlMessage);
      throw err;
    } finally {
      conn.end().catch(() => {});
    }
  }

  /**
   * Password policy (MySQL validate_password or MariaDB simple_password_check),
   * or null when no policy plugin is active.
   */
  static async passwordPolicy(conn) {
    const [rows] = await conn.query(
      "SHOW VARIABLES WHERE Variable_name LIKE 'validate_password%' OR Variable_name LIKE 'simple_password_check%'",
    );
    if (!rows.length) return null;
    const vars = Object.fromEntries(
      rows.map((r) => [
        r.Variable_name.replace(/^validate_password[._]/, ""),
        r.Value,
      ]),
    );
    const num = (v, fallback) =>
      Number.isFinite(parseInt(v)) ? parseInt(v) : fallback;
    return {
      length: num(vars.length ?? vars.simple_password_check_minimal_length, 8),
      level: vars.policy || null,
      symbols: num(
        vars.special_char_count ?? vars.simple_password_check_other_characters,
        1,
      ),
    };
  }

  static async policyMessage(conn) {
    let policy = null;
    try {
      policy = await MysqlManager.passwordPolicy(conn);
    } catch {}
    const length = policy?.length || 8;
    return `The database server's password policy rejected this password${policy?.level ? ` (policy ${policy.level})` : ""}. Use at least ${length} characters with upper- and lower-case letters, a number and ${policy?.symbols > 1 ? `${policy.symbols} symbols` : "a symbol"} — or use Generate.`;
  }

  // ── Status & setup ─────────────────────────────────────────

  static async status() {
    const bins = await MysqlManager.binaries();
    const installed = !!bins.server;
    const running = installed
      ? (await serviceActive(bins.service)) || !!MysqlManager.socketPath()
      : false;
    const creds = MysqlManager.getCreds();
    const status = {
      installed,
      running,
      service: bins.service,
      clientInstalled: !!bins.client,
      connected: false,
      user: creds?.user || null,
    };
    if (!installed && !bins.client) return status;

    if (creds) {
      try {
        status.version = await MysqlManager.with(
          async (c) => (await c.query("SELECT VERSION() AS v"))[0][0].v,
        );
        status.connected = true;
      } catch (err) {
        status.error = err.message;
      }
    }
    return status;
  }

  /**
   * Create the panel's own admin account using root over the unix socket
   * (the default on Ubuntu/Debian for MariaDB and MySQL).
   */
  static async bootstrap() {
    const bins = await MysqlManager.binaries();
    if (!bins.client)
      throw httpError(400, "The mysql/mariadb client is not installed");

    // 1. Can root log in over the unix socket? Also learn the password policy.
    const probe = await run(
      bins.client,
      [
        "-uroot",
        "-N",
        "-B",
        "-e",
        "SHOW VARIABLES WHERE Variable_name LIKE 'validate_password%length' OR Variable_name = 'simple_password_check_minimal_length'",
      ],
      { timeout: 20000 },
    );
    if (probe.code !== 0) {
      const err = httpError(
        422,
        `Automatic setup needs root access over the local socket, which was refused: ${probe.stderr.trim()}. Enter the MySQL root password instead.`,
      );
      err.code = "NEEDS_CREDENTIALS";
      throw err;
    }
    const required = Math.max(
      0,
      ...probe.stdout
        .split("\n")
        .map((line) => parseInt(line.split("\t")[1]))
        .filter(Number.isFinite),
    );

    // 2. Create the panel's admin account with a password the policy accepts
    const password = strongPassword(Math.max(32, required + 8));
    const sql = [
      `CREATE USER IF NOT EXISTS '${PANEL_USER}'@'localhost' IDENTIFIED BY '${password}';`,
      `ALTER USER '${PANEL_USER}'@'localhost' IDENTIFIED BY '${password}';`,
      `GRANT ALL PRIVILEGES ON *.* TO '${PANEL_USER}'@'localhost' WITH GRANT OPTION;`,
      "FLUSH PRIVILEGES;",
    ].join(" ");
    const result = await run(bins.client, ["-uroot", "-e", sql], {
      timeout: 20000,
    });
    if (result.code !== 0)
      throw httpError(
        422,
        `Connected as root, but creating the panel's database account failed: ${result.stderr.trim()}`,
      );
    const creds = {
      user: PANEL_USER,
      password,
      socketPath: MysqlManager.socketPath(),
    };
    if (!creds.socketPath)
      Object.assign(creds, { host: "localhost", port: 3306 });
    await (await MysqlManager.connect(null, creds)).end();
    MysqlManager.saveCreds(creds);
    return { success: true, user: PANEL_USER };
  }

  /**
   * Use explicitly supplied credentials (e.g. root with a password, or a remote server).
   */
  static async setCredentials({ host, port, user, password, socketPath }) {
    if (!user) throw httpError(400, "User is required");
    const creds = { user, password: password || "" };
    const useSocket = !host || host === "localhost";
    if (useSocket && (socketPath || MysqlManager.socketPath()))
      creds.socketPath = socketPath || MysqlManager.socketPath();
    else
      Object.assign(creds, {
        host: host || "127.0.0.1",
        port: parseInt(port) || 3306,
      });
    await (await MysqlManager.connect(null, creds)).end();
    MysqlManager.saveCreds(creds);
    return { success: true };
  }

  // ── Databases ──────────────────────────────────────────────

  static async overview() {
    return MysqlManager.with(async (c) => {
      const [dbs] = await c.query(`
        SELECT s.SCHEMA_NAME AS name, s.DEFAULT_CHARACTER_SET_NAME AS charset, s.DEFAULT_COLLATION_NAME AS collation,
               COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS size, COUNT(t.TABLE_NAME) AS tables
        FROM information_schema.SCHEMATA s
        LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
        GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
        ORDER BY s.SCHEMA_NAME`);
      const [users] = await c.query(
        "SELECT User AS user, Host AS host, plugin FROM mysql.user ORDER BY User, Host",
      );
      const [grants] = await c.query(
        "SELECT Db AS db, User AS user, Host AS host FROM mysql.db",
      );

      const grantMap = new Map();
      for (const g of grants) {
        const key = `${g.user}@${g.host}`;
        if (!grantMap.has(key)) grantMap.set(key, []);
        grantMap.get(key).push(g.db.replace(/\\([_%])/g, "$1"));
      }
      const dbUsers = new Map();
      for (const g of grants) {
        const db = g.db.replace(/\\([_%])/g, "$1");
        if (!dbUsers.has(db)) dbUsers.set(db, []);
        dbUsers.get(db).push(`${g.user}@${g.host}`);
      }

      return {
        databases: dbs.map((d) => ({
          ...d,
          size: parseInt(d.size) || 0,
          tables: parseInt(d.tables) || 0,
          system: SYSTEM_DATABASES.has(d.name),
          users: dbUsers.get(d.name) || [],
        })),
        users: users.map((u) => ({
          ...u,
          system: PROTECTED_USERS.has(u.user) || u.user === "",
          databases: grantMap.get(`${u.user}@${u.host}`) || [],
        })),
      };
    });
  }

  static async createDatabase({
    name,
    charset = "utf8mb4",
    collation = "utf8mb4_unicode_ci",
    user,
    password,
    host = "localhost",
  }) {
    assertDbName(name);
    if (!/^[a-z0-9_]+$/.test(charset) || !/^[a-z0-9_]+$/.test(collation))
      throw httpError(400, "Invalid charset or collation");
    if (user) assertUser(user, host);
    return MysqlManager.with(async (c) => {
      await c.query(
        `CREATE DATABASE ${c.escapeId(name)} CHARACTER SET ${charset} COLLATE ${collation}`,
      );
      if (user) {
        if (!password || password.length < 8)
          throw httpError(400, "User password must be at least 8 characters");
        await c.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [
          user,
          host,
          password,
        ]);
        await c.query(
          `GRANT ALL PRIVILEGES ON ${c.escapeId(grantDbName(name))}.* TO ?@?`,
          [user, host],
        );
      }
      return { success: true };
    });
  }

  static async dropDatabase(name) {
    assertDbName(name);
    if (SYSTEM_DATABASES.has(name))
      throw httpError(400, "System databases cannot be dropped");
    return MysqlManager.with(async (c) => {
      await c.query(`DROP DATABASE ${c.escapeId(name)}`);
      return { success: true };
    });
  }

  // ── Users ──────────────────────────────────────────────────

  static async createUser({
    user,
    host = "localhost",
    password,
    database,
    privileges = "ALL",
  }) {
    assertUser(user, host);
    if (!password || password.length < 8)
      throw httpError(400, "Password must be at least 8 characters");
    return MysqlManager.with(async (c) => {
      await c.query("CREATE USER ?@? IDENTIFIED BY ?", [user, host, password]);
      if (database) {
        assertDbName(database);
        await c.query(
          `GRANT ${MysqlManager.privilegeList(privileges)} ON ${c.escapeId(grantDbName(database))}.* TO ?@?`,
          [user, host],
        );
      }
      return { success: true };
    });
  }

  static privilegeList(privileges) {
    const allowed = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "CREATE",
      "DROP",
      "INDEX",
      "ALTER",
      "CREATE TEMPORARY TABLES",
      "LOCK TABLES",
      "EXECUTE",
      "CREATE VIEW",
      "SHOW VIEW",
      "CREATE ROUTINE",
      "ALTER ROUTINE",
      "EVENT",
      "TRIGGER",
      "REFERENCES",
    ];
    if (
      !privileges ||
      privileges === "ALL" ||
      (Array.isArray(privileges) && privileges.includes("ALL"))
    )
      return "ALL PRIVILEGES";
    const list = (
      Array.isArray(privileges) ? privileges : String(privileges).split(",")
    )
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
    if (!list.length || !list.every((p) => allowed.includes(p)))
      throw httpError(400, "Invalid privilege list");
    return list.join(", ");
  }

  static async dropUser(user, host) {
    assertUser(user, host);
    if (PROTECTED_USERS.has(user))
      throw httpError(
        400,
        `The ${user} account is required and cannot be removed here`,
      );
    return MysqlManager.with(async (c) => {
      await c.query("DROP USER ?@?", [user, host]);
      return { success: true };
    });
  }

  static async setPassword(user, host, password) {
    assertUser(user, host);
    if (user === PANEL_USER)
      throw httpError(
        400,
        "The panel account password is managed automatically",
      );
    if (!password || password.length < 8)
      throw httpError(400, "Password must be at least 8 characters");
    return MysqlManager.with(async (c) => {
      await c.query("ALTER USER ?@? IDENTIFIED BY ?", [user, host, password]);
      return { success: true };
    });
  }

  static async grant(user, host, database, privileges) {
    assertUser(user, host);
    assertDbName(database);
    return MysqlManager.with(async (c) => {
      await c.query(
        `GRANT ${MysqlManager.privilegeList(privileges)} ON ${c.escapeId(grantDbName(database))}.* TO ?@?`,
        [user, host],
      );
      return { success: true };
    });
  }

  static async revoke(user, host, database) {
    assertUser(user, host);
    assertDbName(database);
    return MysqlManager.with(async (c) => {
      await c.query(
        `REVOKE ALL PRIVILEGES ON ${c.escapeId(grantDbName(database))}.* FROM ?@?`,
        [user, host],
      );
      return { success: true };
    });
  }

  static async showGrants(user, host) {
    assertUser(user, host);
    return MysqlManager.with(async (c) => {
      const [rows] = await c.query({
        sql: "SHOW GRANTS FOR ?@?",
        values: [user, host],
        rowsAsArray: true,
      });
      return { grants: rows.map((r) => r[0]) };
    });
  }

  // ── Tables & data ──────────────────────────────────────────

  static async tables(database) {
    assertDbName(database);
    return MysqlManager.with(async (c) => {
      const [rows] = await c.query(
        `
        SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS \`rows\`,
               DATA_LENGTH + INDEX_LENGTH AS size, TABLE_COLLATION AS collation
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [database],
      );
      return {
        tables: rows.map((r) => ({
          ...r,
          rows: parseInt(r.rows) || 0,
          size: parseInt(r.size) || 0,
        })),
      };
    });
  }

  static async structure(database, table) {
    assertDbName(database);
    return MysqlManager.with(async (c) => {
      const [columns] = await c.query(
        `SHOW FULL COLUMNS FROM ${c.escapeId(table)}`,
      );
      const [indexes] = await c.query(`SHOW INDEX FROM ${c.escapeId(table)}`);
      return { columns, indexes };
    }, database);
  }

  static async rows(database, table, { page = 1, perPage = 50 } = {}) {
    assertDbName(database);
    perPage = Math.min(Math.max(parseInt(perPage) || 50, 1), 500);
    page = Math.max(parseInt(page) || 1, 1);
    return MysqlManager.with(async (c) => {
      const [[est]] = await c.query(
        "SELECT TABLE_ROWS AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        [database, table],
      );
      if (!est) throw httpError(404, `Table ${table} not found`);
      let total = parseInt(est.n) || 0;
      let exact = false;
      if (total < 500000) {
        const [[cnt]] = await c.query(
          `SELECT COUNT(*) AS n FROM ${c.escapeId(table)}`,
        );
        total = parseInt(cnt.n);
        exact = true;
      }
      const [rows, fields] = await c.query({
        sql: `SELECT * FROM ${c.escapeId(table)} LIMIT ? OFFSET ?`,
        values: [perPage, (page - 1) * perPage],
        rowsAsArray: true,
      });
      return {
        columns: fields.map((f) => f.name),
        rows: rows.map((r) => r.map(formatValue)),
        total,
        exact,
        page,
        perPage,
      };
    }, database);
  }

  /**
   * SQL console. Streams results so a huge SELECT can't exhaust memory:
   * at most MAX_ROWS rows per result set are kept.
   */
  static async execute(sql, database) {
    if (!sql || !sql.trim()) throw httpError(400, "Enter a SQL query");
    if (database) assertDbName(database);
    const conn = await MysqlManager.connect(database || null);
    const core = conn.connection;
    const started = Date.now();

    return new Promise((resolve, reject) => {
      const results = [];
      let current = null;
      let truncated = false;
      let finished = false;

      const done = (err) => {
        if (finished) return;
        finished = true;
        if (err) {
          core.destroy();
          reject(httpError(400, err.sqlMessage || err.message));
          return;
        }
        if (truncated) core.destroy();
        else conn.end().catch(() => {});
        resolve({ results, duration: Date.now() - started, truncated });
      };

      const query = core.query({ sql, rowsAsArray: true, timeout: 120000 });
      query.on("error", done);
      // Fatal connection errors (including exceptions thrown in the handlers below) end the request
      core.on("error", done);
      query.on("fields", (fields) => {
        // mysql2 emits fields=undefined before the OK packet of INSERT/UPDATE/DDL statements
        if (!fields) {
          current = null;
          return;
        }
        current = {
          type: "rows",
          columns: fields.map((f) => f.name),
          rows: [],
          truncated: false,
        };
        results.push(current);
      });
      query.on("result", (row) => {
        if (Array.isArray(row)) {
          if (!current) return;
          if (current.rows.length < MAX_ROWS)
            current.rows.push(row.map(formatValue));
          else {
            current.truncated = true;
            truncated = true;
            done(); // stop reading the rest of the result set
          }
        } else {
          // OK packet (INSERT/UPDATE/DDL, or the end of a stored procedure)
          results.push({
            type: "ok",
            affectedRows: row.affectedRows,
            insertId: row.insertId,
            info: row.info || "",
            warnings: row.warningStatus || 0,
          });
          current = null;
        }
      });
      query.on("end", () => done());
    });
  }
}

export { PANEL_USER, MAX_ROWS };
