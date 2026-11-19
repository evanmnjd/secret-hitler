import React from "react";
import PropTypes from "prop-types";
import { replayMomentPath } from "../../../../shared/replay-moment";

export default class ReplayMomentLink extends React.Component {
  state = { status: "", fallback: "" };
  request = 0;

  componentDidUpdate(previous) {
    if (previous.uid !== this.props.uid || previous.snapshot !== this.props.snapshot) {
      this.request++;
      if (this.state.status || this.state.fallback) this.setState({ status: "", fallback: "" });
    }
  }

  componentWillUnmount() {
    this.request++;
  }

  copy = async () => {
    const id = ++this.request;
    let url;
    try {
      url = `${window.location.origin}${replayMomentPath(this.props.uid, this.props.snapshot)}`;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (id === this.request) this.setState({ status: "Link copied.", fallback: "" });
    } catch {
      if (id === this.request) {
        this.setState({
          status: url ? "Select and copy the link below." : "Unable to share this moment.",
          fallback: url || "",
        });
      }
    }
  };

  render() {
    return (
      <React.Fragment>
        <button type="button" className="copy-replay-moment ui inverted teal button" onClick={this.copy}>
          Copy link to this moment
        </button>
        {this.state.status && (
          <span className="replay-share-status" role="status">
            {this.state.status}
          </span>
        )}
        {this.state.fallback && (
          <input
            className="replay-share-fallback"
            aria-label="Link to this replay moment"
            readOnly
            value={this.state.fallback}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </React.Fragment>
    );
  }
}

ReplayMomentLink.propTypes = {
  uid: PropTypes.string.isRequired,
  snapshot: PropTypes.object.isRequired,
};
