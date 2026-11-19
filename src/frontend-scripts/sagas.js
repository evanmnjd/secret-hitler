import { put, call, select, takeLatest } from "redux-saga/effects";
import { CANCEL } from "redux-saga";
import buildEnhancedGameSummary from "../../models/game-summary/buildEnhancedGameSummary";
import buildReplay from "./replay/buildReplay";
import { updateMidsection } from "./actions/actions";
import { validUid, resolveReplayMoment } from "../shared/replay-moment";

function* fetchProfile(action) {
  const { username } = action;

  yield put(updateMidsection("profile"));
  yield put({ type: "REQUEST_PROFILE" });

  try {
    const response = yield call(fetch, `/profile?username=${username}`);
    const profile = yield call([response, "json"]);
    yield put({ type: "RECEIVE_PROFILE", profile });
  } catch (err) {
    yield put({ type: "PROFILE_NOT_FOUND" });
  }
}

function* closeReplay() {
  yield put({ type: "CLEAR_REPLAY" });
  yield put(updateMidsection("default"));
}

const replayFailure = (kind, message) => Object.assign(new Error(message), { kind });

// Bound the complete request, including reading JSON, so a stalled response can be retried.
export const fetchReplaySummary = (gameId, timeoutMs = 15000) => {
  if (!validUid(gameId)) return Promise.reject(replayFailure("invalid", "This replay link is invalid."));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const request = Promise.resolve()
    .then(() => fetch(`/gameSummary?id=${encodeURIComponent(gameId)}`, controller ? { signal: controller.signal } : {}))
    .then((response) => {
      if (response.status === 404 || response.status === 410) {
        throw replayFailure("not_found", "This replay could not be found.");
      }
      if (!response.ok) throw replayFailure("server", "The replay server is unavailable. Please try again.");
      return response.json().catch(() => {
        throw replayFailure("invalid", "The saved replay could not be read.");
      });
    });
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(replayFailure("timeout", "Loading this replay timed out. Please try again."));
      if (controller) controller.abort();
    }, timeoutMs);
  });
  const result = Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  result[CANCEL] = () => {
    if (controller) {
      clearTimeout(timer);
      controller.abort();
    }
  };
  return result;
};

export function* loadReplay(action) {
  const { summary, requestId, moment } = action;
  const gameId = action.gameId || summary?._id;
  if (requestId !== undefined && (yield select((state) => state.replay.requestId)) !== requestId) return;
  try {
    if (!summary || !Array.isArray(summary.players) || !Array.isArray(summary.logs) || !summary.logs.length) {
      throw new Error("Incomplete replay archive.");
    }
    const game = buildEnhancedGameSummary(summary);
    const replay = buildReplay(game);
    let position;
    try {
      position = resolveReplayMoment(replay, moment);
    } catch (err) {
      throw replayFailure("moment", err.message);
    }
    yield put({ type: "RECEIVE_REPLAY", replay, game, position, requestId });
    if (requestId !== undefined && (yield select((state) => state.replay.requestId)) !== requestId) return;
    yield put(updateMidsection("replay"));
  } catch (err) {
    yield put({
      type: "REPLAY_FAILED",
      requestId,
      gameId,
      error: {
        kind: err.kind || "invalid",
        message:
          err.kind === "moment" ? err.message : "This saved replay is incomplete or damaged and could not be played.",
      },
    });
  }
}

let replayRequestId = 0;
export function* fetchReplay(action) {
  const { gameId, moment } = action;
  const requestId = ++replayRequestId;
  yield put({ type: "REQUEST_REPLAY", gameId, moment, requestId });
  yield put(updateMidsection("replay"));

  try {
    const summary = yield call(fetchReplaySummary, gameId);
    yield put({ type: "LOAD_REPLAY", summary, gameId, moment, requestId });
  } catch (err) {
    yield put({
      type: err.kind === "not_found" ? "REPLAY_NOT_FOUND" : "REPLAY_FAILED",
      requestId,
      gameId,
      error: {
        kind: err.kind || "network",
        message: err.kind ? err.message : "Unable to connect to the replay server. Please try again.",
      },
    });
  }
}

export default function* rootSaga() {
  yield takeLatest("FETCH_PROFILE", fetchProfile);
  yield takeLatest("FETCH_REPLAY", fetchReplay);
  yield takeLatest("LOAD_REPLAY", loadReplay);
  yield takeLatest("CLOSE_REPLAY", closeReplay);
  yield takeLatest("UPDATE_MIDSECTION", updateMidsection);
}
