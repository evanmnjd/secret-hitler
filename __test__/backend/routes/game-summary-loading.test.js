jest.mock("../../../routes/socket/routes", () => ({ socketRoutes: jest.fn() }));
jest.mock("../../../routes/accounts", () => ({ accounts: jest.fn() }));
jest.mock("node-fetch", () => jest.fn(() => Promise.resolve({ text: () => Promise.resolve("") })));
jest.mock("../../../models/game-summary", () => ({ findById: jest.fn() }));

const GameSummary = require("../../../models/game-summary");
const registerRoutes = require("../../../routes/index");

let handler, summaryQuery, previousApp;
beforeAll(() => {
  previousApp = global.app;
  global.app = {
    get: jest.fn((path, ...handlers) => {
      if (path === "/gameSummary") handler = handlers[handlers.length - 1];
    }),
    post: jest.fn(),
  };
  registerRoutes();
});
afterAll(() => {
  global.app = previousApp;
});
beforeEach(() => {
  jest.clearAllMocks();
  summaryQuery = {
    maxTimeMS: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue({ _id: "table", logs: [] }),
  };
  GameSummary.findById.mockReturnValue(summaryQuery);
});

const request = (query) =>
  new Promise((resolve) => {
    const response = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      send(body) {
        resolve({ code: this.code, body });
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    handler({ query }, response);
  });

describe("game summary loading responses", () => {
  it("returns the archived board and bounds database execution time", async () => {
    await expect(request({ id: "table" })).resolves.toEqual({ code: 200, body: { _id: "table", logs: [] } });
    expect(GameSummary.findById).toHaveBeenCalledWith("table");
    expect(summaryQuery.maxTimeMS).toHaveBeenCalledWith(3000);
    expect(summaryQuery.lean).toHaveBeenCalled();
  });

  it.each([
    {},
    { id: "" },
    { id: "a".repeat(201) },
    { id: { $ne: "" } },
    { id: ["table"] },
  ])("rejects malformed or unbounded identifiers before querying (%j)", async (query) => {
    await expect(request(query)).resolves.toEqual({ code: 404, body: "Game summary not found" });
    expect(GameSummary.findById).not.toHaveBeenCalled();
  });

  it("uses 404 for a missing archive", async () => {
    summaryQuery.exec.mockResolvedValue(null);
    await expect(request({ id: "missing" })).resolves.toEqual({ code: 404, body: "Game summary not found" });
  });

  it("uses 404 for a malformed database identifier", async () => {
    const error = new Error("Invalid identifier");
    error.name = "CastError";
    summaryQuery.exec.mockRejectedValue(error);
    await expect(request({ id: "invalid" })).resolves.toEqual({ code: 404, body: "Game summary not found" });
  });

  it("uses a retryable 503 for database failures without exposing the database error", async () => {
    const log = jest.spyOn(console, "debug").mockImplementation(() => {});
    summaryQuery.exec.mockRejectedValue(new Error("private database failure"));
    await expect(request({ id: "table" })).resolves.toEqual({
      code: 503,
      body: "Unable to load game summary right now",
    });
    log.mockRestore();
  });
});
