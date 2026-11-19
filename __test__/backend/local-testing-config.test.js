const { getLocalTestingConfig, assertLocalMongoUrl } = require("../../scripts/local-testing/config");
const { createChildEnvironment } = require("../../scripts/local-testing/start");

describe("dedicated local test database", () => {
  it.each([
    "mongodb://127.0.0.1:27017/shio-local-testing",
    "mongodb://localhost/shio-local-testing-smoke-1",
    "mongodb://[::1]:27018/shio-local-testing",
  ])("accepts a loopback fixture database: %s", (url) => {
    expect(assertLocalMongoUrl(url)).toBe(url);
  });

  it.each([
    "mongodb+srv://localhost/shio-local-testing",
    "mongodb://localhost/secret-hitler-app",
    "mongodb://127.0.0.1/admin",
    "mongodb://127.0.0.1/local",
    "mongodb://127.0.0.1/config",
    "mongodb://127.0.0.1/",
    "mongodb://localhost/shio-local-testing/other",
    "mongodb://localhost/shio-local-testing%2Fother",
    "mongodb://localhost/shio-local-testing?authSource=admin",
    "mongodb://localhost/shio-local-testing#other",
    "mongodb://localhost/shio-local-testing?replicaSet=remote",
    "mongodb://user:password@localhost/shio-local-testing",
    "mongodb://localhost,remote.example/shio-local-testing",
    "mongodb://localhost:27017,127.0.0.1:27017/shio-local-testing",
    "mongodb://127.0.0.1.evil.example/shio-local-testing",
    "mongodb://example.test/shio-local-testing",
    "mongodb://%31%32%37.0.0.1/shio-local-testing",
    "mongodb://127.0.0.1:0/shio-local-testing",
    "mongodb://127.0.0.1:70000/shio-local-testing",
    " mongodb://127.0.0.1/shio-local-testing",
    "mongodb://127.0.0.1/shio-local-testing ",
    "mongodb://127.0.0.1/shio-local-testing-",
    "mongodb://127.0.0.1/shio-local-testing_other",
    "mongodb://127.0.0.1/shio-local-testing/../secret-hitler-app",
    "mongodb://127.0.0.1/secret-hitler-app/../shio-local-testing",
    "mongodb://127.0.0.1/%2e%2e/shio-local-testing",
    "mongodb://local\nhost/shio-local-testing",
    "mongodb://127.0.0.1/shio-local-testing?",
    "mongodb://127.0.0.1/shio-local-testing#",
    null,
  ])("rejects another destination or an ambiguous URL: %s", (url) => {
    expect(() => assertLocalMongoUrl(url)).toThrow();
  });

  it("ignores generic Mongo/Redis/PORT values instead of selecting the old installation", () => {
    expect(
      getLocalTestingConfig({
        MONGO_URL: "mongodb://production.example/app",
        REDIS_URL: "redis://remote:6379",
        PORT: "9000",
      })
    ).toEqual({
      mongoUrl: "mongodb://127.0.0.1:27017/shio-local-testing",
      redisUrl: "redis://127.0.0.1:6379",
      port: 8080,
    });
  });

  it("uses explicit local test overrides", () => {
    expect(
      getLocalTestingConfig({
        LOCAL_TEST_MONGO_URL: "mongodb://localhost:27018/shio-local-testing-qa",
        LOCAL_TEST_REDIS_URL: "redis://[::1]:6380",
        LOCAL_TEST_PORT: "8090",
      })
    ).toEqual({
      mongoUrl: "mongodb://localhost:27018/shio-local-testing-qa",
      redisUrl: "redis://[::1]:6380",
      port: 8090,
    });
  });

  it.each(["production", "PRODUCTION"])("refuses %s mode", (mode) => {
    expect(() => getLocalTestingConfig({ NODE_ENV: mode })).toThrow("NODE_ENV=production");
  });

  it.each(["0", "65536", "8080junk", "8080.5", "-1", "", " 8080"])("rejects invalid HTTP port %s", (port) => {
    expect(() => getLocalTestingConfig({ LOCAL_TEST_PORT: port })).toThrow("LOCAL_TEST_PORT");
  });

  it.each([
    "redis://remote.example:6379",
    "rediss://127.0.0.1:6379",
    "redis://localhost:6379/4",
    "redis://user:password@localhost:6379",
    "redis://localhost:6379/?db=3",
  ])("rejects nonlocal or misleading Redis configuration %s", (url) => {
    expect(() => getLocalTestingConfig({ LOCAL_TEST_REDIS_URL: url })).toThrow("LOCAL_TEST_REDIS_URL");
  });
});

it("launches with validated local endpoints and removes inherited external-service configuration", () => {
  const inherited = {
    PATH: "test-path",
    MONGO_URL: "production-mongo",
    REDIS_URL: "production-redis",
    SECRETSESSIONKEY: "production-key",
    DISCORDURL: "production-webhook",
    GITHUBCLIENTSECRET: "production-oauth-secret",
    MGKEY: "production-mail-key",
    MGDOMAIN: "production-mail-domain",
    CARDBACK_DIR: "/production/cardbacks",
    DIAGNOSTICS_DIR: "/production/logs",
    IPBANSINDEV: "true",
    NODE_OPTIONS: "--require old-bootstrap.js",
  };
  const env = createChildEnvironment(getLocalTestingConfig({}), inherited);
  expect(env.MONGO_URL).toBe("mongodb://127.0.0.1:27017/shio-local-testing");
  expect(env.REDIS_URL).toBe("redis://127.0.0.1:6379");
  expect(env.PORT).toBe("8080");
  expect(env.NODE_ENV).toBe("development");
  expect(env.SHIO_LOCAL_TESTING).toBe("1");
  expect(env.PATH).toBe("test-path");
  expect(env.SECRETSESSIONKEY).not.toBe("production-key");
  for (const key of [
    "DISCORDURL",
    "GITHUBCLIENTSECRET",
    "MGKEY",
    "MGDOMAIN",
    "CARDBACK_DIR",
    "DIAGNOSTICS_DIR",
    "IPBANSINDEV",
    "NODE_OPTIONS",
  ]) {
    expect(env).not.toHaveProperty(key);
  }
  expect(inherited.SECRETSESSIONKEY).toBe("production-key");
  expect(inherited.DISCORDURL).toBe("production-webhook");
});
