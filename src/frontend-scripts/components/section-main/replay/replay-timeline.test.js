import React from "react";
import { shallow } from "enzyme";
import { List } from "immutable";
import ReplayTimeline from "./ReplayTimeline";
import { replayTimeline } from "../../../replay/timeline";

const ticks = List([
  { turnNum: 0, phase: "candidacy" },
  { turnNum: 0, phase: "election" }, // Failed election still gets a government.
  { turnNum: 1, phase: "candidacy" },
  { turnNum: 1, phase: "policyEnaction" },
  { turnNum: 1, phase: "investigation" },
  { turnNum: 2, phase: "candidacy" },
  { turnNum: 2, phase: "policyPeek" },
  { turnNum: 3, phase: "candidacy" },
  { turnNum: 3, phase: "specialElection" },
  { turnNum: 4, phase: "candidacy" },
  { turnNum: 4, phase: "execution" },
  { turnNum: 4, phase: "assassination" },
  { turnNum: 4, phase: "assassination", gameOver: true },
]);

it("orders every government and each power chronologically, with a distinct final result", () => {
  expect(replayTimeline(ticks).map(({ position, label }) => [position, label])).toEqual([
    [0, "Gov 1"],
    [2, "Gov 2"],
    [4, "Investigation"],
    [5, "Gov 3"],
    [6, "Policy peek"],
    [7, "Gov 4"],
    [8, "Special election"],
    [9, "Gov 5"],
    [10, "Execution"],
    [11, "Assassination"],
    [12, "Result"],
  ]);
});

it("seeks exactly to clicked events and highlights the current event between milestones", () => {
  const seek = jest.fn();
  const wrapper = shallow(<ReplayTimeline ticks={ticks} position={3} onSeek={seek} />);
  expect(wrapper.find("nav").prop("aria-label")).toBe("Replay timeline");
  expect(wrapper.find("[aria-current='step']").text()).toBe("Gov 2");
  const investigation = wrapper.find("button").at(2);
  expect(investigation.prop("type")).toBe("button"); // Native keyboard activation is retained.
  investigation.simulate("click");
  expect(seek).toHaveBeenCalledWith(4);
  wrapper.setProps({ position: 4 });
  expect(wrapper.find("[aria-current='step']").text()).toBe("Investigation");
  wrapper.setProps({ position: 12 });
  expect(wrapper.find("[aria-current='step']").text()).toBe("Result");
});
