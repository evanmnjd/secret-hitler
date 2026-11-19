const buildEnhancedGameSummary = require("./buildEnhancedGameSummary");

// Read-only diagnostics. Reconstruction is a warning, never a reason to remove or rewrite the
// original archive: historical/custom games may use shapes the current parser cannot interpret.
const auditArchive = (uid, transcript, summary) => {
  const issues = [];
  if (!transcript) issues.push("missing-transcript");
  if (!summary && transcript?.summaryExpected === true) issues.push("missing-summary");
  if (!summary && transcript?.summaryExpected === undefined) issues.push("legacy-summary-unavailable-or-intentional");
  for (const [name, record] of [
    ["transcript", transcript],
    ["summary", summary],
  ]) {
    if (!record) continue;
    const version = record.archiveVersion;
    if (version !== undefined && version !== 1) issues.push(`${name}-unrecognized-version`);
  }
  if (summary) {
    if (summary._id !== uid || !Array.isArray(summary.players) || !Array.isArray(summary.logs)) {
      issues.push("summary-invalid-shape");
    } else if (summary.logs.length) {
      try {
        buildEnhancedGameSummary(summary);
      } catch {
        issues.push("summary-reconstruction-warning");
      }
    }
  }
  return { uid, issues };
};

module.exports = auditArchive;
