const { spawn } = require("child_process");
const { randomBytes } = require("crypto");
const net = require("net");
const path = require("path");
const { getLocalTestingConfig } = require("./config");

const projectRoot = path.resolve(__dirname, "../..");

const createChildEnvironment = (config, inherited = process.env) => {
  const env = { ...inherited };
  // The local server does not load .env. Remove inherited service credentials and
  // runtime storage paths as well, so an old production shell cannot supply them.
  for (const key of Object.keys(env)) {
    if (
      /^(?:DISCORD|GITHUB|OAUTH|MAILGUN|SMTP|SENDGRID|GETIPINTEL)/.test(key) ||
      ["MGKEY", "MGDOMAIN", "IPBANSINDEV", "CARDBACK_DIR", "DIAGNOSTICS_DIR", "NODE_OPTIONS"].includes(key)
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    NODE_ENV: "development",
    SHIO_LOCAL_TESTING: "1",
    MONGO_URL: config.mongoUrl,
    REDIS_URL: config.redisUrl,
    PORT: String(config.port),
    SECRETSESSIONKEY: randomBytes(32).toString("hex"),
  };
};

const checkService = (uri, defaultPort, name) =>
  new Promise((resolve, reject) => {
    const url = new URL(uri);
    const socket = net.createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || defaultPort),
    });
    socket.setTimeout(2000);
    const failed = () => {
      socket.destroy();
      reject(
        new Error(
          `${name} is not listening on ${url.hostname}:${url.port || defaultPort}. Start your local services or run pnpm local:services.`
        )
      );
    };
    socket.once("error", failed);
    socket.once("timeout", failed);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
  });

const runPackageScript = (runner, script, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, "run", script], { cwd: projectRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} did not complete (${signal || code}).`));
    });
  });

const startLocalTesting = async () => {
  const config = getLocalTestingConfig();
  const runner = process.env.npm_execpath;
  if (!runner)
    throw new Error("Run this launcher with corepack pnpm local:test so it uses the pinned package manager.");
  const env = createChildEnvironment(config);
  console.log(`Local test app: http://127.0.0.1:${config.port}`);
  console.log(`Local MongoDB: ${config.mongoUrl}`);
  console.log(`Local Redis: ${config.redisUrl} (the app uses its existing settings database index 11)`);
  console.log("This mode ignores .env and inherited production service settings. Press Ctrl+C to stop.");
  await Promise.all([checkService(config.mongoUrl, 27017, "MongoDB"), checkService(config.redisUrl, 6379, "Redis")]);
  // Generate every asset before accepting the first browser request. These are
  // the project's existing build commands, not globally installed dependencies.
  for (const script of ["build-css:dark", "build-css:web", "build"]) await runPackageScript(runner, script, env);

  const children = [
    spawn(process.execPath, [require.resolve("nodemon/bin/nodemon.js"), "--signal", "SIGTERM", "bin/dev.js"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    }),
    spawn(
      process.execPath,
      [
        path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js"),
        "build",
        "--watch",
        "--mode",
        "development",
      ],
      {
        cwd: projectRoot,
        env,
        stdio: "inherit",
      }
    ),
  ];
  let stopped = false;
  const stop = (code = 0) => {
    if (stopped) return;
    stopped = true;
    process.exitCode = code;
    for (const child of children) {
      if (!child.pid || child.exitCode !== null || child.signalCode) continue;
      if (process.platform === "win32") {
        // Windows SIGTERM does not let nodemon clean up its server child.
        // Limit taskkill to the process trees this launcher created.
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).once("error", () => {
          if (!child.killed) child.kill("SIGTERM");
        });
      } else if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };
  process.once("SIGINT", () => stop());
  process.once("SIGTERM", () => stop());
  for (const child of children) {
    child.once("error", (error) => {
      console.error(error.message);
      stop(1);
    });
    child.once("exit", (code) => stop(code || 0));
  }
};

if (require.main === module) {
  startLocalTesting().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createChildEnvironment, startLocalTesting };
