const { z } = require("zod");
const Account = require("../../../models/account");

const requestSchema = z.object({ username: z.string().trim().min(1).max(100) }).strict();
const allowedRoles = new Set(["moderator", "editor", "admin"]);
const requests = new WeakMap();

// This is a read-only typo check. It does not authorize or change the subsequent
// moderation action, which still goes through its existing handler and guards.
const handleModAccountExistence = async (socket, request, callback) => {
  if (typeof callback !== "function") return;
  const parsed = requestSchema.safeParse(request);
  const actor = socket.handshake?.session?.passport?.user;
  if (!parsed.success || typeof actor !== "string" || socket.disconnected || socket._replacedBySocketId) {
    callback({ success: false, error: "Invalid account check." });
    return;
  }
  const previous = requests.get(socket);
  if (previous?.pending || (previous && Date.now() - previous.started < 500)) {
    callback({ success: false, error: "Please wait before checking another account." });
    return;
  }
  const state = { pending: true, started: Date.now() };
  requests.set(socket, state);
  try {
    const account = await Account.findOne({ username: actor }).select("staffRole").maxTimeMS(2000).lean();
    if (!allowedRoles.has(account?.staffRole)) {
      callback({ success: false, error: "Only moderators, editors and admins can check accounts." });
      return;
    }
    if (socket.disconnected || socket._replacedBySocketId || socket.handshake?.session?.passport?.user !== actor)
      return;
    const target = await Account.findOne({ username: parsed.data.username }).select("_id").maxTimeMS(2000).lean();
    if (socket.disconnected || socket._replacedBySocketId || socket.handshake?.session?.passport?.user !== actor)
      return;
    callback({ success: true, username: parsed.data.username, exists: Boolean(target) });
  } catch {
    callback({ success: false, error: "Unable to check the account. Please try again." });
  } finally {
    state.pending = false;
  }
};

module.exports = { handleModAccountExistence };
