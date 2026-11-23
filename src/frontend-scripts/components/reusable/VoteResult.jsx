import React from "react";
import PropTypes from "prop-types";

export default function VoteResult({ segment }) {
  const { ja, nein } = segment || {};
  if (!Number.isInteger(ja) || !Number.isInteger(nein) || ja < 0 || nein < 0 || ja + nein < 1 || ja + nein > 10) {
    return <span>{typeof segment?.text === "string" ? segment.text : "Vote result unavailable."}</span>;
  }
  const cards = [...Array(ja).fill("ja"), ...Array(nein).fill("nein")];
  return (
    <span
      className="vote-result"
      role="img"
      aria-label={`Vote result: ${ja} Ja, ${nein} Nein. Cards are grouped by vote; individual votes are hidden.`}
    >
      <span className="vote-result-label">Votes:</span>
      <span className="vote-result-cards" aria-hidden="true">
        {cards.map((vote, index) => (
          <img key={index} src={`/images/emotes/vote${vote}.png`} alt="" title={vote === "ja" ? "Ja" : "Nein"} />
        ))}
      </span>
      <span className="vote-result-counts">{`${ja} Ja · ${nein} Nein`}</span>
    </span>
  );
}

VoteResult.propTypes = {
  segment: PropTypes.object.isRequired,
};
