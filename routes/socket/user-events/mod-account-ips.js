const { isIP } = require("net");
const { z } = require("zod");
const Account = require("../../../models/account");
const { obfIP } = require("../ip-obf");

const allowedRoles = new Set(["moderator", "editor", "admin"]);
const requestSchema = z.object({ username: z.string().trim().min(1).max(100) }).strict();
const pending = new WeakSet();
const permissionError = "Only moderators, editors and admins can look up account IPs.";
const currentIdentity = (socket, username) =>
  !socket.disconnected && !socket._replacedBySocketId && socket.handshake?.session?.passport?.user === username;

const protectedIP = (address) => {
  // The shared obfuscator also accepts ranges and has legacy error sentinels.
  // Account IP fields are individual addresses: malformed/missing fields stay
  // unavailable rather than risking an unchanged value or an error disclosure.
  if (typeof address !== "string" || !isIP(address)) return null;
  try {
    const result = obfIP(address.toLowerCase());
    return typeof result === "string" && result.length && !result.startsWith("!!") ? `-${result}` : null;
  } catch {
    return null;
  }
};

const actorRole = async (username) =>
  (await Account.findOne({ username }).select("staffRole").maxTimeMS(2000).lean())?.staffRole;

const handleAccountIPLookup = async (socket, data, callback) => {
  if (typeof callback !== "function") return;
  const username = socket.handshake?.session?.passport?.user;
  if (typeof username !== "string" || !username || !currentIdentity(socket, username)) {
    callback({ success: false, error: permissionError });
    return;
  }
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) {
    callback({ success: false, error: "Enter a valid account username." });
    return;
  }
  if (pending.has(socket)) {
    callback({ success: false, error: "Please wait for the previous IP lookup." });
    return;
  }
  pending.add(socket);
  let response;
  try {
    if (!allowedRoles.has(await actorRole(username))) {
      response = { success: false, error: permissionError };
    } else {
      const account = await Account.findOne({ username: parsed.data.username })
        .select("username signupIP lastConnectedIP")
        .maxTimeMS(2000)
        .lean();
      // Recheck persisted permissions after the target query as well: a socket
      // opened while staff must not retain access after demotion or replacement.
      if (!currentIdentity(socket, username) || !allowedRoles.has(await actorRole(username))) {
        response = { success: false, error: permissionError };
      } else {
        response = account
          ? {
              success: true,
              exists: true,
              username: account.username,
              signupIP: protectedIP(account.signupIP),
              lastConnectedIP: protectedIP(account.lastConnectedIP),
            }
          : { success: true, exists: false, username: parsed.data.username };
      }
    }
  } catch {
    // Driver errors can include query data or stored addresses. Neither send
    // them to the browser nor print them as part of this read-only lookup.
    response = { success: false, error: "Unable to look up account IPs. Please try again." };
  } finally {
    pending.delete(socket);
  }
  if (currentIdentity(socket, username)) callback(response);
};

module.exports = { handleAccountIPLookup };
