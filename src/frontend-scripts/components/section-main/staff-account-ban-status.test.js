import React from "react";
import { shallow } from "enzyme";
import StaffAccountBanStatus from "./StaffAccountBanStatus";

const make = (props = {}) => {
  const socket = { emit: jest.fn() };
  return {
    socket,
    wrapper: shallow(<StaffAccountBanStatus socket={socket} username="Alice" staffRole="moderator" {...props} />),
  };
};
const reply = (socket, data) => socket.emit.mock.calls[0][2](data);

afterEach(() => jest.useRealTimers());

it.each(["moderator", "editor", "admin"])("shows the lookup for %s", (staffRole) => {
  const { wrapper } = make({ staffRole });
  expect(wrapper.find("button").text()).toBe("Check Ban Status");
  wrapper.unmount();
});

it.each([
  "trialmod",
  "eventmod",
  "tourneymod",
  "altmod",
  "veteran",
  "",
  undefined,
])("hides the lookup from %s", (staffRole) => {
  const { wrapper, socket } = make({ staffRole });
  expect(wrapper.isEmptyRender()).toBe(true);
  wrapper.instance().check();
  expect(socket.emit).not.toHaveBeenCalled();
});

it("requires a username but no action comment and prevents duplicate clicks", () => {
  const { wrapper, socket } = make({ username: " Alice " });
  wrapper.find("button").simulate("click");
  wrapper.instance().check();
  expect(socket.emit).toHaveBeenCalledTimes(1);
  expect(socket.emit).toHaveBeenCalledWith("getAccountBanStatus", { username: "Alice" }, expect.any(Function));
  expect(wrapper.find("button").prop("disabled")).toBe(true);
  reply(socket, { success: true, username: "Alice", exists: true, isBanned: true });
  expect(wrapper.find("[role='status']").text()).toBe("Alice is banned.");
  wrapper.unmount();
});

it.each([
  [{ success: true, username: "Alice", exists: true, isBanned: false }, "Alice is not banned."],
  [{ success: true, username: "Alice", exists: false }, "Account not found: Alice"],
])("renders the returned account state %j", (response, text) => {
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  reply(socket, response);
  expect(wrapper.find("[role='status']").text()).toBe(text);
  expect(wrapper.find("[role='alert']")).toHaveLength(0);
  wrapper.unmount();
});

it("does not infer not-found from a failed or malformed lookup", () => {
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  reply(socket, { success: false, error: "Unable to check right now." });
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  expect(wrapper.find("[role='alert']").text()).toBe("Unable to check right now.");
  wrapper.find("button").simulate("click");
  socket.emit.mock.calls[1][2]({ success: true, username: "Alice" });
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  wrapper.unmount();
});

it("ignores stale replies and clears old results when the target changes", () => {
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  wrapper.setProps({ username: "Bob" });
  reply(socket, { success: true, username: "Alice", exists: true, isBanned: true });
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  expect(wrapper.state("loading")).toBe(false);
  wrapper.find("button").simulate("click");
  socket.emit.mock.calls[1][2]({ success: true, username: "Bob", exists: true, isBanned: false });
  expect(wrapper.find("[role='status']").text()).toBe("Bob is not banned.");
  wrapper.setProps({ username: "Carol" });
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  wrapper.unmount();
});

it("ignores in-flight results after permission loss", () => {
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  wrapper.setProps({ staffRole: "trialmod" });
  reply(socket, { success: true, username: "Alice", exists: true, isBanned: true });
  expect(wrapper.isEmptyRender()).toBe(true);
  expect(wrapper.state("result")).toBe(null);
  wrapper.unmount();
});

it("times out and ignores late acknowledgements", () => {
  jest.useFakeTimers();
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  jest.advanceTimersByTime(10000);
  expect(wrapper.find("[role='alert']").text()).toContain("timed out");
  reply(socket, { success: true, username: "Alice", exists: true, isBanned: true });
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  wrapper.unmount();
});

it("cancels the timeout and ignores acknowledgements after unmount", () => {
  jest.useFakeTimers();
  const { wrapper, socket } = make();
  wrapper.find("button").simulate("click");
  const instance = wrapper.instance();
  const setState = jest.spyOn(instance, "setState");
  wrapper.unmount();
  reply(socket, { success: true, username: "Alice", exists: true, isBanned: true });
  jest.advanceTimersByTime(10000);
  expect(setState).not.toHaveBeenCalled();
});
