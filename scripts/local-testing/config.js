const DEFAULT_MONGO_URL = "mongodb://127.0.0.1:27017/shio-local-testing";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const DATABASE_NAME = /^shio-local-testing(?:-[a-z0-9][a-z0-9-]{0,39})?$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const parseLocalUrl = (input, protocol, label) => {
  if (typeof input !== "string" || /\s/.test(input) || !input.startsWith(`${protocol}//`)) {
    throw new Error(`${label} must use ${protocol}// and an exact loopback host.`);
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${label} is not a valid local URL.`);
  }
  if (
    url.protocol !== protocol ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    input.includes("?") ||
    input.includes("#") ||
    (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))
  ) {
    throw new Error(`${label} must use one loopback host, with no credentials, query or fragment.`);
  }
  const pathOffset = input.indexOf("/", protocol.length + 2);
  const rawPath = pathOffset < 0 ? "" : input.slice(pathOffset);
  if (rawPath !== url.pathname) throw new Error(`${label} must not contain normalized or ambiguous path segments.`);
  return url;
};

// The fixture tool must never select the existing app database, an Atlas cluster,
// or another hostname. A dedicated database makes reset/cleanup reviewable.
const assertLocalMongoUrl = (input) => {
  const url = parseLocalUrl(input, "mongodb:", "LOCAL_TEST_MONGO_URL");
  if (!DATABASE_NAME.test(url.pathname.slice(1))) {
    throw new Error("The local test database must be named shio-local-testing or shio-local-testing-<suffix>.");
  }
  return input;
};

const assertLocalRedisUrl = (input) => {
  const url = parseLocalUrl(input, "redis:", "LOCAL_TEST_REDIS_URL");
  if (url.pathname && url.pathname !== "/") {
    throw new Error("LOCAL_TEST_REDIS_URL must not select a database; the app uses its existing database indexes.");
  }
  return input;
};

const getLocalTestingConfig = (env = process.env) => {
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("Local test tooling cannot run with NODE_ENV=production.");
  }
  const mongoUrl = assertLocalMongoUrl(env.LOCAL_TEST_MONGO_URL || DEFAULT_MONGO_URL);
  const redisUrl = assertLocalRedisUrl(env.LOCAL_TEST_REDIS_URL || DEFAULT_REDIS_URL);
  const rawPort = env.LOCAL_TEST_PORT === undefined ? "8080" : String(env.LOCAL_TEST_PORT);
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("LOCAL_TEST_PORT must be an integer from 1 to 65535.");
  }
  return { mongoUrl, redisUrl, port: Number(rawPort) };
};

module.exports = { getLocalTestingConfig, assertLocalMongoUrl, assertLocalRedisUrl };
