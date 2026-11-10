const Account = require("../../../../models/account");
const { userList } = require("../../../../routes/socket/models");
const { CURRENTSEASONNUMBER } = require("../../../../src/frontend-scripts/node-constants");

jest.mock("../../../../routes/socket/user-requests", () => ({ sendUserList: jest.fn() }));

const { sendUserList } = require("../../../../routes/socket/user-requests");
const { handleUpdatedGameSettings } = require("../../../../routes/socket/user-events/settings");

describe("staff-incognito user-list rebuild", () => {
  afterEach(() => {
    userList.length = 0;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("preserves all current-season counters under their suffixed keys", async () => {
    const counters = {
      [`winsSeason${CURRENTSEASONNUMBER}`]: 7,
      [`lossesSeason${CURRENTSEASONNUMBER}`]: 5,
      [`rainbowWinsSeason${CURRENTSEASONNUMBER}`]: 3,
      [`rainbowLossesSeason${CURRENTSEASONNUMBER}`]: 2,
    };
    const account = {
      username: "staff",
      staffRole: "admin",
      gameSettings: { isPrivate: false, staffIncognito: false },
      ...counters,
      save: jest.fn((callback) => callback()),
    };
    jest.spyOn(Account, "findOne").mockResolvedValue(account);
    userList.push({ userName: "staff", ...counters });

    handleUpdatedGameSettings({ emit: jest.fn() }, { user: "staff" }, { staffIncognito: true });
    await Promise.resolve();

    expect(userList).toHaveLength(1);
    expect(userList[0]).toMatchObject({ userName: "staff", staffIncognito: true, ...counters });
    expect(Object.keys(userList[0]).some((key) => key.endsWith("Seasonundefined"))).toBe(false);
    expect(sendUserList).toHaveBeenCalled();
  });
});

describe("staff display preferences", () => {
  afterEach(() => {
    userList.length = 0;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    "admin",
    "editor",
    "moderator",
    "veteran",
  ])("immediately broadcasts saved %s display toggles in both directions", async (staffRole) => {
    const account = {
      username: "staff",
      staffRole,
      gameSettings: { isPrivate: false, staffIncognito: false },
      save: jest.fn((callback) => callback()),
    };
    jest.spyOn(Account, "findOne").mockResolvedValue(account);
    const live = { userName: "staff", staffRole, staffIncognito: false, status: { type: "playing", gameId: "active" } };
    userList.push(live);
    const socket = { emit: jest.fn() };
    for (const enabled of [true, false]) {
      const changes = {
        staffDisableStaffColor: enabled,
        staffDisableVisibleElo: enabled,
        staffDisableVisibleXP: enabled,
      };
      await handleUpdatedGameSettings(socket, { user: "staff" }, changes);
      expect(account.gameSettings).toMatchObject(changes);
      expect(live).toMatchObject({
        ...changes,
        staffRole,
        staffIncognito: false,
        status: { type: "playing", gameId: "active" },
      });
      expect(socket.emit).toHaveBeenLastCalledWith("gameSettings", account.gameSettings);
      expect(sendUserList).toHaveBeenCalled();
    }
  });

  it.each([
    undefined,
    "trialmod",
    "altmod",
    "contributor",
  ])("does not grant staff preferences to role %p", async (staffRole) => {
    const account = {
      username: "ordinary",
      staffRole,
      gameSettings: { isPrivate: false },
      save: jest.fn((callback) => callback()),
    };
    jest.spyOn(Account, "findOne").mockResolvedValue(account);
    const live = { userName: "ordinary", staffRole };
    userList.push(live);
    await handleUpdatedGameSettings(
      { emit: jest.fn() },
      { user: "ordinary" },
      { staffDisableStaffColor: true, staffDisableVisibleElo: true }
    );
    expect(account.gameSettings.staffDisableStaffColor).toBeUndefined();
    expect(account.gameSettings.staffDisableVisibleElo).toBeUndefined();
    expect(live.staffDisableStaffColor).toBeUndefined();
    expect(live.staffDisableVisibleElo).toBeUndefined();
  });

  it("keeps unrelated live preferences when a different toggle was loaded earlier", async () => {
    const account = {
      username: "staff",
      staffRole: "admin",
      gameSettings: { isPrivate: false, staffDisableVisibleElo: false },
      save: jest.fn((callback) => callback()),
    };
    jest.spyOn(Account, "findOne").mockResolvedValue(account);
    const live = { userName: "staff", staffRole: "admin", staffDisableVisibleElo: true };
    userList.push(live);
    await handleUpdatedGameSettings({ emit: jest.fn() }, { user: "staff" }, { staffDisableStaffColor: true });
    expect(live.staffDisableStaffColor).toBe(true);
    expect(live.staffDisableVisibleElo).toBe(true);
  });

  it("does not broadcast a failed display-preference save as if it succeeded", async () => {
    const error = new Error("write unavailable");
    jest.spyOn(console, "log").mockImplementation(() => {});
    const account = {
      username: "staff",
      staffRole: "admin",
      gameSettings: { isPrivate: false },
      save: jest.fn((callback) => callback(error)),
    };
    jest.spyOn(Account, "findOne").mockResolvedValue(account);
    const live = { userName: "staff", staffRole: "admin", staffDisableVisibleElo: false };
    userList.push(live);
    const socket = { emit: jest.fn() };
    await handleUpdatedGameSettings(socket, { user: "staff" }, { staffDisableVisibleElo: true });
    expect(live.staffDisableVisibleElo).toBe(false);
    expect(sendUserList).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
