import React from "react";
import { shallow } from "enzyme";
import { ReplayGamechat } from "./ReplayGamechat";
import { replayWhisperPair, UNKNOWN_WHISPER_PAIR } from "../../../replay/chat-filters";

const publicChat = (userName, chat, timestamp = 0, extra = {}) => ({ userName, chat, timestamp, ...extra });
const whisper = (sender, recipient, text, timestamp = 0) => ({
  timestamp,
  gameChat: true,
  neighborChat: { id: `${sender}-${recipient}-${timestamp}`, sender, recipient },
  chat: [{ text: `Neighbor Chat - ${sender} to ${recipient}: ` }, { type: "neighbor-chat", text }],
});
const legacy = {
  timestamp: 4,
  gameChat: true,
  chat: [{ text: "Neighbor Chat - Alice to Bob: " }, { type: "neighbor-chat", text: "Legacy secret" }],
};
const archive = () => [
  publicChat("Alice", "Public apple", 0),
  whisper("Alice", "Bob", "Private APPLE", 1),
  whisper("Bob", "Alice", "Private reply", 2),
  whisper("Carol", "Dave", "Other conversation", 3),
  legacy,
  publicChat("Observer", "Spectator apple", 5),
  publicChat("Moderator", "Staff apple", 6, { staffRole: "moderator" }),
  { gameChat: true, timestamp: 7, chat: [{ text: "Government apple" }] },
];
const render = (chats = archive()) =>
  shallow(
    <ReplayGamechat
      userInfo={{ userName: "Viewer", gameSettings: {} }}
      userList={{ list: [] }}
      allEmotes={{}}
      gameInfo={{
        general: { uid: "table", neighborChat: true },
        chats,
        publicPlayersState: [{ userName: "Alice" }, { userName: "Bob" }],
      }}
    />,
    { disableLifecycleMethods: true }
  );
const change = (wrapper, selector, value) => wrapper.find(selector).simulate("change", { target: { value } });
const rows = (wrapper) => wrapper.instance().filteredChats().rows;

