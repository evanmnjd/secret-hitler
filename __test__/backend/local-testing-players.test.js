const { EventEmitter } = require("events");
const {
  parsePlayerArgs,
  assertOrdinaryProfile,
  waitFor,
  connectPlayers,
} = require("../../scripts/local-testing/players");

it("only selects the bounded ordinary fixture player cohort", () => {
  expect(parsePlayerArgs([])).toEqual({ count: 8 });
  expect(parsePlayerArgs(["--count=4", "--game", "SomeLobbyRemake1"])).toEqual({ count: 4, game: "SomeLobbyRemake1" });
  expect(parsePlayerArgs(["--", "--count", "12"])).toEqual({ count: 12 });
});

it.each([
  [["--count", "0"]],
  [["--count", "13"]],
  [["--count", "1.5"]],
  [["--count"]],
  [["--game"]],
  [["--game", "https://example.com/table/Other"]],
  [["--game", " "]],
  [["--username", "LocalDemoAdmin"]],
])("rejects invalid or privileged client options %j", (args) => {
  expect(() => parsePlayerArgs(args)).toThrow();
});

it.each([
  "admin",
  "editor",
  "moderator",
  "trialmod",
  "altmod",
  "veteran",
])("refuses a fixture promoted to %s", (role) => {
  expect(() => assertOrdinaryProfile({ _id: "LocalDemoPlayer01", staffRole: role }, "LocalDemoPlayer01")).toThrow(
    /ordinary/
  );
});

it("also refuses missing or mismatched profiles", () => {
  expect(() => assertOrdinaryProfile(null, "LocalDemoPlayer01")).toThrow();
  expect(() => assertOrdinaryProfile({ _id: "SomeoneElse" }, "LocalDemoPlayer01")).toThrow();
  expect(() => assertOrdinaryProfile({ _id: "LocalDemoPlayer01", staffRole: "" }, "LocalDemoPlayer01")).not.toThrow();
});

it("rejects production configuration before any HTTP request", async () => {
  const fetchImpl = jest.fn();
  await expect(connectPlayers({}, { env: { NODE_ENV: "production" }, fetchImpl })).rejects.toThrow(/production/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("rejects a nonlocal configuration before any HTTP request", async () => {
  const fetchImpl = jest.fn();
  await expect(
    connectPlayers({}, { env: { LOCAL_TEST_MONGO_URL: "mongodb://example.com/shio-local-testing" }, fetchImpl })
  ).rejects.toThrow(/loopback/);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("waits for the actual matching game event and removes all temporary handlers", async () => {
  const socket = new EventEmitter();
  const update = waitFor(socket, "gameUpdate", (data) => data.uid === "Wanted");
  socket.emit("gameUpdate", { uid: "Other" });
  socket.emit("gameUpdate", { uid: "Wanted" });
  await expect(update).resolves.toEqual({ uid: "Wanted" });
  expect(socket.eventNames()).toEqual([]);
});

it("rejects a missing live lobby without mistaking its saved replay for a seat", async () => {
  const socket = new EventEmitter();
  const update = waitFor(socket, "gameUpdate", () => true);
  socket.emit("manualReplayRequest", "SavedGame");
  await expect(update).rejects.toThrow(/active lobby/);
  expect(socket.eventNames()).toEqual([]);
});

it("cleans up temporary handlers when a connection fails", async () => {
  const socket = new EventEmitter();
  const ready = waitFor(socket, "socketReady", () => true);
  socket.emit("connect_error", new Error("offline"));
  await expect(ready).rejects.toThrow(/offline/);
  expect(socket.eventNames()).toEqual([]);
});
