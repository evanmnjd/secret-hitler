const { z } = require("zod");
const Account = require("../../../models/account");

const roles = new Set(["moderator", "editor", "admin"]);
const requestSchema = z.object({ username: z.string().trim().min(1).max(100) }).strict();
const requests = new WeakMap();

const handleAccountBanStatus = async (socket, request, callback) => {
  if (typeof callback !== "function") return;
  const parsed = requestSchema.safeParse(request);
  const actor = socket.handshake?.session?.passport?.user;
  if (!parsed.success) return callback({ success: false, error: "Enter an account username." });
  if (typeof actor !== "string" || !actor || socket.disconnected || socket._replacedBySocketId) {
    return callback({ success: false, error: "You do not have access to account ban status." });
  }
  const previous = requests.get(socket);
  if (previous?.pending || (previous && Date.now() - previous.started < 500)) {
    return callback({ success: false, error: "Please wait before checking another account." });
  }
  const state = { pending: true, started: Date.now() };
  requests.set(socket, state);
  try {
    // Check the current persisted role, not cached connection-time flags or a
    // tournament permission. Trial/event moderators cannot use this endpoint.
    const staff = await Account.findOne({ username: actor }).select("staffRole").maxTimeMS(2000).lean();
    if (!roles.has(staff?.staffRole)) {
      return callback({ success: false, error: "You do not have access to account ban status." });
    }
    const username = parsed.data.username;
    // Accounts with no public games may have no Profile. Ban status lives on Account.
    const account = await Account.findOne({ username }).select("isBanned").maxTimeMS(2000).lean();
    if (socket.disconnected || socket._replacedBySocketId || socket.handshake?.session?.passport?.user !== actor) {
      return callback({ success: false, error: "Your connection changed. Please try again." });
    }
    callback({
      success: true,
      username,
      exists: Boolean(account),
      ...(account ? { isBanned: account.isBanned === true } : {}),
    });
  } catch {
    // No raw account or connection data belongs in either the UI or the mod log.
    callback({ success: false, error: "Unable to check account ban status right now. Please try again." });
  } finally {
    state.pending = false;
  }
};

module.exports = { handleAccountBanStatus };
