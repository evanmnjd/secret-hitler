const { EventEmitter } = require("events");
const soon = (callback) => Promise.resolve().then(callback);
const { launchLocalTesting, assertNodeVersion, browserCommand } = require("../../scripts/local-testing/launch");

const makeHarness = ({ missing = [], dockerFails = false, missingDocker = false, failSeed = false } = {}) => {
  const children = [];
  const calls = [];
  const services = new Set(missing);
  const signals = new EventEmitter();
  let elapsed = 0;
  const close = (child, code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };
  const spawnImpl = jest.fn((command, args, options) => {
    const child = new EventEmitter();
    child.pid = children.length + 100;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = jest.fn(() => close(child, null, "SIGTERM"));
    child.unref = jest.fn();
    children.push(child);
    calls.push({ command, args, options });
    soon(() => {
      if (command === "taskkill") {
        const target = children.find((entry) => String(entry.pid) === args[1]);
        if (target) close(target, null, "SIGTERM");
        close(child);
      } else if (command === "docker") {
        if (missingDocker) child.emit("error", new Error("spawn docker ENOENT"));
        else {
          if (!dockerFails) services.clear();
          close(child, dockerFails ? 1 : 0);
        }
      } else if (args.includes("local:seed")) close(child, failSeed ? 1 : 0);
      else if (!args.includes("local:test")) close(child);
    });
    return child;
  });
  const options = {
    env: { npm_execpath: "/fake/pnpm.cjs" },
    nodeVersion: "24.12.0",
    platform: "linux",
    spawnImpl,
    tcpReady: jest.fn(async (_host, port) => port !== 8080 && !services.has(port)),
    httpReady: jest.fn(async () => true),
    browserOpen: jest.fn(async () => close(children[children.length - 1])),
    delay: jest.fn(async (ms) => {
      elapsed += ms;
    }),
    now: () => elapsed,
    signals,
    killGroup: jest.fn((pid) =>
      close(
        children.find((child) => child.pid === pid),
        null,
        "SIGTERM"
      )
    ),
    log: jest.fn(),
  };
  return { options, children, calls, close, signals };
};

it.each(["18.20.0", "24.11.9", "bad"])("explains the Node prerequisite before doing work on %s", (version) => {
  expect(() => assertNodeVersion(version)).toThrow(/24\.12/);
});

it.each(["24.12.0", "24.22.1", "25.0.0"])("accepts supported Node %s", (version) => {
  expect(() => assertNodeVersion(version)).not.toThrow();
});

it("rejects production mode before installing packages or contacting services", async () => {
  const h = makeHarness();
  h.options.env.NODE_ENV = "production";
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/production/);
  expect(h.options.spawnImpl).not.toHaveBeenCalled();
  expect(h.options.tcpReady).not.toHaveBeenCalled();
});

it("refuses an occupied app port instead of opening an unknown site", async () => {
  const h = makeHarness();
  h.options.tcpReady.mockResolvedValue(true);
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/already in use/);
  expect(h.options.spawnImpl).not.toHaveBeenCalled();
  expect(h.options.browserOpen).not.toHaveBeenCalled();
});

it("uses the selected checkout's package manager, preserves existing services, seeds and opens the ready site", async () => {
  const h = makeHarness();
  await launchLocalTesting(h.options);
  expect(h.calls.map((call) => call.args)).toEqual([
    ["/fake/pnpm.cjs", "install", "--frozen-lockfile", "--prod=false"],
    ["/fake/pnpm.cjs", "run", "local:seed"],
    ["/fake/pnpm.cjs", "run", "local:test"],
  ]);
  expect(h.options.browserOpen).toHaveBeenCalledWith("http://127.0.0.1:8080/game/", expect.any(Object));
  expect(h.calls[0].options.env).toMatchObject({ NODE_ENV: "development", SHIO_LOCAL_TESTING: "1" });
  expect(h.signals.listenerCount("SIGINT")).toBe(0);
  expect(h.signals.listenerCount("SIGTERM")).toBe(0);
});

