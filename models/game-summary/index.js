/*
 * Minimal representation of a game. Schema is likely final and should not be changed without good reason.
 * Use GameSummaryBuilder as a convenience tool to gradually build up this object.
 * Once you fetch this from the database, wrap it in an EnhancedGameSummary for a more human-friendly representation.
 * see: `./GameSummaryBuilder, ./EnhancedGameSummary`
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;
// Turns and seats are addressed by their array index throughout replay building.
// Keep the root game ID, but do not allocate unused ObjectIds for each nested row.
// Missing optional hands/claims/peeks already mean "no action" to the replay parser;
// avoid materializing an empty BSON array for each absent field on every turn.
const optionalArray = () => ({ type: Array, default: undefined });
const gameSummary = new Schema({
  _id: String,
  date: Date,
  gameSetting: {
    rebalance6p: Boolean,
    rebalance7p: Boolean,
    rebalance9p: Boolean,
    rerebalance9p: Boolean,
    casualGame: Boolean,
    practiceGame: Boolean,
    unlistedGame: Boolean,
    monarchistSH: Boolean,
    avalonSH: {
      type: new Schema({ withPercival: Boolean }, { _id: false }),
      default: null,
    },
    noTopdecking: Number,
    // authoritative winner for games decided by Flappy Hitler (race, coin flip, or
    // deck-decides). These outcomes are NOT derivable from the policy logs - the last
    // enacted policy may belong to the LOSING team - so consumers must prefer this
    // field when present. Absent on all non-flappy games (legacy derivation applies).
    flappyWinner: String,
  },
  players: [
    new Schema(
      {
        username: String,
        role: String,
        icon: Number,
        hashUid: String,
      },
      { _id: false }
    ),
  ],
  libElo: {
    overall: Number,
    season: Number,
  },
  fasElo: {
    overall: Number,
    season: Number,
  },
  logs: [
    new Schema(
      {
        // election
        presidentId: Number,
        chancellorId: Number,
        votes: Array, // [Boolean]

        // policy enaction
        presidentHand: optionalArray(), // [String] eg. [ "fascist", "liberal", "fascist" ]
        chancellorHand: optionalArray(), // [String]
        enactedPolicy: String,

        presidentClaim: optionalArray(), // [String]
        chancellorClaim: optionalArray(), // [String]

        presidentVeto: Boolean,
        chancellorVeto: Boolean,

        // actions
        policyPeek: optionalArray(), // [String]
        policyPeekClaim: optionalArray(), // [String]
        investigatorId: Number,
        investigationId: Number,
        investigationClaim: String,
        specialElection: Number,
        execution: Number,
        assassination: Number,

        // other metadata
        deckState: Array, // [String], eg. [ "fascist", "liberal", "fascist", "fascist", "liberal" ]
      },
      { _id: false }
    ),
  ],
  customGameSettings: {
    enabled: Boolean,
    powers: Array, // [power x5, string or null]
    hitlerZone: Number,
    vetoZone: Number,
    fascistCount: Number,
    hitKnowsFas: Boolean,
    deckState: {
      lib: Number,
      fas: Number,
    },
    trackState: {
      lib: Number,
      fas: Number,
    },
  },
});

module.exports = mongoose.model("GameSummary", gameSummary);
