const powers = {
  investigation: "Investigation",
  policyPeek: "Policy peek",
  specialElection: "Special election",
  execution: "Execution",
  assassination: "Assassination",
};

export const replayTimeline = (ticks) => {
  const events = [];
  const governments = new Set();
  const seenPowers = new Set();
  ticks.forEach((tick, position) => {
    if (!governments.has(tick.turnNum)) {
      governments.add(tick.turnNum);
      events.push({ position, turn: tick.turnNum + 1, label: `Gov ${tick.turnNum + 1}`, type: "government" });
    }
    const key = `${tick.turnNum}:${tick.phase}`;
    if (powers[tick.phase] && !tick.gameOver && !seenPowers.has(key)) {
      seenPowers.add(key);
      events.push({ position, turn: tick.turnNum + 1, label: powers[tick.phase], type: "power" });
    }
    if (tick.gameOver) events.push({ position, turn: tick.turnNum + 1, label: "Result", type: "result" });
  });
  return events;
};
