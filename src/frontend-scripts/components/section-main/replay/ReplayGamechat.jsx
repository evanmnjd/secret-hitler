import React from "react";
import { connect } from "react-redux";
import PropTypes from "prop-types";
import { Scrollbars } from "react-custom-scrollbars";
import { loadReplay, updateUser } from "../../../actions/actions";
import { processEmotes } from "../../../emotes";
import { PLAYERCOLORS } from "../../../constants";
import NeighborChatReport from "../../reusable/NeighborChatReport";
import { isReplayWhisper } from "../../../replay/chat";
import { matchesReplayChat, replayChatOptions, replayChatText } from "../../../replay/chat-filters";

const mapDispatchToProps = (dispatch) => ({
  loadReplay: (summary) => dispatch(loadReplay(summary)),
  updateUser: (userInfo) => dispatch(updateUser(userInfo)),
});

export class ReplayGamechat extends React.Component {
  state = {
    showFullChat: false,
    showPlayerChat: true,
    showGameChat: true,
    showObserverChat: true,
    showWhispers: false,
    showPublicChat: true,
    searchText: "",
    selectedPlayer: "",
    selectedPair: "",
  };

  componentDidUpdate(previous) {
    // Searching, changing filters, and moving through the board must not pull
    // someone away from the older messages they are reading.
    if (previous.gameInfo.chats !== this.props.gameInfo.chats) this.scrollChats();
  }

  handleChatScrolled = () => {
    const bar = this.scrollbar;
    if (!bar) return;
    const scrolledFromBottom =
      bar.getValues().scrollHeight - (bar.getValues().scrollTop + bar.getValues().clientHeight - 1);

    if (this.state.lock && scrolledFromBottom < 20) {
      this.setState({ lock: false });
      this.scrollbar.scrollToBottom();
    } else if (!this.state.lock && scrolledFromBottom >= 20) {
      this.setState({ lock: true });
    }
  };

  scrollChats() {
    if (!this.state.lock && this.scrollbar) {
      this.scrollbar.scrollToBottom();
    }
  }

  handleChatFilterClick = (e) => {
    const filter = e.currentTarget.getAttribute("data-filter");
    switch (filter) {
      case "Player":
        this.setState({ showPlayerChat: !this.state.showPlayerChat });
        break;
      case "Game":
        this.setState({ showGameChat: !this.state.showGameChat });
        break;
      case "Spectator":
        this.setState({ showObserverChat: !this.state.showObserverChat });
        break;
      case "History":
        this.setState({ showFullChat: !this.state.showFullChat });
        break;
      case "Whispers":
        this.setState({ showWhispers: !this.state.showWhispers });
        break;
      case "Public":
        this.setState({ showPublicChat: !this.state.showPublicChat });
        break;
      default:
        console.log(`Unknown filter: ${filter}`);
    }
  };

  clearSearchFilters = () => {
    this.setState({ searchText: "", selectedPlayer: "", selectedPair: "" });
  };

  orderedChats = () => {
    const source = this.props.gameInfo.chats || [];
    if (this.chatSource !== source) {
      this.chatSource = source;
      this.sortedChats = [...source].sort((a, b) => {
        const difference = new Date(a.timestamp) - new Date(b.timestamp);
        return difference || replayChatText(a).localeCompare(replayChatText(b));
      });
    }
    return this.sortedChats;
  };

  filteredChats = () => {
    const { gameInfo } = this.props;
    const names = (gameInfo.publicPlayersState || []).map((player) => player.userName);
    const { showPlayerChat, showGameChat, showObserverChat, showWhispers, showPublicChat, showFullChat } = this.state;
    const matches = this.orderedChats().filter((chat) => {
      const visible = isReplayWhisper(chat)
        ? showWhispers
        : showPublicChat &&
          (chat.isBroadcast ||
            (showPlayerChat && !chat.gameChat && !chat.isClaim && names.includes(chat.userName)) ||
            (showGameChat && (chat.gameChat || chat.isClaim)) ||
            (showObserverChat && !chat.gameChat && !names.includes(chat.userName)) ||
            (!names.includes(chat.userName) &&
              chat.staffRole &&
              !["trialmod", "altmod", "veteran"].includes(chat.staffRole)));
      return visible && matchesReplayChat(chat, this.state);
    });
    return { rows: showFullChat ? matches : matches.slice(-250), matchingCount: matches.length };
  };

