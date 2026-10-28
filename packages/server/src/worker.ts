/**
 * Thaloroot on Cloudflare. The Worker serves the web app and opens rooms; each
 * room lives in its own Durable Object, which holds the live connections, runs
 * the computer players, and saves the game after every move.
 *
 * Deploy with `npm run deploy` (see docs/hosting.md).
 */
import { DurableObject } from "cloudflare:workers";
import { newRoom, Room, roomCode, type ClientMsg, type Conn, type RoomData } from "./room.js";

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}

/** A room nobody has touched in this long is cleared away. */
const IDLE_MS = 3 * 24 * 60 * 60 * 1000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const random = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/api/health") return json(200, { ok: true });
    if (path === "/api/rooms" && req.method === "POST") {
      for (let i = 0; i < 12; i++) {
        const code = roomCode(random);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch(`https://room/init?code=${code}`, { method: "POST" });
        if (r.status === 201) return json(201, { code });
      }
      return json(503, { error: "Couldn't find a free room code. Try again in a minute." });
    }
    const info = path.match(/^\/api\/rooms\/([A-Z]{4})$/);
    if (info) return env.ROOMS.get(env.ROOMS.idFromName(info[1])).fetch("https://room/info");
    const ws = path.match(/^\/ws\/([A-Z]{4})$/);
    if (ws) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json(426, { error: "Expected a WebSocket." });
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch(new Request("https://room/ws", req));
    }
    // everything else is the web app; it routes with the URL hash
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private n = 0;

  /** The room, loaded from storage the first time it's needed after a wake-up. */
  private async load(): Promise<Room | null> {
    if (this.room) return this.room;
    const data = await this.ctx.storage.get<RoomData>("room");
    if (!data) return null;
    this.room = this.open(data);
    this.room.resume();
    return this.room;
  }

  private open(data: RoomData): Room {
    return new Room(data, {
      random,
      // the Durable Object keeps writes in order and won't drop them
      save: (d) => void this.ctx.storage.put("room", d),
    });
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (await this.ctx.storage.get("room")) return json(409, { error: "taken" });
      const code = url.searchParams.get("code") ?? "";
      const data = newRoom(code);
      await this.ctx.storage.put("room", data);
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
      this.room = this.open(data);
      return json(201, { code });
    }
    const room = await this.load();
    if (!room) return json(404, { error: "No room with that code." });
    if (url.pathname === "/info") return json(200, { code: room.data.code, phase: room.data.phase });
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      const conn: Conn = {
        id: `w${++this.n}`,
        send: (msg) => {
          try {
            server.send(JSON.stringify(msg));
          } catch {
            /* the socket closed; the close handler tidies up */
          }
        },
      };
      room.connect(conn);
      server.addEventListener("message", (e) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
        } catch {
          return conn.send({ t: "error", message: "That message didn't make sense." });
        }
        room.message(conn, msg);
      });
      const gone = () => room.disconnect(conn);
      server.addEventListener("close", gone);
      server.addEventListener("error", gone);
      return new Response(null, { status: 101, webSocket: client });
    }
    return json(404, { error: "Not found." });
  }

  /** Clear away rooms nobody has used in a while. */
  override async alarm(): Promise<void> {
    const room = await this.load();
    const idle = room ? Date.now() - room.data.updated : Infinity;
    if (room && (room.connections > 0 || idle < IDLE_MS)) {
      await this.ctx.storage.setAlarm(Date.now() + Math.max(60_000, IDLE_MS - idle));
      return;
    }
    room?.close();
    this.room = null;
    await this.ctx.storage.deleteAll();
  }
}
