import React from "react";
import { shallow } from "enzyme";
import StaffAccountIPs from "./StaffAccountIPs";
import Moderation from "./Moderation";
import StaffLookupDialog from "../reusable/StaffLookupDialog";

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
  expect(wrapper.find(StaffLookupDialog)).toHaveLength(0);
  lookup();
  expect(socket.emit).toHaveBeenCalledWith("lookupAccountIPs", { username: "Legacy" }, expect.any(Function));
  expect(wrapper.find("button").prop("disabled")).toBe(true);
  wrapper.instance().lookup();
  expect(socket.emit).toHaveBeenCalledTimes(1);
  socket.emit.mock.calls[0][2](result);
  expect(wrapper.find(StaffLookupDialog).prop("title")).toBe("Account IPs");
  expect(wrapper.find('[role="status"]').text()).toContain("Signup IP");
  expect(wrapper.find('[role="status"]').text()).toContain(result.signupIP);
  expect(wrapper.find('[role="status"]').text()).toContain("Last connected IP");
  expect(wrapper.find('[role="status"]').text()).toContain("Unavailable");
  expect(wrapper.props().className).toBe("staff-account-ip-lookup");
  wrapper.unmount();
});

it("reports no account and lookup errors without suggesting that missing IP fields imply a missing account", () => {
  const { wrapper, socket, lookup } = make();
  lookup();
  socket.emit.mock.calls[0][2]({ success: true, exists: false, username: "Legacy" });
  expect(wrapper.find(StaffLookupDialog)).toHaveLength(1);
  expect(wrapper.find('[role="status"]').text()).toContain("does not exist");
  lookup();
  socket.emit.mock.calls[1][2]({ success: false, error: "Not authorized" });
  expect(wrapper.find('[role="alert"]').text()).toBe("Not authorized");
  expect(wrapper.find(StaffLookupDialog)).toHaveLength(0);
  wrapper.unmount();
});

it.each([result, { success: true, exists: false, username: "Legacy" }])(
  "dismisses the result popup without changing the typed target or repeating the lookup: %j",
  (response) => {
    const { wrapper, socket, lookup } = make();
    lookup();
    const receive = socket.emit.mock.calls[0][2];
    receive(response);
    wrapper.find(StaffLookupDialog).prop("onDismiss")();
    expect(wrapper.find(StaffLookupDialog)).toHaveLength(0);
    expect(wrapper.find('[role="status"]')).toHaveLength(0);
    expect(wrapper.instance().props.username).toBe("Legacy");
    expect(socket.emit).toHaveBeenCalledTimes(1);
    receive(response);
    expect(wrapper.find(StaffLookupDialog)).toHaveLength(0);
    wrapper.unmount();
  }
);

it.each([
  { username: "Other" },
  { staffRole: "trialmod" },
  { socket: { emit: jest.fn() } },
])("closes a displayed result after its target, role or connection changes: %j", (props) => {
  const { wrapper, socket, lookup } = make();
  lookup();
  socket.emit.mock.calls[0][2](result);
  expect(wrapper.find(StaffLookupDialog)).toHaveLength(1);
  wrapper.setProps(props);
  expect(wrapper.find(StaffLookupDialog)).toHaveLength(0);
  expect(wrapper.state("result")).toBe(null);
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