  handleTimestamps(timestamp) {
    const { userInfo } = this.props;

    if (userInfo && userInfo.userName && userInfo.gameSettings && userInfo.gameSettings.enableTimestamps) {
      const hours = `0${new Date(timestamp).getHours()}`.slice(-2);
      const minutes = `0${new Date(timestamp).getMinutes()}`.slice(-2);
      const seconds = `0${new Date(timestamp).getSeconds()}`.slice(-2);

      return <span className="chat-timestamp">{`${hours}:${minutes}:${seconds} `}</span>;
    }
  }

  getClassesFromType = (type) => {
    if (type === "player") {
      return "chat-player";
    } else {
      return `chat-role--${type}`;
    }
  };

  parseClaim = (claim) => {
    const { userInfo } = this.props;

    const mode = (userInfo && userInfo.gameSettings && userInfo.gameSettings.claimCharacters) || "legacy";
    let liberalChar = "L";
    let fascistChar = "F";
    if (mode === "legacy") {
      liberalChar = "B";
      fascistChar = "R";
    } else if (mode === "full") {
      liberalChar = "liberal";
      fascistChar = "fascist";
    }
    const claims = Array.from(claim);
    const elements = claims.map((claimChar, index) => {
      const isLiberal = claimChar === "b";

      return (
        <span key={`claim${index}`}>
          <span className={this.getClassesFromType(isLiberal ? "liberal" : "fascist")}>
            {isLiberal ? liberalChar : fascistChar}
          </span>
          {mode === "full" && index < claims.length - 1 ? <span>, </span> : <React.Fragment />}
        </span>
      );
    });
    return elements;
  };

