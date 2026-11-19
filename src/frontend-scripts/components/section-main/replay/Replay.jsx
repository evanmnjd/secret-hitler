/* eslint-disable spaced-comment */
import React from "react"; // eslint-disable-line no-unused-vars
import _ from "lodash";
import { connect } from "react-redux";
import toGameInfo from "../../../replay/toGameInfo";
import toDescription from "../../../replay/toDescription";
import classnames from "classnames";
import { Map, List } from "immutable";
import { some, none, fromNullable } from "option";
import Tracks from "../Tracks.jsx";
import Players from "../Players.jsx";
import ReplayGamechat from "./ReplayGamechat.jsx";
import ReplayOverlay from "./ReplayOverlay.jsx";
import ReplayControls from "./ReplayControls.jsx";
import ReplayTimeline from "./ReplayTimeline.jsx";
import ReplayMomentLink from "./ReplayMomentLink.jsx";
import TrackPieces from "./TrackPieces.jsx";
import socket from "../../../socket";
import PropTypes from "prop-types";
import * as Swal from "sweetalert2";
import { isReplayWhisper } from "../../../replay/chat";

const mapStateToProps = ({ replay, userInfo }) => ({
  replay,
  isSmall: userInfo.gameSettings && userInfo.gameSettings.enableRightSidebarInGame,
  userInfo: userInfo,
});

const mapDispatchToProps = (dispatch) => ({
  to: (position) => dispatch({ type: "REPLAY_TO", position }),
  exit: () => dispatch({ type: "CLOSE_REPLAY" }),
  retry: (gameId, moment) => dispatch({ type: "FETCH_REPLAY", gameId, moment }),
});

const buildPlayback = (replay, to) => {
  const { ticks, position } = replay;
  const snapshot = ticks.get(position);
  const { turnNum, phase } = snapshot;

  /***********
   * HELPERS *
   ***********/

  // (turnNum: Int, [phases: List[String] | phase: String]) => Int
  const findTickPos = (turnNum, _phases) => {
    const phases = List.isList(_phases) ? _phases : List([_phases]);

    const i = ticks.findLastIndex((t) => t.turnNum === turnNum && phases.includes(t.phase));

    return i > -1 ? some(i) : none;
  };

  const bindTo = (position) => to.bind(null, position);

  /***********
   * EXPORTS *
   ***********/

  const hasNext = position < ticks.size - 1;
  const hasPrev = position > 0;

  const toBeginning = bindTo(0);
  const toEnd = bindTo(ticks.size - 1);

  const nextTick = bindTo(position + 1);
  const prevTick = bindTo(position - 1);

  const { nextPhase, prevPhase } = (() => {
    const toTurnWithPhaseElseFallback = (targetTurn, end) => {
      const fallbacks = Map({
        presidentLegislation: List(["topDeck", "election"]),
        chancellorLegislation: List(["topDeck", "election"]),
        topDeck: List(["presidentLegislation", "election"]),
        veto: List(["presidentLegislation", "election"]),
        policyEnaction: List(["election"]),
        investigation: List(["policyEnaction", "election"]),
        policyPeek: List(["policyEnaction", "election"]),
        specialElection: List(["policyEnaction", "election"]),
        execution: List(["policyEnaction", "election"]),
      });

      const ideal = findTickPos(targetTurn, phase).map((pos) => bindTo(pos));

      const fallback = () =>
        bindTo(
          fromNullable(fallbacks.get(phase))
            .flatMap((fallbackPhases) => findTickPos(targetTurn, fallbackPhases))
            .valueOrElse(end)
        );

      return ideal.valueOrElse(fallback);
    };

    return {
      nextPhase: toTurnWithPhaseElseFallback(turnNum + 1, ticks.size - 1),
      prevPhase: toTurnWithPhaseElseFallback(turnNum - 1, 0),
    };
  })();

  const { hasLegislation, hasAction, toElection, toLegislation, toAction } = (() => {
    const rotate = (cycles, fallback) => {
      return findTickPos(turnNum, fromNullable(cycles.get(phase)).valueOrElse(fallback));
    };

    const electionPos = rotate(
      Map({
        candidacy: "nomination",
        nomination: "election",
        election: "candidacy",
      }),
      "candidacy"
    );

    const legislationPos = rotate(
      Map({
        presidentLegislation: List(["chancellorLegislation"]),
        chancellorLegislation: List(["veto", "policyEnaction"]),
        topDeck: List(["policyEnaction"]),
        veto: List(["policyEnaction", "topDeck", "presidentLegislation"]),
        policyEnaction: List(["presidentLegislation", "topDeck"]),
      }),
      List(["presidentLegislation", "topDeck"])
    );

    const actionPos = findTickPos(turnNum, List(["investigation", "policyPeek", "specialElection", "execution"]));

    return {
      hasLegislation: legislationPos.isSome(),
      hasAction: actionPos.isSome(),
      toElection: bindTo(electionPos.valueOrElse(position)),
      toLegislation: bindTo(legislationPos.valueOrElse(position)),
      toAction: bindTo(actionPos.valueOrElse(position)),
    };
  })();

  const toTurn = (targetTurn) => to(findTickPos(targetTurn, "candidacy").valueOrElse(position));

  return {
    hasNext,
    hasPrev,
    toBeginning,
    toEnd,
    nextTick,
    prevTick,
    nextPhase,
    prevPhase,
    hasLegislation,
    hasAction,
    toElection,
    toLegislation,
    toAction,
    toTurn,
  };
};

