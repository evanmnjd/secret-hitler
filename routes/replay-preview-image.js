const path = require("path");
const Jimp = require("jimp");

const PHASE_LABELS = {
  candidacy: "President selected",
  nomination: "Chancellor nominated",
  election: "Election result",
  topDeck: "Top-deck policy",
  presidentLegislation: "President legislation",
  chancellorLegislation: "Chancellor legislation",
  veto: "Veto",
  policyEnaction: "Policy enacted",
  investigation: "Investigation",
  policyPeek: "Policy peek",
  specialElection: "Special election",
  execution: "Execution",
  assassination: "Assassination",
};

// Only this public projection is handed to the renderer or retained in its cache.
const publicPreviewFrame = (uid, summary, snapshot) => ({
  uid,
  turn: snapshot.turnNum + 1,
  phase: snapshot.phase,
  phaseLabel: PHASE_LABELS[snapshot.phase],
  gameOver: Boolean(snapshot.gameOver),
  liberalPolicies: snapshot.track.blues,
  fascistPolicies: snapshot.track.reds,
  electionTracker: snapshot.electionTracker,
  presidentId: snapshot.specialElection === undefined ? snapshot.presidentId : snapshot.specialElection,
  chancellorId: snapshot.specialElection === undefined ? snapshot.chancellorId : undefined,
  customPowers: summary.customGameSettings?.enabled ? summary.customGameSettings.powers || [] : null,
  players: snapshot.players.toArray().map((player, seat) => ({
    seat,
    name: player.username,
    dead: Boolean(player.isDead),
    vote:
      snapshot.phase === "election" && snapshot.votes?.get(seat)?.isSome()
        ? snapshot.votes.get(seat).value()
        : undefined,
  })),
});

let assets;
const getAssets = () => {
  if (!assets) {
    const local = (name) => Jimp.read(path.join(__dirname, "../public/images", name));
    assets = Promise.all([
      Jimp.loadFont(Jimp.FONT_SANS_32_WHITE),
      Jimp.loadFont(Jimp.FONT_SANS_16_WHITE),
      local("tracks/liberaltrack.png"),
      local("tracks/fascisttrack56.png"),
      local("tracks/fascisttrack78.png"),
      local("tracks/fascisttrack910.png"),
      local("customtracks/fasTrack.png"),
      local("cards/liberalp-l.png"),
      local("cards/fascistp-l.png"),
    ]).catch((error) => {
      assets = undefined;
      throw error;
    });
  }
  return assets;
};

const cleanText = (value, length) =>
  String(value ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Do not render newlines or control bytes from names.
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, length);

const renderReplayPreview = async (frame) => {
  const [large, small, liberalTrack, fascist56, fascist78, fascist910, customTrack, liberalCard, fascistCard] =
    await getAssets();
  const image = new Jimp(1200, 630, 0x111722ff);
  image.composite(new Jimp(1200, 76, 0x314fa3ff), 0, 0);
  image.print(large, 20, 18, "SECRET HITLER / REPLAY");
  image.print(small, 706, 14, `Government ${frame.turn} - ${frame.phaseLabel}`);
  image.print(small, 706, 43, cleanText(frame.uid, 47));
  const fascistTrack = frame.customPowers
    ? customTrack
    : frame.players.length <= 6
      ? fascist56
      : frame.players.length <= 8
        ? fascist78
        : fascist910;
  image.composite(liberalTrack, 20, 91);
  image.composite(fascistTrack, 20, 313);
  const blueCard = liberalCard.clone().resize(90, 124);
  const redCard = fascistCard.clone().resize(90, 124);
  [92, 185, 278, 374, 467].slice(0, frame.liberalPolicies).forEach((x) => image.composite(blueCard, x + 20, 139));
  [46, 140, 233, 327, 420, 514].slice(0, frame.fascistPolicies).forEach((x) => image.composite(redCard, x + 20, 360));
  image.print(large, 706, 94, `${frame.liberalPolicies} LIBERAL / ${frame.fascistPolicies} FASCIST`);
  image.print(small, 706, 141, `Election tracker: ${frame.electionTracker} / 3`);
  image.print(small, 706, 169, frame.gameOver ? "Game ended at this moment" : "Players at this moment");
  frame.players.forEach((player, i) => {
    const y = 199 + i * 33;
    image.composite(new Jimp(474, 29, player.dead ? 0x4b2831ff : 0x243043ff), 706, y);
    const office = player.seat === frame.presidentId ? " [P]" : player.seat === frame.chancellorId ? " [C]" : "";
    const status = player.dead ? " - executed" : player.vote === undefined ? "" : player.vote ? " - JA" : " - NEIN";
    image.print(small, 716, y + 4, `${i + 1}. ${cleanText(player.name, 22)}${office}${status}`);
  });
  if (frame.customPowers) {
    image.print(small, 20, 548, `Custom powers: ${cleanText(frame.customPowers.join(", "), 83)}`);
  } else {
    image.print(small, 20, 548, "Public board state. Secret roles, hands and chats are hidden.");
  }
  image.print(small, 20, 588, `Government ${frame.turn} - ${frame.phaseLabel}. Open the link to watch this moment.`);
  return image.getBufferAsync(Jimp.MIME_PNG);
};

module.exports = { publicPreviewFrame, renderReplayPreview };
