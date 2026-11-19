import { App } from "../../src/frontend-scripts/components/App";
import socket from "../../src/frontend-scripts/socket";
import reducer from "../../src/frontend-scripts/reducers/sh-app";
import { fetchReplay } from "../../src/frontend-scripts/actions/actions";

afterEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const route = (location) => {
  jest.spyOn(socket, "emit").mockImplementation(() => socket);
  const app = new App();
  app.props = { userInfo: { userName: "Ada" }, gameInfo: {}, dispatch: jest.fn() };
  window.history.replaceState(null, "", location);
  app.router(true);
  return app.props.dispatch;
};

it("keeps the replay UID separate from the deep-link query", () => {
  const dispatch = route("/game/#/replay/table-123?turn=4&phase=execution&end=1");
  expect(socket.emit).toHaveBeenCalledWith("updateUserStatus", "replay", "table-123");
  expect(dispatch).toHaveBeenCalledWith(fetchReplay("table-123", { turn: 4, phase: "execution", end: true }));
});

it("keeps plain replay hashes compatible", () => {
  const dispatch = route("/game/#/replay/old-table");
  expect(dispatch).toHaveBeenCalledWith(fetchReplay("old-table", null));
});

it("shows malformed links as errors before making an archive request", () => {
  const dispatch = route("/game/#/replay/table?turn=2&phase=bogus");
  expect(dispatch.mock.calls.some(([action]) => action.type === "FETCH_REPLAY")).toBe(false);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: "REPLAY_FAILED", error: expect.objectContaining({ kind: "moment" }) })
  );
});

it("opens fetched replay snapshots at their resolved initial position", () => {
  const state = reducer(undefined, { type: "RECEIVE_REPLAY", replay: "ticks", game: "game", position: 18 });
  expect(state.replay.position).toBe(18);
  expect(reducer(undefined, { type: "RECEIVE_REPLAY", replay: "ticks", game: "game" }).replay.position).toBe(0);
});
