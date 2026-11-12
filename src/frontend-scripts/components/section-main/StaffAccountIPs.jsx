import React from "react";
import PropTypes from "prop-types";

const allowedRoles = new Set(["moderator", "editor", "admin"]);

export default class StaffAccountIPs extends React.Component {
  state = { loading: false, result: null, error: "" };
  requestId = 0;
  pending = false;
  unmounted = false;

  componentDidUpdate(previous) {
    if (
      previous.username !== this.props.username ||
      previous.socket !== this.props.socket ||
      previous.staffRole !== this.props.staffRole
    ) {
      this.cancelRequest();
      this.setState({ loading: false, result: null, error: "" });
    }
  }

  componentWillUnmount() {
    this.unmounted = true;
    this.cancelRequest();
  }

  cancelRequest = () => {
    clearTimeout(this.timer);
    this.requestId++;
    this.pending = false;
  };

  lookup = () => {
    const { socket, staffRole } = this.props;
    const username = typeof this.props.username === "string" ? this.props.username.trim() : "";
    if (!allowedRoles.has(staffRole) || !username || this.pending || this.unmounted) return;
    this.pending = true;
    const id = ++this.requestId;
    this.setState({ loading: true, result: null, error: "" });
    const finish = (result) => {
      if (this.unmounted || id !== this.requestId) return;
      clearTimeout(this.timer);
      this.pending = false;
      this.requestId++;
      if (!result?.success) {
        this.setState({ loading: false, result: null, error: result?.error || "Unable to look up account IPs." });
      } else if (result.username !== username) {
        this.setState({ loading: false, result: null, error: "The lookup target changed. Please try again." });
      } else this.setState({ loading: false, result, error: "" });
    };
    this.timer = setTimeout(() => finish({ error: "The IP lookup timed out. Please try again." }), 10000);
    socket.emit("lookupAccountIPs", { username }, finish);
  };

  render() {
    if (!allowedRoles.has(this.props.staffRole)) return null;
    const { loading, result, error } = this.state;
    const username = typeof this.props.username === "string" ? this.props.username.trim() : "";
    return (
      <div className="staff-account-ip-lookup">
        <button
          type="button"
          className="ui button ipban-button"
          style={{ background: "#FFA07A", color: "black" }}
          disabled={!username || loading}
          onClick={this.lookup}
        >
          {loading ? "Looking up account IPs…" : "See Account IPs"}
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <div role="status" style={{ padding: "8px 0", overflowWrap: "anywhere" }}>
            {result.exists ? (
              <>
                <strong>Account IPs for {result.username}</strong>
                <dl style={{ margin: "8px 0" }}>
                  <dt>Signup IP</dt>
                  <dd style={{ marginLeft: "12px", userSelect: "text" }}>{result.signupIP || "Unavailable"}</dd>
                  <dt>Last connected IP</dt>
                  <dd style={{ marginLeft: "12px", userSelect: "text" }}>{result.lastConnectedIP || "Unavailable"}</dd>
                </dl>
              </>
            ) : (
              <>Account “{result.username}” does not exist.</>
            )}
          </div>
        )}
      </div>
    );
  }
}

StaffAccountIPs.propTypes = {
  socket: PropTypes.object.isRequired,
  username: PropTypes.string,
  staffRole: PropTypes.string,
};
