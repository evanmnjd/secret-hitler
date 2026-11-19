const REPLAY_PHASES = [
  "candidacy",
  "nomination",
  "election",
  "topDeck",
  "presidentLegislation",
  "chancellorLegislation",
  "veto",
  "policyEnaction",
  "investigation",
  "policyPeek",
  "specialElection",
  "execution",
  "assassination",
];
const validUid = (uid) => typeof uid === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(uid);

const parseReplayMoment = (input) => {
  const params = typeof input === "string" ? new URLSearchParams(input) : input;
  const get = (key) => {
    if (params && typeof params.getAll === "function") {
      const values = params.getAll(key);
      if (values.length > 1) throw new Error("Invalid replay moment.");
      return values.length ? values[0] : undefined;
    }
    return params?.[key];
  };
  const turn = get("turn");
  const phase = get("phase");
  const end = get("end");
  if (turn === undefined && phase === undefined && end === undefined) return null;
  if (
    typeof turn !== "string" ||
    !/^[1-9]\d{0,5}$/.test(turn) ||
    !REPLAY_PHASES.includes(phase) ||
    (end !== undefined && end !== "1")
  ) {
    throw new Error("Invalid replay moment.");
  }
  return { turn: Number(turn), phase, end: end === "1" };
};

const parseReplayLocation = (location) => {
  if (typeof location !== "string" || location.length > 500) throw new Error("Invalid replay link.");
  const question = location.indexOf("?");
  const encodedUid = question < 0 ? location : location.slice(0, question);
  const uid = decodeURIComponent(encodedUid);
  if (!validUid(uid)) throw new Error("Invalid replay link.");
  return { uid, moment: parseReplayMoment(question < 0 ? "" : location.slice(question + 1)) };
};

const resolveReplayMoment = (ticks, moment) => {
  if (!moment) return 0;
  const position = ticks.findIndex(
    (tick) =>
      tick.turnNum + 1 === moment.turn && tick.phase === moment.phase && Boolean(tick.gameOver) === Boolean(moment.end)
  );
  if (position < 0) throw new Error("This replay does not contain that moment.");
  return position;
};

const replayMomentPath = (uid, snapshot) => {
  if (
    !validUid(uid) ||
    !Number.isInteger(snapshot?.turnNum) ||
    snapshot.turnNum < 0 ||
    snapshot.turnNum >= 999999 ||
    !REPLAY_PHASES.includes(snapshot.phase)
  ) {
    throw new Error("Unable to share this replay moment.");
  }
  return `/replay/${encodeURIComponent(uid)}?turn=${snapshot.turnNum + 1}&phase=${snapshot.phase}${snapshot.gameOver ? "&end=1" : ""}`;
};

module.exports = {
  REPLAY_PHASES,
  validUid,
  parseReplayMoment,
  parseReplayLocation,
  resolveReplayMoment,
  replayMomentPath,
};