  processChats(rows) {
    const { gameInfo, userInfo, userList } = this.props;
    const { gameSettings } = userInfo;
    const seatedUserNames = gameInfo.publicPlayersState
      ? gameInfo.publicPlayersState.map((player) => player.userName)
      : [];
    const time = new Date().getTime();
    /**
     * @param {array} tournyWins - array of tournywins in epoch ms numbers (date.getTime())
     * @return {jsx}
     */
    const renderCrowns = (tournyWins) => {
      return tournyWins
        .filter((winTime) => time - winTime < 10800000)
        .map((crown) => <span key={crown} title="This player has recently won a tournament." className="crown-icon" />);
    };

    const renderPreviousSeasonAward = (type) => {
      switch (type) {
        case "bronze":
          return (
            <span
              title="This player was in the 3rd tier of ranks in the previous season"
              className="season-award bronze"
            />
          );
        case "silver":
          return (
            <span
              title="This player was in the 2nd tier of ranks in the previous season"
              className="season-award silver"
            />
          );
        case "gold":
          return (
            <span
              title="This player was in the top tier of ranks in the previous season"
              className="season-award gold"
            />
          );
        case "gold1":
          return (
            <span title="This player was the #1 ranked player of the previous season" className="season-award gold1" />
          );
        case "gold2":
          return (
            <span title="This player was 2nd highest player of the previous season" className="season-award gold2" />
          );
        case "gold3":
          return (
            <span title="This player was 3rd highest player of the previous season" className="season-award gold3" />
          );
        case "gold4":
          return (
            <span title="This player was 4th highest player of the previous season" className="season-award gold4" />
          );
        case "gold5":
          return (
            <span title="This player was 5th highest player of the previous season" className="season-award gold5" />
          );
      }
    };

    if (gameInfo && gameInfo.chats) {
      const list = rows || this.filteredChats().rows;
      return list.reduce((acc, chat, i) => {
        const playerListPlayer = Object.keys(userList).length
          ? userList.list.find((player) => player.userName === chat.userName)
          : undefined;
        const isMod =
          playerListPlayer &&
          playerListPlayer.staffRole &&
          playerListPlayer.staffRole !== "" &&
          playerListPlayer.staffRole !== "trialmod" &&
          playerListPlayer.staffRole !== "altmod" &&
          playerListPlayer.staffRole !== "veteran";
        const chatContents = processEmotes(chat.chat, isMod, this.props.allEmotes);
        const isSeated = seatedUserNames.includes(chat.userName);
        const isGreenText = chatContents && chatContents[0] ? /^>/i.test(chatContents[0]) : false;
        if (isReplayWhisper(chat)) {
          const { sender, recipient } = chat.neighborChat || {};
          const seatName = (name) => {
            const seat = seatedUserNames.indexOf(name);
            return seat < 0 ? name : `#${seat + 1} ${name}`;
          };
          const label =
            sender && recipient
              ? `${seatName(sender)} → ${seatName(recipient)}`
              : Array.isArray(chat.chat)
                ? chat.chat[0]?.text
                : "Archived Neighbor Chat";
          const segments = Array.isArray(chat.chat)
            ? chat.chat.filter((segment) => segment?.type === "neighbor-chat")
            : [];
          acc.push(
            <div className="item neighbor-chat replay-whisper" key={chat.neighborChat?.id || i}>
              <div className="replay-whisper-heading">
                <i className="lock icon" aria-hidden="true" />
                <span className="replay-whisper-label">Whisper · {label}</span>
                {this.handleTimestamps(chat.timestamp)}
              </div>
              <span className="chat-role--neighbor-chat">
                {segments.length
                  ? segments.map((segment, index) => (
                      <React.Fragment key={index}>
                        {processEmotes(segment.text, isMod, this.props.allEmotes)}
                      </React.Fragment>
                    ))
                  : chatContents}
              </span>
              {chat.neighborChat?.id && (
                <NeighborChatReport chat={chat} username={userInfo.userName} gameUid={gameInfo.general?.uid} />
              )}
            </div>
          );
          return acc;
        }
        acc.push(
          chat.gameChat ? (
            <div
              className={chat.chat[1] && chat.chat[1].type ? `item game-chat ${chat.chat[1].type}` : "item game-chat"}
              key={i}
            >
              {this.handleTimestamps(chat.timestamp)}
              <span className="game-chat">
                {chatContents.map((chatSegment, index) => {
                  if (chatSegment.type) {
                    const classes = this.getClassesFromType(chatSegment.type);

                    return (
                      <span key={index} className={classes}>
                        {chatSegment.type === "neighbor-chat"
                          ? processEmotes(chatSegment.text, isMod, this.props.allEmotes)
                          : chatSegment.text}
                      </span>
                    );
                  }

                  return chatSegment.text;
                })}
              </span>
              {chat.neighborChat?.id && (
                <NeighborChatReport chat={chat} username={userInfo.userName} gameUid={gameInfo.general?.uid} />
              )}
            </div>
          ) : chat.isRemainingPolicies ? (
            <div className={"item game-chat"} key={i}>
              {this.handleTimestamps(chat.timestamp)}
              <span className="game-chat">
                {chatContents &&
                  chatContents.length &&
                  chatContents.map((chatSegment, index) => {
                    if (chatSegment.type) {
                      return (
                        <span key={index} className={this.getClassesFromType(chatSegment.type)}>
                          {chatSegment.text}
                        </span>
                      );
                    } else if (chatSegment.policies) {
                      return <span key={index}>{this.parseClaim(chatSegment.policies)}</span>;
                    }
                    return chatSegment.text;
                  })}
              </span>
            </div>
          ) : chat.isClaim ? (
            <div className="item claim-item" key={i}>
              {this.handleTimestamps(chat.timestamp)}
              <span className="claim-chat">
                {chatContents &&
                  chatContents.length &&
                  chatContents.map((chatSegment, index) => {
                    if (chatSegment.type) {
                      return (
                        <span key={index} className={this.getClassesFromType(chatSegment.type)}>
                          {chatSegment.text}
                        </span>
                      );
                    } else if (chatSegment.claim) {
                      return <span key={index}>{this.parseClaim(chatSegment.claim)}</span>;
                    }
                    return chatSegment.text;
                  })}
              </span>
            </div>
          ) : chat.isBroadcast ? (
            <div className="item" key={i}>
              <span className="chat-user broadcast">
                {this.handleTimestamps(chat.timestamp)} {`${chat.userName}: `}{" "}
              </span>
              <span className="broadcast-chat">{processEmotes(chat.chat, true, this.props.allEmotes)}</span>
            </div>
          ) : (
            <div className="item" key={i}>
              {this.handleTimestamps(chat.timestamp)}
              {!(gameSettings && Object.keys(gameSettings).length && gameSettings.disableCrowns) &&
                chat.tournyWins &&
                renderCrowns(chat.tournyWins)}
              {!(gameSettings && Object.keys(gameSettings).length && gameSettings.disableCrowns) &&
                chat.previousSeasonAward &&
                renderPreviousSeasonAward(chat.previousSeasonAward)}
              <span
                className={
                  chat.staffRole === "moderator" && chat.userName === "Incognito"
                    ? "chat-user moderatorcolor"
                    : !playerListPlayer || (gameSettings && gameSettings.disablePlayerColorsInChat)
                      ? isMod && !isSeated
                        ? PLAYERCOLORS(playerListPlayer, !(gameSettings && gameSettings.disableSeasonal), "chat-user")
                        : "chat-user"
                      : PLAYERCOLORS(playerListPlayer, !(gameSettings && gameSettings.disableSeasonal), "chat-user")
                }
              >
                {isSeated ? (
                  ""
                ) : chat.staffRole === "moderator" ? (
                  <span data-tooltip="Moderator" data-inverted>
                    <span className="moderatorcolor">(Mod) 🌀</span>
                  </span>
                ) : chat.staffRole === "editor" ? (
                  <span data-tooltip="Editor" data-inverted>
                    <span
                      className={
                        !playerListPlayer || (gameSettings && gameSettings.disablePlayerColorsInChat)
                          ? isMod && !isSeated
                            ? PLAYERCOLORS(
                                playerListPlayer,
                                !(gameSettings && gameSettings.disableSeasonal),
                                "chat-user"
                              )
                            : "chat-user"
                          : PLAYERCOLORS(playerListPlayer, !(gameSettings && gameSettings.disableSeasonal), "chat-user")
                      }
                    >
                      (Editor) 🔰
                    </span>
                  </span>
                ) : chat.staffRole === "admin" ? (
                  <span data-tooltip="Admin" data-inverted>
                    <span className="admincolor">(Admin) 📛</span>
                  </span>
                ) : (
                  <span className="observer-chat">(Observer) </span>
                )}
                {isSeated
                  ? `${chat.userName} {${gameInfo.publicPlayersState.findIndex((publicPlayer) => publicPlayer.userName === chat.userName) + 1}}`
                  : chat.userName}
                {": "}
              </span>
              <span className={isGreenText ? "greentext" : ""}>{chatContents}</span>{" "}
            </div>
          )
        );

        return acc;
      }, []);
    }
  }