it.each([
  [[6379], ["redis"]],
  [[27017], ["mongo"]],
  [
    [27017, 6379],
    ["mongo", "redis"],
  ],
])("starts only missing local services %j", async (missing, expected) => {
  const h = makeHarness({ missing });
  await launchLocalTesting(h.options);
  expect(h.calls.find((call) => call.command === "docker").args).toEqual([
    "compose",
    "-f",
    "compose.local-testing.yaml",
    "up",
    "-d",
    ...expected,
  ]);
});

it.each([
  true,
  false,
])("explains Docker startup failures without seeding or changing data (missing executable: %s)", async (missingDocker) => {
  const h = makeHarness({ missing: [27017], missingDocker, dockerFails: !missingDocker });
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/Open Docker Desktop/);
  expect(h.calls.some((call) => call.args.includes("local:seed"))).toBe(false);
});

it("does not start a default-port container for a missing custom-port database", async () => {
  const h = makeHarness({ missing: [27018] });
  h.options.env.LOCAL_TEST_MONGO_URL = "mongodb://127.0.0.1:27018/shio-local-testing-demo";
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/custom address/);
  expect(h.calls.some((call) => call.command === "docker")).toBe(false);
});

it("leaves a database setup failure visible and never opens a browser", async () => {
  const h = makeHarness({ failSeed: true });
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/Demo database setup/);
  expect(h.calls.some((call) => call.args.includes("local:test"))).toBe(false);
  expect(h.options.browserOpen).not.toHaveBeenCalled();
});

it("waits for the new server before opening its URL", async () => {
  const h = makeHarness();
  h.options.httpReady.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
  await launchLocalTesting(h.options);
  expect(h.options.httpReady).toHaveBeenCalledTimes(3);
  expect(h.options.delay).toHaveBeenCalledTimes(2);
});

it("does not launch a browser when running the explicit headless check", async () => {
  const h = makeHarness();
  h.options.env.LOCAL_TEST_NO_BROWSER = "1";
  h.options.httpReady.mockImplementation(async () => {
    soon(() => h.close(h.children[h.children.length - 1]));
    return true;
  });
  await launchLocalTesting(h.options);
  expect(h.options.browserOpen).not.toHaveBeenCalled();
});

it("keeps the server available and prints its URL if a browser opener is unavailable", async () => {
  const h = makeHarness();
  h.options.browserOpen.mockImplementation(async () => {
    h.close(h.children[h.children.length - 1]);
    throw new Error("No desktop browser");
  });
  await launchLocalTesting(h.options);
  expect(h.options.log).toHaveBeenCalledWith(expect.stringContaining("Open http://127.0.0.1:8080/game/ manually"));
});

it.each(["linux", "win32"])("interrupting setup stops only the owned process tree on %s", async (platform) => {
  const h = makeHarness();
  h.options.platform = platform;
  h.options.spawnImpl.mockImplementationOnce((command, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 77, exitCode: null, signalCode: null, kill: jest.fn() });
    h.children.push(child);
    h.calls.push({ command, args, options });
    soon(() => h.signals.emit("SIGINT"));
    return child;
  });
  await expect(launchLocalTesting(h.options)).resolves.toBeUndefined();
  if (platform === "win32") {
    expect(h.options.spawnImpl).toHaveBeenCalledWith("taskkill", ["/PID", "77", "/T", "/F"], { stdio: "ignore" });
  } else expect(h.options.killGroup).toHaveBeenCalledWith(77);
  expect(h.signals.listenerCount("SIGINT")).toBe(0);
});

it("rechecks the port before starting after potentially slow setup", async () => {
  const h = makeHarness();
  h.options.tcpReady.mockImplementation(async (_host, port) => {
    if (port !== 8080) return true;
    return h.calls.some((call) => call.args.includes("local:seed"));
  });
  await expect(launchLocalTesting(h.options)).rejects.toThrow(/became busy/);
  expect(h.calls.some((call) => call.args.includes("local:test"))).toBe(false);
});

it("passes the URL as an argument to each OS opener without a command shell", () => {
  const url = "http://127.0.0.1:8080/game/";
  expect(browserCommand("win32", url)).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
  expect(browserCommand("darwin", url)).toEqual(["open", [url]]);
  expect(browserCommand("linux", url)).toEqual(["xdg-open", [url]]);
});
