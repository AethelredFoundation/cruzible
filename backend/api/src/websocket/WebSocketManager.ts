import type { Server as SocketIOServer } from "socket.io";

export class WebSocketManager {
  constructor(private readonly io: SocketIOServer) {}

  initialize(): void {
    this.io.on("connection", (socket) => {
      socket.emit("ready", { ok: true });
    });
  }
}
