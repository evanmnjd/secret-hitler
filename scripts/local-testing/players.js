const io = require("socket.io-client");
const { getLocalTestingConfig } = require("./config");

const PASSWORD = "LocalTest123!";
const validateCount = (count) => {
  if (!Number.isSafeInteger(count) || count < 1 || count > 12) {
    throw new Error("--count must be an integer from 1 to 12.");
  }
  return count;
};
const validateGame = (game) => {
  if (game !== undefined && (typeof game !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(game))) {
    throw new Error("--game must be a lobby UID, copied from its /table/ URL.");
  }
  return game;
};

const parsePlayerArgs = (args) => {
  const options = { count: 8 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--") continue;
    else if (arg === "--count" || arg.startsWith("--count=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
      if (!/^\d+$/.test(value || "")) throw new Error("--count must be an integer from 1 to 12.");
      options.count = validateCount(Number(value));
    } else if (arg === "--game" || arg.startsWith("--game=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++index];
      options.game = validateGame(value);
      if (!options.game) throw new Error("--game needs a lobby UID.");
    } else throw new Error(`Unknown option: ${arg}. Use --help for available options.`);
  }
  return options;
};

const assertOrdinaryProfile = (profile, username) => {
  if (!profile || profile._id !== username || profile.staffRole) {
    throw new Error(
      `${username} is missing or no longer an ordinary player. Run local:seed first, or restore fixtures with local:seed --reset.`
    );
  }
};

const waitFor = (socket, event, predicate, signal, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, receive);
      socket.off("connect_error", failed);
      socket.off("disconnect", disconnected);
      socket.off("manualReplayRequest", noLobby);
      socket.off("gameJoinStatusUpdate", rejectedSeat);
      signal?.removeEventListener("abort", aborted);
    };
    const finish = (error, value) => {
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const receive = (value) => {
      if (predicate(value)) finish(null, value);
    };
    const failed = (error) => finish(new Error(`Local socket connection failed: ${error.message || error}`));
    const disconnected = () => finish(new Error("A local player disconnected before setup finished."));
    const aborted = () => finish(new Error("Local players stopped."));
    const noLobby = () => finish(new Error("No active lobby with that UID. Create a public waiting lobby first."));
    const rejectedSeat = (status) => finish(new Error(`The lobby rejected seating (${status?.status || "unknown"}).`));
    if (signal?.aborted) return aborted();
    socket.on(event, receive);
    socket.on("connect_error", failed);
    socket.on("disconnect", disconnected);
    socket.on("manualReplayRequest", noLobby);
    socket.on("gameJoinStatusUpdate", rejectedSeat);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${event}. Check the lobby's entry settings.`)),
      timeoutMs
    );
  });

const enterLobby = async (socket, uid, signal) => {
  const update = waitFor(socket, "gameUpdate", (game) => game?.general?.uid === uid, signal);
  socket.emit("getGameInfo", uid);
  return update;
};

const connectPlayers = async (
  { count = 8, game } = {},
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    ioFactory = io,
    log = console.log,
    onStopAvailable = () => {},
  } = {}
) => {
  validateCount(count);
  validateGame(game);
  const { port } = getLocalTestingConfig(env);
  const origin = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const clients = [];
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const socket of clients) {
      socket.disconnect();
      socket.removeAllListeners();
    }
  };
  onStopAvailable(stop);
  const request = (url, options = {}) =>
    fetchImpl(url, {
      ...options,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
  const names = Array.from({ length: count }, (_, index) => `LocalDemoPlayer${String(index + 1).padStart(2, "0")}`);
  log(`Local fixture players: ${origin}`);
  log("These ordinary players stay idle: no chat, voting, policy selection or other gameplay is automated.");
  log("Each loopback connection uses a different simulated X-Forwarded-For documentation IP for local IP testing.");

  try {
    // Check every role before opening any authenticated socket. A manually
    // promoted fixture must not quietly become a privileged automated client.
    for (const username of names) {
      const response = await request(`${origin}/profile?username=${encodeURIComponent(username)}`);
      if (!response.ok)
        throw new Error(`${username} has no readable local profile. Run local:seed and local:test first.`);
      assertOrdinaryProfile(await response.json(), username);
    }
    for (const [index, username] of names.entries()) {
      const forwardedIp = `192.0.2.${100 + index}`;
      const headers = { "content-type": "application/json", "x-forwarded-for": forwardedIp };
      const response = await request(`${origin}/account/signin`, {
        method: "POST",
        headers,
        body: JSON.stringify({ username, password: PASSWORD }),
      });
      if (!response.ok)
        throw new Error(`Sign-in failed for ${username}. Restore its demo password with local:seed --reset.`);
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      if (!cookie) throw new Error(`No session cookie returned for ${username}.`);
      // A normal browser opens /game/ after login. This also stores the simulated
      // connection IP using the existing application's ordinary request path.
      const opened = await request(`${origin}/game/`, { headers: { Cookie: cookie, "x-forwarded-for": forwardedIp } });
      if (!opened.ok) throw new Error(`Could not open the local game page for ${username}.`);
      await opened.arrayBuffer();
      const socket = ioFactory(origin, {
        autoConnect: false,
        forceNew: true,
        forceNode: true,
        reconnection: false,
        transports: ["websocket"],
        extraHeaders: { Cookie: cookie, "x-forwarded-for": forwardedIp },
      });
      clients.push(socket);
      const ready = waitFor(socket, "socketReady", () => true, controller.signal);
      socket.connect();
      await ready;
      log(`Online: ${username} (simulated IP ${forwardedIp})`);
    }
    if (game) {
      const initial = await enterLobby(clients[0], game, controller.signal);
      if (initial.gameState?.isTracksFlipped || initial.gameState?.isCompleted) {
        throw new Error("Choose an unstarted waiting lobby; these clients do not join games already in progress.");
      }
      const available = initial.general.maxPlayersCount - initial.publicPlayersState.length;
      if (!Number.isSafeInteger(available) || available < count) {
        throw new Error(
          `The lobby has ${available} free seats, but --count requests ${count}. No test player was seated.`
        );
      }
      for (const [index, socket] of clients.entries()) {
        if (index > 0) await enterLobby(socket, game, controller.signal);
        const seated = waitFor(socket, "updateSeatForUser", (value) => value === true, controller.signal);
        socket.emit("updateSeatedUser", { uid: game });
        await seated;
        log(`Seated: ${names[index]} in ${game}`);
      }
    }
    log(`${count} ordinary local players ready. Press Ctrl+C to disconnect them.`);
    return { stop, clients, names, origin };
  } catch (error) {
    stop();
    throw error;
  }
};

const main = async () => {
  const options = parsePlayerArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "pnpm local:players [--count 8] [--game LOBBY_UID]\n\nConnects ordinary LocalDemoPlayer01..12 accounts to the local test server.\nOptional --game takes seats in an existing public waiting lobby; no gameplay is automated.\nUses LOCAL_TEST_PORT (default 8080). Press Ctrl+C to disconnect."
    );
    return;
  }
  let stop = () => {};
  let stopped = false;
  let resolveStopped;
  const finished = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const onSignal = () => {
    stopped = true;
    stop();
    resolveStopped();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await connectPlayers(options, {
      onStopAvailable: (cleanup) => {
        stop = cleanup;
        if (stopped) stop();
      },
    });
    await finished;
  } catch (error) {
    if (!stopped) throw error;
  } finally {
    stop();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Local players failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parsePlayerArgs, assertOrdinaryProfile, waitFor, connectPlayers };