describe("replay chat search and filters", () => {
  it("searches public, structured game, and staff messages case-insensitively while preserving public subfilters", () => {
    const wrapper = render();
    change(wrapper, "#replay-chat-search", "  ApPlE ");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([0, 5, 6, 7]);
    wrapper.setState({ showPlayerChat: false, showObserverChat: false, showGameChat: false });
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([6]);
    wrapper.setState({ showPublicChat: false });
    expect(rows(wrapper)).toHaveLength(0);
    wrapper.setState({ showWhispers: true });
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([1]);
  });

  it("finds old matches across the full archive before applying the 250-message display limit", () => {
    const chats = Array.from({ length: 320 }, (_, timestamp) =>
      publicChat("Alice", timestamp === 1 ? "Early needle" : "Later haystack", timestamp)
    );
    const original = chats.slice();
    const wrapper = render(chats);
    expect(rows(wrapper)).toHaveLength(250);
    expect(wrapper.find(".replay-chat-match-count").text()).toContain("latest 250 of 320");
    change(wrapper, "#replay-chat-search", "needle");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([1]);
    expect(wrapper.find(".replay-chat-match-count").text()).toBe("1 matching message.");
    change(wrapper, "#replay-chat-search", "");
    wrapper.setState({ showFullChat: true });
    expect(rows(wrapper)).toHaveLength(320);
    expect(chats).toEqual(original);
  });

  it("filters by public author or either whisper participant, including players without public messages", () => {
    const wrapper = render();
    expect(wrapper.find("#replay-chat-player option").map((option) => option.prop("value"))).toEqual([
      "",
      "Alice",
      "Bob",
      "Carol",
      "Dave",
      "Moderator",
      "Observer",
    ]);
    change(wrapper, "#replay-chat-player", "Alice");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([0]);
    wrapper.setState({ showWhispers: true });
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([0, 1, 2]);
    change(wrapper, "#replay-chat-player", "Dave");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([3]);
    change(wrapper, "#replay-chat-player", "Observer");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([5]);
  });

  it("groups both directions of a pair, composes filters, and leaves public chat independently selectable", () => {
    const wrapper = render();
    expect(wrapper.find("#replay-chat-pair")).toHaveLength(0);
    wrapper.setState({ showWhispers: true });
    const pair = replayWhisperPair(archive()[1]);
    change(wrapper, "#replay-chat-pair", pair);
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([0, 1, 2, 5, 6, 7]);
    wrapper.setState({ showPublicChat: false });
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([1, 2]);
    change(wrapper, "#replay-chat-search", "apple");
    change(wrapper, "#replay-chat-player", "Bob");
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([1]);
    change(wrapper, "#replay-chat-player", "Carol");
    expect(wrapper.find(".replay-chat-empty").text()).toBe("No messages match these filters.");
    expect(wrapper.find(".replay-chat-match-count").text()).toBe("0 matching messages.");
    wrapper.find(".replay-chat-clear-filters").simulate("click");
    expect(wrapper.state()).toEqual(
      expect.objectContaining({
        searchText: "",
        selectedPlayer: "",
        selectedPair: "",
        showWhispers: true,
        showPublicChat: false,
      })
    );
    expect(rows(wrapper).map((chat) => chat.timestamp)).toEqual([1, 2, 3, 4]);
  });

  it("keeps legacy conversations searchable and labels unknown participants without inferring names from text", () => {
    const wrapper = render();
    wrapper.setState({ showWhispers: true, showPublicChat: false });
    const option = wrapper
      .find("#replay-chat-pair option")
      .filterWhere((row) => row.prop("value") === UNKNOWN_WHISPER_PAIR);
    expect(option.text()).toBe("Unknown participants (legacy)");
    change(wrapper, "#replay-chat-pair", UNKNOWN_WHISPER_PAIR);
    change(wrapper, "#replay-chat-search", "legacy secret");
    expect(rows(wrapper)).toEqual([legacy]);
    change(wrapper, "#replay-chat-player", "Alice");
    expect(rows(wrapper)).toHaveLength(0);
  });

  it("treats search text as literal content and never inserts markup", () => {
    const wrapper = render([publicChat("Alice", "<script>alert('apple')</script>")]);
    change(wrapper, "#replay-chat-search", "<script>");
    expect(rows(wrapper)).toHaveLength(1);
    expect(wrapper.find("script")).toHaveLength(0);
    expect(wrapper.find(".ui.list").html()).toContain("&lt;script&gt;");
    change(wrapper, "#replay-chat-search", ".*");
    expect(rows(wrapper)).toHaveLength(0);
  });

  it("searches archived claims and remaining policies without changing their rendering", () => {
    const wrapper = render([
      publicChat("Alice", [{ text: "Claim: " }, { claim: "brr" }], 0, { isClaim: true }),
      publicChat("Alice", [{ text: "Remaining: " }, { policies: ["b", "b"] }], 1, { isRemainingPolicies: true }),
    ]);
    change(wrapper, "#replay-chat-search", "brr");
    expect(rows(wrapper)).toHaveLength(1);
    expect(wrapper.find(".claim-item")).toHaveLength(1);
    change(wrapper, "#replay-chat-search", "bb");
    expect(rows(wrapper)).toHaveLength(1);
    expect(wrapper.find(".game-chat")).not.toHaveLength(0);
  });
});

describe("replay chat scroll position", () => {
  it("does not force a jump for search, filters, or board-only updates", () => {
    const wrapper = render();
    const instance = wrapper.instance();
    instance.scrollbar = { scrollToBottom: jest.fn() };
    const previous = instance.props;
    change(wrapper, "#replay-chat-search", "apple");
    instance.componentDidUpdate(previous);
    wrapper.setProps({ gameInfo: { ...previous.gameInfo, position: 4 } });
    instance.componentDidUpdate(previous);
    expect(instance.scrollbar.scrollToBottom).not.toHaveBeenCalled();
  });

  it("only follows a replacement transcript when the user is still near the bottom", () => {
    const wrapper = render();
    const instance = wrapper.instance();
    instance.scrollbar = { scrollToBottom: jest.fn() };
    const previous = instance.props;
    wrapper.setProps({ gameInfo: { ...previous.gameInfo, chats: [...archive(), publicChat("Alice", "New line", 8)] } });
    instance.componentDidUpdate(previous);
    expect(instance.scrollbar.scrollToBottom).toHaveBeenCalledTimes(1);
    wrapper.setState({ lock: true });
    instance.componentDidUpdate(previous);
    expect(instance.scrollbar.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("locks when reading older messages and releases the lock near the bottom", () => {
    const wrapper = render();
    const instance = wrapper.instance();
    const position = { scrollHeight: 1000, scrollTop: 200, clientHeight: 200 };
    instance.scrollbar = { getValues: () => position, scrollToBottom: jest.fn() };
    instance.handleChatScrolled();
    expect(wrapper.state("lock")).toBe(true);
    position.scrollTop = 800;
    instance.handleChatScrolled();
    expect(wrapper.state("lock")).toBe(false);
    expect(instance.scrollbar.scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
