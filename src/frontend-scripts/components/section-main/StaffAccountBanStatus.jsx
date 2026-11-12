import React from "react";
import PropTypes from "prop-types";

const roles = new Set(["moderator", "editor", "admin"]);

export default class StaffAccountBanStatus extends React.Component {
  state = { loading: false, result: null, error: "" };

  componentDidUpdate(previous) {
    if (previous.username !== this.props.username || previous.staffRole !== this.props.staffRole) {
      this.cancel();
      this.setState({ loading: false, result: null, error: "" });
    }
  }

  componentWillUnmount() {
    this.cancel();
  }

  cancel = () => {
    this.requestId = (this.requestId || 0) + 1;
    clearTimeout(this.timer);
    this.pending = false;
  };

  check = () => {
    const username = (this.props.username || "").trim();
    if (!username || !roles.has(this.props.staffRole) || this.pending) return;
    this.pending = true;
    const id = (this.requestId || 0) + 1;
    this.requestId = id;
    this.setState({ loading: true, result: null, error: "" });
    const finish = (reply) => {
      if (this.requestId !== id) return;
      this.cancel();
      if (
        !reply?.success ||
        reply.username !== username ||
        typeof reply.exists !== "boolean" ||
        (reply.exists && typeof reply.isBanned !== "boolean")
      ) {
        this.setState({ loading: false, result: null, error: reply?.error || "Unable to check account ban status." });
        return;
      }
      this.setState({ loading: false, result: reply, error: "" });
    };
    this.timer = setTimeout(() => finish({ error: "The ban status check timed out. Please try again." }), 10000);
    this.props.socket.emit("getAccountBanStatus", { username }, finish);
  };

  render() {
    if (!roles.has(this.props.staffRole)) return null;
    const { loading, result, error } = this.state;
    return (
      <div className="staff-account-ban-status">
        <button
          type="button"
          className="ui button"
          disabled={loading || !(this.props.username || "").trim()}
          onClick={this.check}
          style={{ width: "100%" }}
        >
          {loading ? "Checking ban status…" : "Check Ban Status"}
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <p role="status">
            {!result.exists
              ? `Account not found: ${result.username}`
              : `${result.username} is ${result.isBanned ? "banned" : "not banned"}.`}
          </p>
        )}
      </div>
    );
  }
}

StaffAccountBanStatus.propTypes = {
  socket: PropTypes.object.isRequired,
  username: PropTypes.string,
  staffRole: PropTypes.string,
};
