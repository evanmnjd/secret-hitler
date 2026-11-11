const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const { getLocalTestingConfig } = require("./config");
const { createChildEnvironment } = require("./start");

const projectRoot = path.resolve(__dirname, "../..");
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const assertNodeVersion = (version) => {
  const [major, minor] = String(version).split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 24 || (major === 24 && minor < 12)) {
    throw new Error("Install Node.js 24.12 or newer, then open this launcher again.");
  }
};

const probeTcp = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: host.replace(/^\[|\]$/g, ""), port });
    let complete = false;
    const finish = (ready) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });

const probeHttp = (url) =>
  new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    request.setTimeout(1000, () => request.destroy());
    request.once("error", () => resolve(false));
  });

const browserCommand = (platform, url) => {
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
};

const openBrowser = (url, { platform = process.platform, spawnImpl = spawn } = {}) =>
  new Promise((resolve, reject) => {
    const [command, args] = browserCommand(platform, url);
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

const serviceEndpoints = (config) => [
  { name: "mongo", label: "MongoDB", url: new URL(config.mongoUrl), defaultPort: 27017 },
  { name: "redis", label: "Redis", url: new URL(config.redisUrl), defaultPort: 6379 },
];

const canStartComposeService = ({ url, defaultPort }) =>
  ["127.0.0.1", "localhost"].includes(url.hostname) && Number(url.port || defaultPort) === defaultPort;

const launchLocalTesting = async ({
  env = process.env,
  platform = process.platform,
  nodeVersion = process.versions.node,
  spawnImpl = spawn,
  tcpReady = probeTcp,
  httpReady = probeHttp,
  browserOpen = openBrowser,
  delay = pause,
  now = Date.now,
  signals = process,
  killGroup = (pid) => process.kill(-pid, "SIGTERM"),
  log = console.log,
} = {}) => {
  assertNodeVersion(nodeVersion);
  const config = getLocalTestingConfig(env);
  const runner = env.npm_execpath;
  if (!runner) throw new Error("Open the startup shortcut, or run corepack pnpm local:launch from this checkout.");
  if (await tcpReady("127.0.0.1", config.port)) {
    throw new Error(
      `Port ${config.port} is already in use. Close the old test window first, or choose another LOCAL_TEST_PORT.`
    );
  }
  const childEnv = createChildEnvironment(config, env);
  const children = new Set();
  let stopped = false;
  const stopChild = (child) => {
    if (!child.pid || child.exitCode !== null || child.signalCode) return;
    if (platform === "win32") {
      spawnImpl("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).once("error", () => {
        if (!child.killed) child.kill("SIGTERM");
      });
    } else {
      try {
        killGroup(child.pid);
      } catch (error) {
        if (error.code !== "ESRCH" && !child.killed) child.kill("SIGTERM");
      }
    }
  };
  const stop = () => {
    stopped = true;
    for (const child of children) stopChild(child);
  };
  const ensureRunning = () => {
    if (stopped) throw new Error("Local test startup stopped.");
  };
  const startChild = (command, args) => {
    ensureRunning();
    const child = spawnImpl(command, args, {
      cwd: projectRoot,
      env: childEnv,
      stdio: "inherit",
      detached: platform !== "win32",
    });
    children.add(child);
    // Resolve, rather than reject, so an early exit cannot cause an unhandled
    // rejection while readiness is still being checked.
    const completed = new Promise((resolve) => {
      child.once("error", (error) => {
        children.delete(child);
        resolve({ error });
      });
      child.once("close", (code, signal) => {
        children.delete(child);
        resolve({ code, signal });
      });
    });
    return { child, completed };
  };
  const checkedResult = (result, label) => {
    if (stopped) return;
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    if (result.code !== 0) throw new Error(`${label} did not complete (${result.signal || result.code}).`);
  };
  const runPackage = async (args, label) => {
    const result = await startChild(process.execPath, [runner, ...args]).completed;
    checkedResult(result, label);
    ensureRunning();
  };
  signals.once("SIGINT", stop);
  signals.once("SIGTERM", stop);
  try {
    log("Preparing the local test site. Keep this window open while you use it.");
    log("1/4 Checking the project's installed packages (downloads are reused when available)...");
    await runPackage(["install", "--frozen-lockfile", "--prod=false"], "Dependency installation");
    const services = serviceEndpoints(config);
    const missing = [];
    for (const service of services) {
      if (!(await tcpReady(service.url.hostname, Number(service.url.port || service.defaultPort))))
        missing.push(service);
    }
    if (missing.length) {
      const manual = missing.find((service) => !canStartComposeService(service));
      if (manual) {
        throw new Error(
          `${manual.label} is not running at the selected custom address. Start that service, then open this launcher again.`
        );
      }
      log(`2/4 Starting ${missing.map((service) => service.label).join(" and ")} with Docker...`);
      const result = await startChild("docker", [
        "compose",
        "-f",
        "compose.local-testing.yaml",
        "up",
        "-d",
        ...missing.map((service) => service.name),
      ]).completed;
      if (stopped) return;
      if (result.error || result.code !== 0) {
        throw new Error(
          "MongoDB/Redis could not start. Open Docker Desktop and try again, or start your existing local MongoDB and Redis services."
        );
      }
      const deadline = now() + 30000;
      for (const service of missing) {
        while (!(await tcpReady(service.url.hostname, Number(service.url.port || service.defaultPort)))) {
          ensureRunning();
          if (now() >= deadline)
            throw new Error(`${service.label} is still starting. Wait briefly and open the launcher again.`);
          await delay(250);
        }
      }
    } else log("2/4 MongoDB and Redis are already running.");
    log("3/4 Preparing demo accounts and history (existing demo data is preserved)...");
    await runPackage(["run", "local:seed"], "Demo database setup");
    if (await tcpReady("127.0.0.1", config.port)) {
      throw new Error(
        `Port ${config.port} became busy. Close the old test window first, or choose another LOCAL_TEST_PORT.`
      );
    }
    log("4/4 Building and starting the site...");
    const server = startChild(process.execPath, [runner, "run", "local:test"]);
    let exitResult;
    server.completed.then((result) => {
      exitResult = result;
    });
    const origin = `http://127.0.0.1:${config.port}`;
    const deadline = now() + 180000;
    while (!(await httpReady(`${origin}/`))) {
      if (stopped) return;
      if (exitResult) {
        checkedResult(exitResult, "Local test server");
        throw new Error("The local test server stopped before it became ready.");
      }
      if (now() >= deadline)
        throw new Error("The site is still building. Check the messages in this window for an error.");
      await delay(250);
    }
    ensureRunning();
    const url = `${origin}/game/`;
    log(`Ready: ${url}`);
    log("Log in as LocalDemoAdmin with password LocalTest123! Press Ctrl+C in this window to stop the site.");
    if (env.LOCAL_TEST_NO_BROWSER !== "1") {
      try {
        await browserOpen(url, { platform, spawnImpl });
      } catch {
        log(`Your browser could not open automatically. Open ${url} manually.`);
      }
    }
    checkedResult(await server.completed, "Local test server");
  } catch (error) {
    if (!stopped) throw error;
  } finally {
    stop();
    signals.off("SIGINT", stop);
    signals.off("SIGTERM", stop);
  }
};

if (require.main === module) {
  launchLocalTesting().catch((error) => {
    console.error(`Local test startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { launchLocalTesting, assertNodeVersion, probeTcp, probeHttp, browserCommand, canStartComposeService };
