import React from "react";
import { shallow } from "enzyme";
import { shallowWithStore } from "enzyme-redux";
import { createMockStore } from "redux-test-utils";
import Gamechat from "./Gamechat";
import ReplayGamechat from "./replay/ReplayGamechat";
import VoteResult from "../reusable/VoteResult";

describe.each([
  ["live", Gamechat],
  ["replay", ReplayGamechat],
])("vote results in %s chat", (view, ChatComponent) => {
  const renderChat = (playerChats, flags = {}) => {
    const segment = { type: "vote-result", text: "Vote result: 4 Ja · 3 Nein", ja: 4, nein: 3 };
    const legacy = "Vote result: 2 Ja · 5 Nein";
    const gameInfo = {
      general: { noVoteReveal: true, playerChats, ...flags },
      gameState: { isStarted: true, isTracksFlipped: true },
      publicPlayersState: Array.from({ length: 7 }, (_, index) => ({ userName: `Player${index + 1}` })),
      chats: [
        { gameChat: true, timestamp: new Date(0), chat: [segment] },
        { gameChat: true, timestamp: new Date(1), chat: [{ text: legacy }] },
      ],
    };
    const component = shallowWithStore(
      <ChatComponent
        userInfo={{ userName: "Player1", isSeated: true, gameSettings: {} }}
        userList={{ list: [] }}
        allEmotes={{}}
        socket={{ on: jest.fn(), emit: jest.fn() }}
        gameInfo={gameInfo}
      />,
      createMockStore({ notesActive: false })
    ).dive({ disableLifecycleMethods: true });
    return {
      component: view === "replay" ? component.dive({ disableLifecycleMethods: true }) : component,
      gameInfo,
      segment,
      legacy,
    };
  };

  it.each([
    "enabled",
    "disabled",
    "emotes",
  ])("renders grouped result cards with %s player chat and no emote lookup", (mode) => {
    const { component, gameInfo, segment, legacy } = renderChat(mode);
    const before = JSON.stringify(gameInfo);
    const rows = shallow(<div>{component.instance().processChats()}</div>);
    const result = rows.find(VoteResult);
    expect(result).toHaveLength(1);
    expect(result.prop("segment")).toEqual(segment);
    expect(result.dive().find("img")).toHaveLength(7);
    const legacyRow = rows.find(".item.game-chat").filterWhere((row) => !row.find(VoteResult).length);
    expect(legacyRow.text()).toBe(legacy);
    expect(JSON.stringify(gameInfo)).toBe(before);
  });

  it("keeps results available in combined blind, timed, casual, and Neighbor Chat modes", () => {
    const { component } = renderChat("disabled", {
      blindMode: true,
      timedMode: 15,
      casualGame: true,
      neighborChat: true,
    });
    const rows = shallow(<div>{component.instance().processChats()}</div>);
    expect(rows.find(VoteResult).dive().find("img")).toHaveLength(7);
  });
});