const Replay = ({
  replay,
  isSmall,
  userInfo,
  userList,
  to,
  gameData,
  chatsShown,
  allEmotes,
  hideHand: hideRolesAndHand,
  deckShown,
  chatStatus,
  chatError,
  retryChat,
  actions,
}) => {
  const { ticks, position, game } = replay;
  const snapshot = ticks.get(position);
  const playback = buildPlayback(replay, to);
  const gameInfo = _.merge(toGameInfo(snapshot), { general: gameData }); // this disgusting hack is sponsored by the schema being in a different format than in-memory games and in the name of backwards compatibility

  gameInfo.customGameSettings = game.summary.customGameSettings;
  if (gameInfo.customGameSettings && gameInfo.customGameSettings.enabled) {
    if (gameInfo.customGameSettings.powers._tail)
      gameInfo.customGameSettings.powers = gameInfo.customGameSettings.powers._tail.array;
  }
  const { phase } = snapshot;
  const description = toDescription(snapshot, game, userInfo, hideRolesAndHand);

  gameInfo.chats = chatsShown && gameData && gameData.chats && gameData.chats.length ? gameData.chats : [];

  return (
    <section className={classnames({ small: false /*isSmall*/, big: true /*!isSmall*/ }, "game")}>
      <div className="ui grid">
        <div className="row">
          <div className="left-side sixteen wide column">
            <ReplayOverlay key="replayoverlay" snapshot={snapshot} hideHand={hideRolesAndHand} />
            <TrackPieces
              key="trackpieces"
              phase={snapshot.phase}
              track={snapshot.track}
              electionTracker={snapshot.electionTracker}
            />
            <Tracks gameInfo={gameInfo} userInfo={userInfo} />
          </div>
          <div className="right-side">
            {actions}
            <ReplayControls
              turnsSize={ticks.last().turnNum + 1}
              turnNum={snapshot.turnNum}
              phase={phase}
              description={description}
              playback={playback}
              deck={snapshot.deckState}
              deckShown={deckShown}
              userInfo={userInfo}
              compact={chatsShown}
            />
            <ReplayTimeline ticks={ticks} position={position} onSeek={to} />
            {chatsShown &&
              (chatStatus === "READY" ? (
                <ReplayGamechat userInfo={userInfo} userList={userList} gameInfo={gameInfo} allEmotes={allEmotes} />
              ) : (
                <div className="ui message replay-chat-status" role={chatStatus === "ERROR" ? "alert" : "status"}>
                  <p>
                    {chatStatus === "LOADING"
                      ? "Loading replay chat…"
                      : chatError || "Replay chat has not been loaded."}
                  </p>
                  {(chatStatus === "ERROR" || chatStatus === "UNAVAILABLE") && (
                    <button className="ui button replay-chat-retry" onClick={retryChat}>
                      Retry chat
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="row players-container">
        <Players
          userList={userList}
          onClickedTakeSeat={null}
          userInfo={userInfo}
          gameInfo={gameInfo}
          deckInfo={snapshot.deckState}
          isReplay
          socket={socket}
          hideRoles={hideRolesAndHand && !snapshot.gameOver}
          deckShown={deckShown}
        />
      </div>
    </section>
  );
};

export class ReplayWrapper extends React.Component {
  constructor() {
    super();
    this.state = this.emptyData();
    this.selectedUid = null;
    this.requestEpoch = 0;
    this.requestTimers = {};
    this.mounted = false;
  }

  emptyData() {
    return {
      chatsShown: false,
      hiddenInfoShown: true,
      deckShown: false,
      legacyReplay: true,
      gameData: {},
      metadata: {},
      metadataStatus: "INITIAL",
      chatStatus: "INITIAL",
      chatError: null,
    };
  }

  componentDidMount() {
    this.mounted = true;
    this.selectReplay();
  }

  componentWillUnmount() {
    this.mounted = false;
    this.cancelRequests();
  }

  componentDidUpdate() {
    this.selectReplay();
  }

  cancelRequests() {
    this.requestEpoch += 1;
    Object.values(this.requestTimers).forEach(clearTimeout);
    this.requestTimers = {};
  }

  selectReplay() {
    const uid = this.props.replay.status === "READY" ? this.props.replay.game.id : null;
    if (uid === this.selectedUid) return;
    this.cancelRequests();
    this.selectedUid = uid;
    const tick = this.props.replay.ticks?.get(0);
    this.setState({ ...this.emptyData(), legacyReplay: !(tick?.deckState?.size > 0) }, () => {
      if (uid) this.requestData("metadata");
    });
  }

  requestData(kind) {
    const uid = this.selectedUid;
    const statusKey = kind === "chat" ? "chatStatus" : "metadataStatus";
    if (!uid || this.props.replay.status !== "READY" || this.state[statusKey] === "LOADING") return;
    const epoch = this.requestEpoch;
    this.setState({ [statusKey]: "LOADING", ...(kind === "chat" ? { chatError: null } : {}) });
    let completed = false;
    const receive = (response) => {
      if (
        completed ||
        !this.mounted ||
        epoch !== this.requestEpoch ||
        uid !== this.selectedUid ||
        this.props.replay.status !== "READY" ||
        this.props.replay.game.id !== uid
      )
        return;
      completed = true;
      clearTimeout(this.requestTimers[kind]);
      delete this.requestTimers[kind];
      if (response?.success === true && response.uid === uid && response.data?.uid === uid) {
        this.setState({ [kind === "chat" ? "gameData" : "metadata"]: response.data, [statusKey]: "READY" });
      } else {
        const unavailable = response?.uid === uid && response.code === "unavailable";
        this.setState({
          [statusKey]: unavailable ? "UNAVAILABLE" : "ERROR",
          ...(kind === "chat"
            ? {
                chatError: unavailable
                  ? "The board is available, but no chat archive was saved for this replay."
                  : "Replay chat could not be loaded. Please try again.",
              }
            : {}),
        });
      }
    };
    this.requestTimers[kind] = setTimeout(() => receive(null), 10000);
    // Acknowledgements belong to this request; legacy broadcast replies cannot replace another replay's data.
    socket.emit(kind === "chat" ? "getReplayGameData" : "getReplayMetadata", uid, receive);
  }

  render() {
    const toExit = () => {
      window.location.hash = "#/";
      this.props.exit();
    };
    const toggleChats = () => {
      if (this.props.replay.status !== "READY") return;
      const chatsShown = !this.state.chatsShown;
      this.setState({ chatsShown }, () => {
        if (chatsShown && this.state.chatStatus === "INITIAL") this.requestData("chat");
      });
    };

    const toggleHiddenInfo = () => {
      this.setState({
        hiddenInfoShown: !this.state.hiddenInfoShown,
      });
    };

    const toggleDeck = () => {
      if (this.state.legacyReplay) {
        Swal.fire("", "You cannot load deck information for a legacy replay.", "error");
      }

      this.setState({
        deckShown: !this.state.deckShown && !this.state.legacyReplay,
      });
    };

    const actions = (
      <div className="replay-actions">
        {!this.state.legacyReplay && (
          <button className="displaydeck ui inverted green button" onClick={toggleDeck}>
            {this.state.deckShown ? "Hide deck" : "Show deck"}
          </button>
        )}
        <button className="displayroles ui inverted purple button" onClick={toggleHiddenInfo}>
          {this.state.hiddenInfoShown ? "Hide roles/hands" : "Show roles/hands"}
        </button>
        <button
          className="displaychats ui inverted blue button"
          onClick={toggleChats}
          disabled={this.props.replay.status !== "READY"}
        >
          {this.state.chatsShown ? "Hide chats" : "Show chats"}
          {(this.state.gameData.chats || []).some(isReplayWhisper) && (
            <span className="replay-whisper-count">
              {` · ${this.state.gameData.chats.filter(isReplayWhisper).length} whispers`}
            </span>
          )}
        </button>
        <button className="exit ui inverted red button" onClick={toExit}>
          <i className="sign out icon" />
          Exit Replay
        </button>
        {this.props.replay.status === "READY" && (
          <ReplayMomentLink
            uid={this.props.replay.game.id}
            snapshot={this.props.replay.ticks.get(this.props.replay.position)}
          />
        )}
      </div>
    );

    const children = (() => {
      switch (this.props.replay.status) {
        case "INITIAL":
        case "LOADING":
          return (
            <div className="ui active dimmer">
              <div className="ui huge text loader">Loading</div>
            </div>
          );
        case "NOT_FOUND":
        case "ERROR":
          return (
            <div className="ui message replay-load-error" role="alert">
              <h2>{this.props.replay.status === "NOT_FOUND" ? "Replay not found" : "Unable to load replay"}</h2>
              <p>
                {this.props.replay.status === "NOT_FOUND"
                  ? "This replay may not have been saved or may no longer be available."
                  : this.props.replay.error?.message || "Please try loading this replay again."}
              </p>
              {this.props.replay.error?.kind === "moment" && this.props.replay.gameId && (
                <p>
                  <a href={`#/replay/${encodeURIComponent(this.props.replay.gameId)}`}>Open replay from beginning</a>
                </p>
              )}
              {this.props.replay.gameId && (
                <button
                  className="ui button replay-retry"
                  onClick={() => this.props.retry(this.props.replay.gameId, this.props.replay.moment)}
                >
                  Retry replay
                </button>
              )}
            </div>
          );
        case "READY":
          return (
            <Replay
              replay={this.props.replay}
              isSmall={this.props.isSmall}
              userInfo={this.props.userInfo}
              gameData={{
                ...this.props.replay.game.summary.gameSetting,
                ...this.state.metadata,
                ...this.state.gameData,
              }}
              chatStatus={this.state.chatStatus}
              chatError={this.state.chatError}
              retryChat={() => this.requestData("chat")}
              chatsShown={this.state.chatsShown}
              userList={this.props.userList}
              to={this.props.to}
              allEmotes={this.props.allEmotes}
              hideHand={!this.state.hiddenInfoShown}
              deckShown={this.state.deckShown}
              actions={actions}
            />
          );
      }
    })();

    return (
      <section id="replay" className="ui segment">
        {this.props.replay.status !== "READY" && actions}
        {this.props.replay.status === "READY" && ["ERROR", "UNAVAILABLE"].includes(this.state.metadataStatus) && (
          <div className="ui message replay-metadata-status" role="status">
            Table details could not be loaded. The replay board is still available.{" "}
            <button className="ui button replay-metadata-retry" onClick={() => this.requestData("metadata")}>
              Retry details
            </button>
          </div>
        )}
        {children}
      </section>
    );
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(ReplayWrapper);

Replay.propTypes = {
  actions: PropTypes.node,
  allEmotes: PropTypes.object,
  userInfo: PropTypes.object,
  userList: PropTypes.object,
};