  render() {
    const { userInfo, gameInfo } = this.props;
    const {
      showPlayerChat,
      showGameChat,
      showObserverChat,
      showFullChat,
      showWhispers,
      showPublicChat,
      searchText,
      selectedPlayer,
      selectedPair,
    } = this.state;
    const whisperCount = (gameInfo.chats || []).filter(isReplayWhisper).length;
    const options = replayChatOptions(
      gameInfo.chats || [],
      (gameInfo.publicPlayersState || []).map((player) => player.userName)
    );
    const filtered = this.filteredChats();
    const chats = this.processChats(filtered.rows);
    const hasSearchFilters = Boolean(searchText || selectedPlayer || selectedPair);

    return (
      <section className="gamechat replay-chat">
        <section className="ui pointing menu">
          <a className={"item"} onClick={this.handleChatFilterClick} data-filter="Player" style={{ marginLeft: "5px" }}>
            <i
              className={`large comment icon${showPlayerChat ? " alternate" : ""}`}
              title={showPlayerChat ? "Hide player chats" : "Show player chats"}
              style={{ color: showPlayerChat ? "#4169e1" : "indianred" }}
            />
          </a>
          <a className={"item"} onClick={this.handleChatFilterClick} data-filter="Game">
            <i
              className={`large circle icon${showGameChat ? " info" : ""}`}
              title={showGameChat ? "Hide game chats" : "Show game chats"}
              style={{ color: showGameChat ? "#4169e1" : "indianred" }}
            />
          </a>
          {gameInfo.general && !gameInfo.general.disableObserver && (
            <a className={"item"} onClick={this.handleChatFilterClick} data-filter="Spectator">
              <i
                className={`large eye icon${!showObserverChat ? " slash" : ""}`}
                title={showObserverChat ? "Hide observer chats" : "Show observer chats"}
                style={{ color: showObserverChat ? "#4169e1" : "indianred" }}
              />
            </a>
          )}
          <a className={"item"} onClick={this.handleChatFilterClick} data-filter="History">
            <i
              className={`large file icon${showFullChat ? " alternate" : ""}`}
              title={showFullChat ? "Truncate chats to 250 lines" : "Show entire history (might lag in longer games)"}
              style={{ color: showFullChat ? "#4169e1" : "indianred" }}
            />
          </a>
          {(gameInfo.general?.neighborChat || whisperCount > 0) && (
            <React.Fragment>
              <button
                type="button"
                className="item replay-whisper-filter"
                data-filter="Whispers"
                onClick={this.handleChatFilterClick}
                aria-pressed={showWhispers}
                title={showWhispers ? "Hide neighbor whispers" : "Show neighbor whispers"}
              >
                <i className="lock icon" aria-hidden="true" />
                {showWhispers ? "Hide whispers" : "Show whispers"} ({whisperCount})
              </button>
              <button
                type="button"
                className="item replay-public-filter"
                data-filter="Public"
                onClick={this.handleChatFilterClick}
                aria-pressed={showPublicChat}
                title={showPublicChat ? "Hide public chat, game messages and observer chat" : "Show public chat"}
              >
                <i className="comments icon" aria-hidden="true" />
                {showPublicChat ? "Hide public chat" : "Show public chat"}
              </button>
            </React.Fragment>
          )}
        </section>
        <div className="replay-chat-search-controls">
          <label htmlFor="replay-chat-search">
            Search chat
            <input
              id="replay-chat-search"
              type="search"
              value={searchText}
              maxLength={200}
              placeholder="Search saved messages"
              onChange={(event) => this.setState({ searchText: event.target.value })}
            />
          </label>
          <label htmlFor="replay-chat-player">
            Player
            <select
              id="replay-chat-player"
              value={selectedPlayer}
              title="Public messages by this player and whispers involving them"
              onChange={(event) => this.setState({ selectedPlayer: event.target.value })}
            >
              <option value="">All players</option>
              {options.players.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {showWhispers && options.pairs.length > 0 && (
            <label htmlFor="replay-chat-pair">
              Whisper pair
              <select
                id="replay-chat-pair"
                value={selectedPair}
                onChange={(event) => this.setState({ selectedPair: event.target.value })}
              >
                <option value="">All conversations</option>
                {options.pairs.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="ui button replay-chat-clear-filters"
            onClick={this.clearSearchFilters}
            disabled={!hasSearchFilters}
          >
            Clear filters
          </button>
        </div>
        <p
          className="replay-chat-match-count"
          role="status"
          title="Search checks all saved messages in the shown channels before the 250-message display limit."
        >
          {filtered.matchingCount > filtered.rows.length
            ? `Showing latest ${filtered.rows.length} of ${filtered.matchingCount} matching messages. Enable entire history to show all.`
            : `${filtered.matchingCount} matching message${filtered.matchingCount === 1 ? "" : "s"}.`}
        </p>
        {(gameInfo.general?.neighborChat || whisperCount > 0) && (
          <p className="replay-chat-privacy">
            Neighbor chats are private during play and visible to everyone in replays.
          </p>
        )}
        <section
          style={{
            fontSize:
              userInfo.gameSettings && userInfo.gameSettings.fontSize ? `${userInfo.gameSettings.fontSize}px` : "16px",
          }}
          className={this.state.claim ? "segment chats blurred" : "segment chats"}
        >
          <Scrollbars
            ref={(c) => (this.scrollbar = c)}
            onScroll={this.handleChatScrolled}
            renderThumbVertical={(props) => <div {...props} className="thumb-vertical" />}
          >
            <div className="ui list" style={{ color: "var(--theme-text-1)" }}>
              {chats?.length ? (
                chats
              ) : (
                <div className="replay-chat-empty">
                  {hasSearchFilters ? "No messages match these filters." : "No messages available in this view."}
                </div>
              )}
            </div>
          </Scrollbars>
        </section>
      </section>
    );
  }
}

ReplayGamechat.propTypes = {
  userInfo: PropTypes.object,
  gameInfo: PropTypes.object,
  userList: PropTypes.object,
  allEmotes: PropTypes.object,
};

const GamechatContainer = (props) => <ReplayGamechat {...props} />;

export default connect(mapDispatchToProps)(GamechatContainer);
