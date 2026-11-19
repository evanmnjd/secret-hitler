jest.mock("../../../routes/socket/models", () => ({ games: {} }));

const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const { execFile } = require("child_process");
const buildEnhancedGameSummary = require("../../../models/game-summary/buildEnhancedGameSummary");
const buildReplay = require("../../../models/game-summary/buildReplay");
const summary = require("../../mocks/mockGameSummary");
const { createPreviewService, registerReplayPreviews, publicOrigin } = require("../../../routes/replay-previews");
const { publicPreviewFrame } = require("../../../routes/replay-preview-image");
const { replayMomentPath } = require("../../../src/shared/replay-moment");

const fixtureService = (options = {}) =>
  createPreviewService({ findSummary: async () => summary, liveGames: {}, ...options });
const moment = (turn, phase, end = false) => ({ turn: String(turn), phase, ...(end ? { end: "1" } : {}) });
// Run the server's real PNG codec in Node, as in production. jsdom's emulated byte operations
// are much slower and do not represent this endpoint's runtime.
const nativeRender = (frames, inspect = false) =>
  new Promise((resolve, reject) => {
    const script = `
      const Jimp = require("jimp");
      const { renderReplayPreview } = require("./routes/replay-preview-image");
      (async () => {
        const buffers = await Promise.all(JSON.parse(process.argv[1]).map(renderReplayPreview));
        if (process.argv[2] !== "inspect") return process.stdout.write(buffers[0]);
        const images = await Promise.all(buffers.map((buffer) => Jimp.read(buffer)));
        process.stdout.write(JSON.stringify(images.map((image, i) => ({
          signature: Array.from(buffers[i].slice(0, 8)), width: image.bitmap.width, height: image.bitmap.height,
          reds: [46, 140, 233, 327, 420, 514].map(x => image.getPixelColor(x + 40, 380)),
          blue: image.getPixelColor(132, 160), seat: image.getPixelColor(710, 300)
        }))));
      })().catch(error => { console.error(error); process.exitCode = 1; });`;
    execFile(
      process.execPath,
      ["-e", script, JSON.stringify(frames), inspect ? "inspect" : "render"],
      { cwd: path.resolve(__dirname, "../../.."), encoding: "buffer", maxBuffer: 2000000, timeout: 10000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(inspect ? JSON.parse(stdout.toString()) : stdout);
      }
    );
  });

