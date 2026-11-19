import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware, { runSaga } from "redux-saga";
import rootSaga, { fetchReplay, fetchReplaySummary, loadReplay } from "../sagas";
import { replay } from "../reducers/sh-app";
import fixture from "../../../__test__/mocks/mockGameSummary";

const response = (status, body = fixture) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("replay loading", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each([
    [404, "not_found"],
    [410, "not_found"],
    [500, "server"],
    [503, "server"],
  ])("distinguishes HTTP %s from a valid archive", async (status, kind) => {
    global.fetch.mockResolvedValue(response(status));
    await expect(fetchReplaySummary("generic-game")).rejects.toMatchObject({ kind });
  });

  it("distinguishes malformed JSON and bounds a stalled request", async () => {
    global.fetch.mockResolvedValue({ ...response(200), json: () => Promise.reject(new SyntaxError("bad archive")) });
    await expect(fetchReplaySummary("generic-game")).rejects.toMatchObject({ kind: "invalid" });
    jest.useFakeTimers();
    global.fetch.mockImplementation(() => new Promise(() => {}));
    const stalled = fetchReplaySummary("generic-game", 100);
    jest.advanceTimersByTime(100);
    await expect(stalled).rejects.toMatchObject({ kind: "timeout" });
  });

  it("retains the requested replay and moment when a network failure can be retried", async () => {
    global.fetch.mockRejectedValue(new Error("offline"));
    const actions = [];
    const moment = { turn: 1, phase: "election", end: false };
    await runSaga({ dispatch: (action) => actions.push(action) }, fetchReplay, { gameId: "generic-game", moment }).done;
    expect(actions.find((action) => action.type === "REQUEST_REPLAY")).toMatchObject({
      gameId: "generic-game",
      moment,
    });
    expect(actions.find((action) => action.type === "REPLAY_FAILED")).toMatchObject({
      gameId: "generic-game",
      error: { kind: "network" },
    });
  });

  it("catches a corrupt summary without killing the watcher, then successfully loads another replay", async () => {
    const middleware = createSagaMiddleware();
    const store = createStore(
      (state = {}, action) => ({ replay: replay(state.replay, action) }),
      applyMiddleware(middleware)
    );
    const root = middleware.run(rootSaga);
    store.dispatch({ type: "LOAD_REPLAY", summary: { _id: "damaged", players: [], logs: [{}] } });
    expect(store.getState().replay).toMatchObject({ status: "ERROR", error: { kind: "invalid" } });
    global.fetch.mockResolvedValue(response(200));
    store.dispatch({
      type: "FETCH_REPLAY",
      gameId: "generic-game",
      moment: { turn: 1, phase: "election", end: false },
    });
    await flush();
    expect(root.isRunning()).toBe(true);
    expect(store.getState().replay.status).toBe("READY");
    expect(store.getState().replay.ticks.get(store.getState().replay.position).phase).toBe("election");
    root.cancel();
  });

  it("rejects an invalid requested moment and ignores a delayed load from a previous request", async () => {
    const actions = [];
    await runSaga({ dispatch: (action) => actions.push(action) }, loadReplay, {
      summary: fixture,
      moment: { turn: 999, phase: "election" },
    }).done;
    expect(actions[0]).toMatchObject({ type: "REPLAY_FAILED", error: { kind: "moment" } });
    actions.length = 0;
    await runSaga(
      { dispatch: (action) => actions.push(action), getState: () => ({ replay: { requestId: 2 } }) },
      loadReplay,
      {
        summary: fixture,
        requestId: 1,
      }
    ).done;
    expect(actions).toHaveLength(0);
    const state = replay(undefined, { type: "REQUEST_REPLAY", requestId: 2, gameId: "second" });
    expect(replay(state, { type: "RECEIVE_REPLAY", requestId: 1 })).toBe(state);
    expect(replay(state, { type: "REPLAY_FAILED", requestId: 1 })).toBe(state);
    expect(replay(state, { type: "REPLAY_NOT_FOUND", requestId: 1 })).toBe(state);
  });

  it("aborts the previous board request when switching replays quickly", async () => {
    let firstSignal;
    global.fetch.mockImplementation((url, options) => {
      if (url.includes("first")) {
        firstSignal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve(response(200, { ...fixture, _id: "second" }));
    });
    const middleware = createSagaMiddleware();
    const store = createStore(
      (state = {}, action) => ({ replay: replay(state.replay, action) }),
      applyMiddleware(middleware)
    );
    const root = middleware.run(rootSaga);
    store.dispatch({ type: "FETCH_REPLAY", gameId: "first" });
    await flush();
    store.dispatch({ type: "FETCH_REPLAY", gameId: "second" });
    await flush();
    expect(firstSignal.aborted).toBe(true);
    expect(store.getState().replay).toMatchObject({ status: "READY", gameId: "second" });
    root.cancel();
  });

  it("does not reopen a replay when an in-flight request finishes after Exit Replay", async () => {
    let finish;
    global.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const middleware = createSagaMiddleware();
    const reducer = (state = { midSection: "default" }, action) => ({
      replay: replay(state.replay, action),
      midSection: action.type === "UPDATE_MIDSECTION" ? action.midSection : state.midSection,
    });
    const store = createStore(reducer, applyMiddleware(middleware));
    const root = middleware.run(rootSaga);
    store.dispatch({ type: "FETCH_REPLAY", gameId: "generic-game" });
    await flush();
    store.dispatch({ type: "CLOSE_REPLAY" });
    finish(response(200));
    await flush();
    expect(store.getState()).toMatchObject({ replay: { status: "INITIAL" }, midSection: "default" });
    root.cancel();
  });
});
