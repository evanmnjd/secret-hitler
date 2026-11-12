import React from "react";
import { shallow } from "enzyme";
import StaffAccountIPs from "./StaffAccountIPs";
import Moderation from "./Moderation";

const make = (props = {}) => {
  const socket = { emit: jest.fn() };
  const wrapper = shallow(<StaffAccountIPs socket={socket} username="Legacy" staffRole="moderator" {...props} />);
  return { wrapper, socket, lookup: () => wrapper.find("button").simulate("click") };
};
const result = { success: true, exists: true, username: "Legacy", signupIP: "-123.456.789.321", lastConnectedIP: null };

it.each(["moderator", "editor", "admin"])("offers the read-only control to %s", (staffRole) => {
  const { wrapper } = make({ staffRole });
  expect(wrapper.find("button").text()).toBe("See Account IPs");
});

it.each([
  undefined,
  "",
  "trialmod",
  "altmod",
  "veteran",
  "eventmod",
  "tourneymod",
])("hides the control from %s", (staffRole) => {
  const { wrapper, socket } = make({ staffRole });
  expect(wrapper.isEmptyRender()).toBe(true);
  wrapper.instance().lookup();
  expect(socket.emit).not.toHaveBeenCalled();
});

it("queries the typed account and labels independently unavailable fields without changing the parent draft", () => {
  const { wrapper, socket, lookup } = make({ username: " Legacy " });
  lookup();
  expect(socket.emit).toHaveBeenCalledWith("lookupAccountIPs", { username: "Legacy" }, expect.any(Function));
  expect(wrapper.find("button").prop("disabled")).toBe(true);
  wrapper.instance().lookup();
  expect(socket.emit).toHaveBeenCalledTimes(1);
  socket.emit.mock.calls[0][2](result);
  expect(wrapper.text()).toContain("Signup IP");
  expect(wrapper.text()).toContain(result.signupIP);
  expect(wrapper.text()).toContain("Last connected IP");
  expect(wrapper.text()).toContain("Unavailable");
  expect(wrapper.props().className).toBe("staff-account-ip-lookup");
  wrapper.unmount();
});

it("reports no account and lookup errors without suggesting that missing IP fields imply a missing account", () => {
  const { wrapper, socket, lookup } = make();
  lookup();
  socket.emit.mock.calls[0][2]({ success: true, exists: false, username: "Legacy" });
  expect(wrapper.text()).toContain("does not exist");
  lookup();
  socket.emit.mock.calls[1][2]({ success: false, error: "Not authorized" });
  expect(wrapper.find('[role="alert"]').text()).toBe("Not authorized");
  expect(wrapper.text()).not.toContain("does not exist");
  wrapper.unmount();
});

it("clears old data and ignores delayed acknowledgements when the username, socket or role changes", () => {
  const { wrapper, socket, lookup } = make();
  lookup();
  const old = socket.emit.mock.calls[0][2];
  wrapper.setProps({ username: "Other" });
  old(result);
  expect(wrapper.find('[role="status"]')).toHaveLength(0);
  lookup();
  const other = socket.emit.mock.calls[1][2];
  wrapper.setProps({ socket: { emit: jest.fn() }, staffRole: "trialmod" });
  other({ ...result, username: "Other" });
  expect(wrapper.isEmptyRender()).toBe(true);
  expect(wrapper.state("result")).toBe(null);
  wrapper.unmount();
});

it("allows retries after a timeout and ignores callbacks after timeout or unmount", () => {
  jest.useFakeTimers();
  const { wrapper, socket, lookup } = make();
  lookup();
  jest.advanceTimersByTime(10000);
  expect(wrapper.find('[role="alert"]').text()).toContain("timed out");
  socket.emit.mock.calls[0][2](result);
  expect(wrapper.state("result")).toBe(null);
  lookup();
  const setState = jest.spyOn(wrapper.instance(), "setState");
  wrapper.unmount();
  setState.mockClear();
  socket.emit.mock.calls[1][2](result);
  expect(setState).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it("does not accept a response labeled for a different account", () => {
  const { wrapper, socket, lookup } = make();
  lookup();
  socket.emit.mock.calls[0][2]({ ...result, username: "Wrong" });
  expect(wrapper.state("result")).toBe(null);
  expect(wrapper.find('[role="alert"]').text()).toContain("target changed");
  wrapper.unmount();
});

it("takes the target from the actual moderation form for both selected and typed users", () => {
  const wrapper = shallow(
    <Moderation socket={{ on: jest.fn(), emit: jest.fn() }} userInfo={{ staffRole: "moderator" }} />,
    { disableLifecycleMethods: true }
  );
  wrapper.setState({ selectedUser: "Selected" });
  expect(wrapper.find(StaffAccountIPs).prop("username")).toBe("Selected");
  wrapper.setState({ playerInputText: "Typed" });
  expect(wrapper.find(StaffAccountIPs).prop("username")).toBe("Typed");
});
