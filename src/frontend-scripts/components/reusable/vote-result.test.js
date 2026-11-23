import React from "react";
import { shallow } from "enzyme";
import { renderToStaticMarkup } from "react-dom/server";
import VoteResult from "./VoteResult";

const distributions = Array.from({ length: 10 }, (_, index) => index + 1).flatMap((total) =>
  Array.from({ length: total + 1 }, (_, ja) => [total, ja, total - ja])
);

describe("anonymous vote result cards", () => {
  it.each(distributions)("renders %i living votes as %i Ja then %i Nein cards", (total, ja, nein) => {
    const segment = { type: "vote-result", text: `Vote result: ${ja} Ja · ${nein} Nein`, ja, nein };
    const component = shallow(<VoteResult segment={segment} />);
    const sources = component.find("img").map((image) => image.prop("src"));
    expect(sources).toEqual([
      ...Array(ja).fill("/images/emotes/voteja.png"),
      ...Array(nein).fill("/images/emotes/votenein.png"),
    ]);
    expect(sources).toHaveLength(total);
    expect(component.text()).toContain(`${ja} Ja`);
    expect(component.text()).toContain(`${nein} Nein`);
    expect(renderToStaticMarkup(<VoteResult segment={segment} />)).toMatch(
      /anonymous|individual votes hidden|grouped/i
    );
  });

  it.each([
    {},
    { ja: 1 },
    { nein: 1 },
    { ja: 0, nein: 0 },
    { ja: -1, nein: 3 },
    { ja: 3, nein: -1 },
    { ja: 1.5, nein: 3 },
    { ja: 3, nein: 1.5 },
    { ja: 11, nein: 0 },
    { ja: 6, nein: 5 },
    { ja: "4", nein: 3 },
    { ja: 4, nein: null },
    { ja: NaN, nein: 3 },
    { ja: Infinity, nein: 0 },
  ])("keeps the saved text when structured counts are invalid (%j)", (counts) => {
    const segment = { type: "vote-result", text: "Vote result: 4 Ja · 3 Nein", ...counts };
    const component = shallow(<VoteResult segment={segment} />);
    expect(component.find("img")).toHaveLength(0);
    expect(component.text()).toBe(segment.text);
  });

  it("treats fallback text as text instead of HTML", () => {
    const output = renderToStaticMarkup(<VoteResult segment={{ type: "vote-result", text: "<b>Saved text</b>" }} />);
    expect(output).toContain("&lt;b&gt;Saved text&lt;/b&gt;");
    expect(output).not.toContain("<b>");
  });

  it("uses aggregate counts without rendering identity or seat metadata", () => {
    const segment = {
      type: "vote-result",
      text: "Vote result: 2 Ja · 1 Nein",
      ja: 2,
      nein: 1,
      votes: [false, true, true],
      userName: "PrivatePlayerName",
    };
    const output = renderToStaticMarkup(<VoteResult segment={segment} />);
    expect(output).not.toContain("PrivatePlayerName");
    expect(output).not.toMatch(/Seat [0-9]/i);
    const component = shallow(<VoteResult segment={segment} />);
    expect(component.find("img").map((image) => image.prop("src"))).toEqual([
      "/images/emotes/voteja.png",
      "/images/emotes/voteja.png",
      "/images/emotes/votenein.png",
    ]);
  });
});
