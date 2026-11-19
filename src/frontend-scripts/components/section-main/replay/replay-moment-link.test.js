import React from "react";
import { shallow } from "enzyme";
import ReplayMomentLink from "./ReplayMomentLink";

const snapshot = { turnNum: 2, phase: "investigation", gameOver: false };
let originalClipboard;
beforeEach(() => {
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
});
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete navigator.clipboard;
});
const clipboard = (writeText) =>
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

it("copies an exact server-readable moment URL and confirms after the clipboard resolves", async () => {
  const write = jest.fn().mockResolvedValue();
  clipboard(write);
  const wrapper = shallow(<ReplayMomentLink uid="table-123" snapshot={snapshot} />);
  await wrapper.instance().copy();
  expect(write).toHaveBeenCalledWith(`${window.location.origin}/replay/table-123?turn=3&phase=investigation`);
  expect(wrapper.find("[role='status']").text()).toBe("Link copied.");
  expect(wrapper.find("input")).toHaveLength(0);
});

it.each(["unavailable", "rejected"])("offers a selectable URL when clipboard access is %s", async (failure) => {
  clipboard(failure === "rejected" ? jest.fn().mockRejectedValue(new Error("Denied")) : undefined);
  const wrapper = shallow(<ReplayMomentLink uid="table" snapshot={{ ...snapshot, gameOver: true }} />);
  await wrapper.instance().copy();
  expect(wrapper.find("[role='status']").text()).toBe("Select and copy the link below.");
  const input = wrapper.find("input");
  expect(input.prop("readOnly")).toBe(true);
  expect(input.prop("value")).toBe(`${window.location.origin}/replay/table?turn=3&phase=investigation&end=1`);
  const select = jest.fn();
  input.simulate("focus", { currentTarget: { select } });
  expect(select).toHaveBeenCalledTimes(1);
});

it("clears old copy feedback and ignores a delayed result after moving to another moment", async () => {
  let finish;
  clipboard(
    jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
  );
  const wrapper = shallow(<ReplayMomentLink uid="table" snapshot={snapshot} />);
  const pending = wrapper.instance().copy();
  wrapper.setProps({ snapshot: { ...snapshot, turnNum: 3 } });
  finish();
  await pending;
  expect(wrapper.find("[role='status']")).toHaveLength(0);
  expect(wrapper.find("input")).toHaveLength(0);
});

it("does not fabricate a share link for invalid data", async () => {
  clipboard(jest.fn());
  const wrapper = shallow(<ReplayMomentLink uid="../bad" snapshot={snapshot} />);
  await wrapper.instance().copy();
  expect(wrapper.find("[role='status']").text()).toBe("Unable to share this moment.");
  expect(wrapper.find("input")).toHaveLength(0);
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
});
