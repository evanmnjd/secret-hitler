import React from "react";
import PropTypes from "prop-types";
import { replayTimeline } from "../../../replay/timeline";

export default function ReplayTimeline({ ticks, position, onSeek }) {
  const events = replayTimeline(ticks);
  let active = 0;
  events.forEach((event, index) => {
    if (event.position <= position) active = index;
  });
  return (
    <nav className="replay-timeline" aria-label="Replay timeline">
      <ol>
        {events.map((event, index) => (
          <li key={`${event.position}-${event.type}`}>
            {index > 0 && (
              <span className="replay-timeline-connector" aria-hidden="true">
                —
              </span>
            )}
            <button
              type="button"
              className={`replay-timeline-event ${event.type}${index === active ? " current" : ""}`}
              aria-current={index === active ? "step" : undefined}
              title={`${event.label} · Government ${event.turn}`}
              onClick={() => onSeek(event.position)}
            >
              {event.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

ReplayTimeline.propTypes = {
  ticks: PropTypes.object.isRequired,
  position: PropTypes.number.isRequired,
  onSeek: PropTypes.func.isRequired,
};