describe("public replay moment previews", () => {
  it("reconstructs every exact moment using the same snapshots as browser playback", async () => {
    const ticks = buildReplay(buildEnhancedGameSummary(summary));
    const service = fixtureService();
    for (const tick of ticks.toArray()) {
      const data = await service.load(summary._id, moment(tick.turnNum + 1, tick.phase, tick.gameOver));
      expect(data.path).toBe(replayMomentPath(summary._id, tick));
      expect(data.frame).toEqual(publicPreviewFrame(summary._id, summary, tick));
    }
    expect((await service.load(summary._id, {})).frame).toMatchObject({
      turn: 1,
      phase: "candidacy",
      gameOver: false,
      liberalPolicies: 0,
      fascistPolicies: 0,
    });
    expect((await service.load(summary._id, moment(8, "policyEnaction", true))).frame).toMatchObject({
      gameOver: true,
      fascistPolicies: 6,
    });
    expect((await service.load(summary._id, moment(8, "policyEnaction"))).frame.gameOver).toBe(false);
  });

  it("exposes only public information known at the selected moment", async () => {
    const service = fixtureService();
    const candidate = (await service.load(summary._id, moment(1, "candidacy"))).frame;
    expect(candidate.presidentId).toBe(0);
    expect(candidate.chancellorId).toBeUndefined();
    expect(candidate.players.every((p) => p.vote === undefined)).toBe(true);
    const election = (await service.load(summary._id, moment(4, "election"))).frame;
    expect(election.players[1].vote).toBe(false);
    expect(election.players[0].vote).toBe(true);
    const execution = (await service.load(summary._id, moment(4, "execution"))).frame;
    expect(execution.players[3].dead).toBe(true);
    const specialElection = (await service.load(summary._id, moment(3, "specialElection"))).frame;
    expect(specialElection.presidentId).toBe(1);
    expect(specialElection.chancellorId).toBeUndefined();
    const serialized = JSON.stringify([candidate, election, execution]);
    [
      "role",
      "loyalty",
      "deckState",
      "presidentHand",
      "chancellorHand",
      "investigationClaim",
      "winningTeam",
      "chat",
      "hashUid",
      "ip",
    ].forEach((field) => expect(serialized).not.toContain(`"${field}"`));
  });

  it("rejects invalid, unavailable, incomplete and live games before disclosing state", async () => {
    const findSummary = jest.fn(async () => summary);
    const liveGames = { [summary._id]: { gameState: { isCompleted: false } } };
    const service = fixtureService({ findSummary, liveGames });
    await expect(service.load(summary._id, {})).rejects.toMatchObject({ status: 404 });
    expect(findSummary).not.toHaveBeenCalled();
    delete liveGames[summary._id];
    await expect(service.load("../bad", {})).rejects.toMatchObject({ status: 400 });
    await expect(service.load(summary._id, { turn: "0", phase: "election" })).rejects.toMatchObject({ status: 400 });
    await expect(service.load(summary._id, { turn: ["1", "2"], phase: "election" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.load(summary._id, moment(999, "election"))).rejects.toMatchObject({ status: 422 });
    await expect(fixtureService({ findSummary: async () => null }).load("absent", {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      fixtureService({ findSummary: async () => ({ ...summary, logs: [] }) }).load(summary._id, {})
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      fixtureService({ findSummary: async () => ({ ...summary, logs: summary.logs.slice(0, 1) }) }).load(
        summary._id,
        {}
      )
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      fixtureService({
        liveGames,
        findSummary: async () => {
          liveGames[summary._id] = { gameState: { isCompleted: false } };
          return summary;
        },
      }).load(summary._id, {})
    ).rejects.toMatchObject({ status: 404 });
  });

  it("renders a real 1200x630 PNG whose policy slots match the selected board", async () => {
    const service = fixtureService();
    const before = await service.load(summary._id, {});
    const after = await service.load(summary._id, moment(8, "policyEnaction", true));
    const [empty, full] = await nativeRender([before.frame, after.frame], true);
    expect(empty.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(empty.width).toBe(1200);
    expect(empty.height).toBe(630);
    full.reds.forEach((color, i) => expect(color).not.toBe(empty.reds[i]));
    // No liberal policy was enacted, so that track is identical throughout this fixture.
    expect(full.blue).toBe(empty.blue);
    expect(full.seat).not.toBe(empty.seat);
  });

  it("deduplicates pending renders, caps concurrency, and releases failed slots", async () => {
    let finish;
    const render = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const service = fixtureService({ render, renderLimit: 1 });
    const a = await service.load(summary._id, {});
    const b = await service.load(summary._id, moment(1, "nomination"));
    const first = service.image(a);
    const duplicate = service.image(a);
    await expect(service.image(b)).rejects.toMatchObject({ status: 503 });
    expect(render).toHaveBeenCalledTimes(1);
    finish(Buffer.from("image"));
    expect(await first).toBe(await duplicate);
    expect(await service.image(a)).toBe(await first);
    const failing = fixtureService({
      render: jest.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValue(Buffer.from("ok")),
      renderLimit: 1,
    });
    await expect(failing.image(a)).rejects.toThrow("failed");
    await expect(failing.image(b)).resolves.toHaveProperty("buffer");
  });

  it("caps database reads and releases a failed read slot", async () => {
    let finish;
    const findSummary = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const service = fixtureService({ findSummary, readLimit: 1 });
    const first = service.load(summary._id, {});
    await expect(service.load(summary._id, {})).rejects.toMatchObject({ status: 503 });
    expect(findSummary).toHaveBeenCalledTimes(1);
    finish(summary);
    await first;
    findSummary.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.load(summary._id, {})).rejects.toThrow("database unavailable");
    findSummary.mockResolvedValueOnce(summary);
    await expect(service.load(summary._id, {})).resolves.toHaveProperty("frame");
  });

  it("bounds cache size and expiration and the uncached render rate", async () => {
    let time = 0;
    const render = jest.fn(async () => Buffer.from("image"));
    const service = fixtureService({ now: () => time, render, cacheLimit: 1, renderBudget: 3 });
    const a = await service.load(summary._id, {});
    const b = await service.load(summary._id, moment(1, "nomination"));
    await service.image(a);
    await service.image(b);
    await service.image(a);
    expect(render).toHaveBeenCalledTimes(3);
    await expect(service.image(b)).rejects.toMatchObject({ status: 503 });
    time = 600000;
    await service.image(a);
    expect(render).toHaveBeenCalledTimes(4);
  });
});

describe("replay share HTTP routes", () => {
  let server;
  let base;
  let liveGames;
  beforeAll(async () => {
    const app = express();
    liveGames = {};
    app.use((req, _res, next) => {
      req.isAuthenticated = () => req.get("x-test-auth") === "yes";
      next();
    });
    registerReplayPreviews(app, fixtureService({ liveGames, render: (frame) => nativeRender([frame]) }));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("serves crawler-readable OG metadata and an exact human playback destination", async () => {
    const response = await fetch(`${base}/replay/${summary._id}?turn=2&phase=investigation`, {
      headers: { "User-Agent": "Discordbot/2.0" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain('property="og:image"');
    expect(html).toContain(`${base}/replay/${summary._id}/preview.png?turn=2&amp;phase=investigation`);
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain("0 liberal policies, 2 fascist policies");
    expect(html).toContain(`/observe/#/replay/${summary._id}?turn=2&amp;phase=investigation`);
    expect(html).toContain("window.location.replace");
    expect(html).not.toMatch(/winningTeam|Thrall|presidentHand|role"|deckState/i);
    const authed = await (
      await fetch(`${base}/replay/${summary._id}?turn=8&phase=policyEnaction&end=1`, {
        headers: { "x-test-auth": "yes" },
      })
    ).text();
    expect(authed).toContain(`/game/#/replay/${summary._id}?turn=8&amp;phase=policyEnaction&amp;end=1`);
  });

  it("serves actual image bytes and handles conditional requests and bad moments", async () => {
    const path = `${base}/replay/${summary._id}/preview.png?turn=2&phase=investigation`;
    const response = await fetch(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = await response.buffer();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect((await fetch(path, { headers: { "If-None-Match": response.headers.get("etag") } })).status).toBe(304);
    expect((await fetch(`${base}/replay/${summary._id}?turn=1&turn=2&phase=election`)).status).toBe(400);
    expect((await fetch(`${base}/replay/${summary._id}?turn=99&phase=election`)).status).toBe(422);
    liveGames[summary._id] = { gameState: { isCompleted: false } };
    expect((await fetch(path)).status).toBe(404);
    delete liveGames[summary._id];
  });

  it("uses the configured public origin and ignores arbitrary request hostnames", () => {
    const original = process.env.PUBLIC_SITE_URL;
    process.env.PUBLIC_SITE_URL = "https://preview.example/test";
    expect(publicOrigin({ get: () => "evil.example" })).toBe("https://preview.example");
    process.env.PUBLIC_SITE_URL = "javascript:alert(1)";
    expect(publicOrigin({ get: () => "evil.example" })).toBe("http://127.0.0.1:8080");
    if (original === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = original;
  });
});
