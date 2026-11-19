import { put, call, takeLatest } from "redux-saga/effects";
import buildEnhancedGameSummary from "../../models/game-summary/buildEnhancedGameSummary";
import buildReplay from "./replay/buildReplay";
import { updateMidsection } from "./actions/actions";
import { resolveReplayMoment } from "../shared/replay-moment";

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
  yield put(updateMidsection("default"));
}

function* loadReplay(action) {
  const { summary } = action;
  try {
    const game = buildEnhancedGameSummary(summary);
    const replay = buildReplay(game);
    const position = resolveReplayMoment(replay, action.moment);

    yield put({ type: "RECEIVE_REPLAY", replay, game, position });
    yield put(updateMidsection("replay"));
  } catch (error) {
    yield put({ type: "REPLAY_FAILED", error: { kind: "moment", message: error.message }, gameId: summary?._id });
  }
}

function* fetchReplay(action) {
  const { gameId } = action;

  yield put({ type: "REQUEST_REPLAY" });
  yield put(updateMidsection("replay"));

  try {
    const response = yield call(fetch, `/gameSummary?id=${encodeURIComponent(gameId)}`);
    const summary = yield call([response, "json"]);
    yield put({ type: "LOAD_REPLAY", summary, moment: action.moment });
  } catch (err) {
    yield put({ type: "REPLAY_NOT_FOUND" });
  }
}

export default function* rootSaga() {
  yield takeLatest("FETCH_PROFILE", fetchProfile);
  yield takeLatest("FETCH_REPLAY", fetchReplay);
  yield takeLatest("LOAD_REPLAY", loadReplay);
  yield takeLatest("CLOSE_REPLAY", closeReplay);
  yield takeLatest("UPDATE_MIDSECTION", updateMidsection);
}
