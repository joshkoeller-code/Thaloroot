/**
 * A small Node server for playing at home or testing: it serves the web app,
 * opens rooms, and carries each screen's live connection to its room.
 *
 *   npm run build && npm start -w @thaloroot/server     (PORT=8080, DATA_DIR=./rooms)
 *
 * Production hosting uses the same Room behind a different adapter.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { newRoom, Room, roomCode, type ClientMsg, type Conn, type RoomData } from "./room.js";

export interface ServerOptions {
  port?: number;
  /** The built web app (apps/web/dist). */
  webDir?: string;
  /** Where rooms are saved between restarts. Leave out to keep them in memory only. */
  dataDir?: string;
  /** Rooms with nobody connected are forgotten after this long. */
  idleMs?: number;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function startServer(opts: ServerOptions = {}) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const webDir = resolve(opts.webDir ?? join(here, "../../../apps/web/dist"));
  const dataDir = opts.dataDir ? resolve(opts.dataDir) : null;
  const idleMs = opts.idleMs ?? 24 * 60 * 60 * 1000;
  const rooms = new Map<string, Room>();

  const saver = (d: RoomData) => {
    if (!dataDir) return;
    try {
      writeFileSync(join(dataDir, `${d.code}.json`), JSON.stringify(d));
    } catch (e) {
      console.error(`couldn't save room ${d.code}:`, e);
    }
  };
  const open = (data: RoomData) => {
    const room = new Room(data, { save: saver });
    rooms.set(data.code, room);
    return room;
  };

  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    for (const f of readdirSync(dataDir).filter((x) => x.endsWith(".json"))) {
      try {
        const d = JSON.parse(readFileSync(join(dataDir, f), "utf8")) as RoomData;
        if (d.version === 1 && Date.now() - d.updated < idleMs) open(d).resume();
      } catch {
        /* skip a damaged save */
      }
    }
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, rooms: rooms.size });
    if (url.pathname === "/api/rooms" && req.method === "POST") {
      let code = roomCode();
      for (let i = 0; rooms.has(code) && i < 50; i++) code = roomCode();
      if (rooms.has(code)) return json(res, 503, { error: "Too many rooms open. Try again in a minute." });
      open(newRoom(code)).resume();
      return json(res, 201, { code });
    }
    const m = url.pathname.match(/^\/api\/rooms\/([A-Z]{4})$/);
    if (m) {
      const room = rooms.get(m[1]);
      return room ? json(res, 200, { code: m[1], phase: room.data.phase }) : json(res, 404, { error: "No room with that code." });
    }
    // static files; anything unknown gets the app (it routes with the URL hash)
    let file = normalize(join(webDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(webDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(webDir, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Build the web app first: npm run build");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let n = 0;
  http.on("upgrade", (req, socket, head) => {
    const m = new URL(req.url ?? "/", "http://x").pathname.match(/^\/ws\/([A-Z]{4})$/);
    const room = m ? rooms.get(m[1]) : undefined;
    if (!room) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const conn: Conn = { id: `n${++n}`, send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)) };
      let alive = true;
      room.connect(conn);
      ws.on("pong", () => (alive = true));
      const beat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 20_000);
      ws.on("message", (raw) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return conn.send({ t: "error", message: "That message didn't make sense." });
        }
        room.message(conn, msg);
      });
      ws.on("close", () => {
        clearInterval(beat);
        room.disconnect(conn);
      });
    });
  });

  // forget rooms nobody has touched in a long while
  const sweep = setInterval(() => {
    for (const [code, room] of rooms) {
      if (room.connections === 0 && Date.now() - room.data.updated > idleMs) {
        room.close();
        rooms.delete(code);
      }
    }
  }, 10 * 60 * 1000);

  const port = opts.port ?? 8080;
  const ready = new Promise<number>((ok) => http.listen(port, () => ok((http.address() as any).port)));
  return {
    rooms,
    ready,
    close: () =>
      new Promise<void>((ok) => {
        clearInterval(sweep);
        for (const r of rooms.values()) r.close();
        for (const c of wss.clients) c.terminate();
        http.close(() => ok());
      }),
  };
}

// run directly: node dist/node.js
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const s = startServer({ port: Number(process.env.PORT ?? 8080), dataDir: process.env.DATA_DIR, webDir: process.env.WEB_DIR });
  s.ready.then((port) => console.log(`Thaloroot is open at http://localhost:${port}`));
}
