import React from "react";
import { shallow } from "enzyme";
import { Button, Modal } from "semantic-ui-react";
import Moderation from "./Moderation";
import { needsAccountCheck } from "./mod-account-action-check";

const make = (role = "moderator") => {
  const socket = { emit: jest.fn(), off: jest.fn() };
  const wrapper = shallow(<Moderation socket={socket} userInfo={{ userName: "Moderator", staffRole: role }} />, {
    disableLifecycleMethods: true,
  });
  wrapper.setState({ playerInputText: "Misspelled", actionTextValue: "Keep my explanation" });
  return { wrapper, socket };
};
const payload = (action = "warn") => ({
  modName: "Moderator",
  userName: "Misspelled",
  ip: "",
  comment: "Keep my explanation",
  action,
});
const request = (h, action = "warn") => {
  h.wrapper.instance().submitModAction(payload(action));
  return h.socket.emit.mock.calls.find(([event]) => event === "checkModAccountExists")[2];
};
const button = (wrapper, text) => wrapper.find(Button).filterWhere((b) => b.children().text() === text);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it("lets a typo be canceled without sending an action or losing the draft", () => {
  const h = make();
  request(h)({ success: true, username: "Misspelled", exists: false });
  expect(h.wrapper.find(Modal).first().prop("open")).toBe(true);
  expect(h.wrapper.find(Modal.Content).children().text()).toContain("Misspelled");
  button(h.wrapper, "Cancel").simulate("click");
  expect(h.socket.emit.mock.calls.filter(([event]) => event === "updateModAction")).toEqual([]);
  expect(h.wrapper.state()).toMatchObject({
    playerInputText: "Misspelled",
    actionTextValue: "Keep my explanation",
    accountActionConfirmation: null,
  });
});

it("proceeds with the exact original action, then clears the submitted draft", () => {
  const h = make();
  const action = { type: "setWins20", isNonSeason: true };
  request(h, action)({ success: true, username: "Misspelled", exists: false });
  button(h.wrapper, "Proceed anyway").simulate("click");
  expect(h.socket.emit).toHaveBeenCalledWith("updateModAction", payload(action));
  expect(h.wrapper.state()).toMatchObject({
    playerInputText: "",
    actionTextValue: "",
    accountActionConfirmation: null,
  });
});

it("sends an existing-account action once without a confirmation, even with repeated acknowledgments", () => {
  const h = make();
  const reply = request(h);
  reply({ success: true, username: "Misspelled", exists: true });
  reply({ success: true, username: "Misspelled", exists: true });
  expect(h.socket.emit.mock.calls.filter(([event]) => event === "updateModAction")).toHaveLength(1);
  expect(h.wrapper.state("accountActionConfirmation")).toBe(null);
});

it("checks selected accounts even though their existing payload includes an obfuscated IP", () => {
  const h = make();
  h.wrapper.setState({
    selectedUser: "Alice",
    playerInputText: "",
    userList: [{ userName: "Alice", ip: "-123.456.789.100", email: "+example.invalid", status: { type: "none" } }],
  });
  const buttons = shallow(h.wrapper.instance().renderButtons());
  buttons
    .find("button")
    .filterWhere((b) => b.text() === "Issue Warning")
    .simulate("click");
  expect(h.socket.emit).toHaveBeenCalledWith("checkModAccountExists", { username: "Alice" }, expect.any(Function));
});

it.each([
  "deleteGame",
  "resetGameName",
  "modEndGame",
  "setSticky",
  "resetServer",
  "regatherAEMList",
  "makeBypass",
])("does not preflight the existing %s path", (action) => {
  const h = make();
  h.wrapper.instance().submitModAction(payload(action));
  expect(h.socket.emit).toHaveBeenCalledWith("updateModAction", payload(action));
  expect(h.socket.emit.mock.calls.some(([event]) => event === "checkModAccountExists")).toBe(false);
});

it("keeps IP-only and obfuscated-IP actions untouched, and still checks account-like game prefixes", () => {
  const h = make();
  for (const target of [
    { userName: "-123.456.789.100", ip: "" },
    { userName: "", ip: "-123.456.789.100" },
  ]) {
    const data = { ...payload("timeOut"), ...target };
    h.wrapper.instance().submitModAction(data);
    expect(h.socket.emit).toHaveBeenCalledWith("updateModAction", data);
  }
  expect(needsAccountCheck({ ...payload(), userName: "DELGAMEAlice" })).toBe(true);
  expect(needsAccountCheck({ ...payload(), userName: "RESETGAMENAMEAlice" })).toBe(true);
  expect(needsAccountCheck({ ...payload("comment"), userName: "" })).toBe(false);
});

it("invalidates pending checks when the username or comment changes", () => {
  const h = make();
  const reply = request(h);
  h.wrapper.setState({ playerInputText: "ActualUser", actionTextValue: "New explanation" });
  h.wrapper.instance().componentDidUpdate();
  reply({ success: true, username: "Misspelled", exists: true });
  expect(h.socket.emit.mock.calls.some(([event]) => event === "updateModAction")).toBe(false);
  expect(h.wrapper.state()).toMatchObject({
    playerInputText: "ActualUser",
    actionTextValue: "New explanation",
    accountActionCheckPending: false,
  });
});

it("does not send after a timeout, an error, unmounting or a stale username response", () => {
  for (const end of ["timeout", "error", "unmount", "mismatch"]) {
    const h = make();
    const reply = request(h);
    if (end === "timeout") jest.advanceTimersByTime(10000);
    if (end === "error") reply({ success: false, error: "Database unavailable" });
    if (end === "unmount") h.wrapper.instance().componentWillUnmount();
    if (end === "mismatch") reply({ success: true, username: "SomeoneElse", exists: true });
    reply({ success: true, username: "Misspelled", exists: true });
    expect(h.socket.emit.mock.calls.some(([event]) => event === "updateModAction")).toBe(false);
  }
});

it("prevents duplicate in-flight submits", () => {
  const h = make();
  request(h);
  h.wrapper.instance().submitModAction(payload());
  expect(h.socket.emit.mock.calls.filter(([event]) => event === "checkModAccountExists")).toHaveLength(1);
});

it.each([
  "trialmod",
  "altmod",
  "eventmod",
  "",
  "veteran",
])("does not expose the new confirmation flow to %s", (role) => {
  const h = make(role);
  h.wrapper.instance().submitModAction(payload());
  expect(h.socket.emit).not.toHaveBeenCalled();
  expect(h.wrapper.find(Modal.Header)).toHaveLength(0);
});
