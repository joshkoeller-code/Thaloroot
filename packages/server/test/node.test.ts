import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../src/node.js";

const server = startServer({ port: 0 });
afterAll(() => server.close());

function screen(port: number, code: string, role: "tv" | "player", token: string) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/${code}`);
  const msgs: any[] = [];
  ws.on("message", (raw) => msgs.push(JSON.parse(String(raw))));
  const opened = new Promise<void>((ok) => ws.on("open", () => (ws.send(JSON.stringify({ t: "hello", role, token })), ok())));
  const until = async (f: (m: any) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const m = [...msgs].reverse().find((x) => x.t === "state");
      if (m && f(m)) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out");
  };
  return { ws, msgs, opened, until, send: (m: any) => ws.send(JSON.stringify(m)) };
}

describe("the local server", () => {
  it("opens a room and carries a TV and a phone into it", async () => {
    const port = await server.ready;
    expect(((await (await fetch(`http://localhost:${port}/api/health`)).json()) as any).ok).toBe(true);
    const { code } = (await (await fetch(`http://localhost:${port}/api/rooms`, { method: "POST" })).json()) as { code: string };
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect((await fetch(`http://localhost:${port}/api/rooms/${code}`)).status).toBe(200);
    expect((await fetch(`http://localhost:${port}/api/rooms/ZZZZ`)).status).toBe(404);
    const tv = screen(port, code, "tv", "tv-token-123456");
    const phone = screen(port, code, "player", "phone-token-123456");
    await Promise.all([tv.opened, phone.opened]);
    phone.send({ t: "join", sheet: { name: "Ada" } });
    await phone.until((m) => m.you.seat === 0);
    tv.send({ t: "host", cmd: { cmd: "addBot" } });
    const s = await tv.until((m) => m.room.seats.length === 2);
    expect(s.room.seats[0]).toMatchObject({ name: "Ada", connected: true });
    tv.send({ t: "host", cmd: { cmd: "start" } });
    const p = await phone.until((m) => m.view?.phase === "classDraft" || m.view?.phase === "missionDraft");
    expect(p.you.seat).toBe(0);
    phone.ws.close();
    await tv.until((m) => !m.room.seats[0].connected);
    tv.ws.close();
  });

  it("turns away a room that doesn't exist", async () => {
    const port = await server.ready;
    const ws = new WebSocket(`ws://localhost:${port}/ws/QQQQ`);
    await new Promise<void>((ok) => ws.on("error", () => ok()));
  });
});
