const { createHash } = require("crypto");
const GameSummary = require("../models/game-summary");
const { games } = require("./socket/models");
const buildEnhancedGameSummary = require("../models/game-summary/buildEnhancedGameSummary");
const buildReplay = require("../models/game-summary/buildReplay");
const { validUid, parseReplayMoment, resolveReplayMoment, replayMomentPath } = require("../src/shared/replay-moment");
const { publicPreviewFrame, renderReplayPreview } = require("./replay-preview-image");

const failure = (status, message) => Object.assign(new Error(message), { status });
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
const publicOrigin = (req) => {
  const configured = process.env.PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.origin;
    } catch (_error) {
      // A bad deployment setting must not make request headers the public origin.
    }
  }
  if (process.env.NODE_ENV === "production") return "https://secrethitler.io";
  const host = req.get("host");
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host) ? `http://${host}` : "http://127.0.0.1:8080";
};

const createPreviewService = ({
  findSummary = (uid) =>
    GameSummary.findById(uid).select("_id date gameSetting players logs customGameSettings").maxTimeMS(2000).lean(),
  liveGames = games,
  render = renderReplayPreview,
  now = Date.now,
  cacheLimit = 16,
  readLimit = 4,
  renderLimit = 2,
  renderBudget = 30,
} = {}) => {
  const cache = new Map();
  const pending = new Map();
  let reading = 0;
  let active = 0;
  let budgetStart = now();
  let spent = 0;
  const isLive = (uid) => Object.hasOwn(liveGames, uid) && !liveGames[uid].gameState?.isCompleted;
  const load = async (uid, query) => {
    if (!validUid(uid)) throw failure(400, "Invalid replay link.");
    let moment;
    try {
      moment = parseReplayMoment(query);
    } catch (_error) {
      throw failure(400, "Invalid replay moment.");
    }
    if (isLive(uid)) throw failure(404, "This replay is not available until the game ends.");
    if (reading >= readLimit) throw failure(503, "Replay previews are busy. Please try again shortly.");
    reading += 1;
    try {
      const summary = await findSummary(uid);
      if (!summary) throw failure(404, "Replay not found.");
      if (isLive(uid)) throw failure(404, "This replay is not available until the game ends.");
      if (
        !Array.isArray(summary.logs) ||
        summary.logs.length < 1 ||
        summary.logs.length > 500 ||
        !Array.isArray(summary.players) ||
        summary.players.length < 5 ||
        summary.players.length > 10
      ) {
        throw failure(422, "This replay cannot be reconstructed.");
      }
      try {
        const ticks = buildReplay(buildEnhancedGameSummary(summary));
        const snapshot = ticks.get(resolveReplayMoment(ticks, moment));
        const frame = publicPreviewFrame(uid, summary, snapshot);
        const version = createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 20);
        return { frame, path: replayMomentPath(uid, snapshot), version };
      } catch (_error) {
        throw failure(422, "This replay does not contain a readable version of that moment.");
      }
    } finally {
      reading -= 1;
    }
  };
  const image = async (data) => {
    const key = `${data.path}:${data.version}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    if (now() - budgetStart >= 60000) {
      budgetStart = now();
      spent = 0;
    }
    if (active >= renderLimit || spent >= renderBudget)
      throw failure(503, "Replay previews are busy. Please try again shortly.");
    active += 1;
    spent += 1;
    const task = Promise.resolve()
      .then(() => render(data.frame))
      .then((buffer) => {
        const result = {
          buffer,
          etag: `"${createHash("sha256").update(buffer).digest("hex")}"`,
          expires: now() + 600000,
        };
        cache.set(key, result);
        while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
        return result;
      })
      .finally(() => {
        active -= 1;
        pending.delete(key);
      });
    pending.set(key, task);
    return task;
  };
  return { load, image, isLive };
};

const registerReplayPreviews = (app, service = createPreviewService()) => {
  let readWindow = Date.now();
  let reads = 0;
  const route = (png) => async (req, res) => {
    try {
      if (Date.now() - readWindow >= 60000) {
        readWindow = Date.now();
        reads = 0;
      }
      if (++reads > 240) throw failure(429, "Replay previews are busy. Please try again shortly.");
      const data = await service.load(req.params.uid, req.query);
      if (png) {
        const result = await service.image(data);
        if (service.isLive(req.params.uid)) throw failure(404, "This replay is not available until the game ends.");
        res.set({
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=60",
          ETag: result.etag,
          "X-Content-Type-Options": "nosniff",
        });
        return req.get("if-none-match") === result.etag ? res.status(304).end() : res.send(result.buffer);
      }
      const origin = publicOrigin(req);
      const [pathname, query] = data.path.split("?");
      const imageUrl = `${origin}${pathname}/preview.png?${query}`;
      const destination = `${req.isAuthenticated?.() ? "/game/" : "/observe/"}#/replay/${encodeURIComponent(req.params.uid)}?${query}`;
      const title = `Secret Hitler replay - Government ${data.frame.turn}: ${data.frame.phaseLabel}`;
      const description = `${data.frame.liberalPolicies} liberal policies, ${data.frame.fascistPolicies} fascist policies. Election tracker ${data.frame.electionTracker}/3.`;
      const meta = {
        "og:type": "website",
        "og:site_name": "Secret Hitler",
        "og:title": title,
        "og:description": description,
        "og:url": `${origin}${data.path}`,
        "og:image": imageUrl,
        "og:image:width": "1200",
        "og:image:height": "630",
        "og:image:type": "image/png",
        "og:image:alt": `${title}. ${description}`,
        "twitter:card": "summary_large_image",
      };
      res.set("Cache-Control", "private, no-store");
      return res.type("html").send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${Object.entries(
          meta
        )
          .map(([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}">`)
          .join(
            ""
          )}</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(destination)}">Open replay at this moment</a></p><script>window.location.replace(${JSON.stringify(destination)});</script></body></html>`
      );
    } catch (error) {
      const status = error.status || 503;
      res.set("Cache-Control", "no-store");
      if (status === 429 || status === 503) res.set("Retry-After", "5");
      return res
        .status(status)
        .type("text")
        .send(error.status ? error.message : "Replay preview temporarily unavailable.");
    }
  };
  app.get("/replay/:uid/preview.png", route(true));
  app.get("/replay/:uid", route(false));
};

module.exports = { registerReplayPreviews, createPreviewService, publicOrigin };
