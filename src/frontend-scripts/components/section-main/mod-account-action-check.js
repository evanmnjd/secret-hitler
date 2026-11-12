// Game and global actions keep their existing behavior, even if a username
// happens to remain in the shared input. Account names that resemble game-action
// prefixes must still be checked: the actual action determines the target type.
const nonAccountActions = new Set([
  "deleteGame",
  "resetGameName",
  "modEndGame",
  "lagMeter",
  "resetServer",
  "regatherAEMList",
  "makeBypass",
  "setSticky",
  "broadcast",
  "getFilteredData",
  "enableAccountCreation",
  "disableAccountCreation",
  "enableGameCreation",
  "disableGameCreation",
  "enableIpbans",
  "disableIpbans",
  "enableVPNCheck",
  "disableVPNCheck",
  "enableLimitNewPlayers",
  "disableLimitNewPlayers",
]);

export const needsAccountCheck = (payload) => {
  const action = typeof payload.action === "object" ? payload.action?.type : payload.action;
  const username = String(payload.userName || "").trim();
  return Boolean(username && !username.startsWith("-") && !nonAccountActions.has(action));
};

export const canCheckAccounts = (role) => ["moderator", "editor", "admin"].includes(role);
