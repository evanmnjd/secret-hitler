import { isReplayWhisper } from "./chat";

export const UNKNOWN_WHISPER_PAIR = "legacy-unknown";

export const replayChatText = (chat) => {
  if (typeof chat?.chat === "string") return chat.chat;
  if (!Array.isArray(chat?.chat)) return "";
  return chat.chat
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.claim === "string") return part.claim;
      if (Array.isArray(part?.claim)) return part.claim.join("");
      if (typeof part?.policies === "string") return part.policies;
      if (Array.isArray(part?.policies)) return part.policies.join("");
      return "";
    })
    .join("");
};

export const replayWhisperPair = (chat) => {
  const { sender, recipient } = chat?.neighborChat || {};
  return typeof sender === "string" && sender && typeof recipient === "string" && recipient
    ? JSON.stringify([sender, recipient].sort())
    : UNKNOWN_WHISPER_PAIR;
};

export const replayChatOptions = (chats, seatedUserNames = []) => {
  const players = new Set(seatedUserNames.filter((name) => typeof name === "string" && name));
  const pairs = new Map();
  for (const chat of chats) {
    if (typeof chat.userName === "string" && chat.userName) players.add(chat.userName);
    if (!isReplayWhisper(chat)) continue;
    const pair = replayWhisperPair(chat);
    if (pair === UNKNOWN_WHISPER_PAIR) pairs.set(pair, "Unknown participants (legacy)");
    else {
      const names = JSON.parse(pair);
      names.forEach((name) => players.add(name));
      pairs.set(pair, names.join(" ↔ "));
    }
  }
  return {
    players: [...players].sort((a, b) => a.localeCompare(b)),
    pairs: [...pairs].sort((a, b) => a[1].localeCompare(b[1])),
  };
};

export const matchesReplayChat = (chat, { searchText = "", selectedPlayer, selectedPair }) => {
  const whisper = isReplayWhisper(chat);
  const { sender, recipient } = chat.neighborChat || {};
  if (
    selectedPlayer &&
    (whisper ? sender !== selectedPlayer && recipient !== selectedPlayer : chat.userName !== selectedPlayer)
  )
    return false;
  // Public chat remains controlled by its own toggle and filters.
  if (selectedPair && whisper && replayWhisperPair(chat) !== selectedPair) return false;
  const query = searchText.trim().toLowerCase();
  return !query || [replayChatText(chat), chat.userName, sender, recipient].join(" ").toLowerCase().includes(query);
};
