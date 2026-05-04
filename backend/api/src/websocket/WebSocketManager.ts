import { timingSafeEqual } from "crypto";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { isAccessTokenRevoked, verifyAccessToken } from "../auth/service";
import { config } from "../config";
import { logger } from "../utils/logger";

const MAX_PRODUCTION_CONNECTIONS_PER_IP = 10;
const WS_AUTH_ERROR = "WebSocket authentication required";
const WS_ORIGIN_ERROR = "WebSocket origin is not allowed";
const WS_THROTTLE_ERROR = "WebSocket connection limit exceeded";

export class WebSocketManager {
  private readonly activeConnectionsByIp = new Map<string, number>();

  constructor(private readonly io: SocketIOServer) {}

  initialize(): void {
    this.io.use((socket, next) => {
      void this.authorizeSocket(socket)
        .then(() => {
          this.trackSocketConnection(socket);
          next();
        })
        .catch((error: unknown) => {
          const rejection =
            error instanceof Error ? error : new Error(WS_AUTH_ERROR);
          logger.warn("WebSocket connection rejected", {
            reason: rejection.message,
            origin: readOrigin(socket),
            ip: readClientIp(socket),
          });
          next(rejection);
        });
    });

    this.io.on("connection", (socket) => {
      socket.emit("ready", { ok: true });
    });
  }

  private async authorizeSocket(socket: Socket): Promise<void> {
    if (!config.isProduction) {
      return;
    }

    const origin = readOrigin(socket);
    if (origin && !config.corsOrigins.includes(origin)) {
      throw new Error(WS_ORIGIN_ERROR);
    }

    const token = readHandshakeToken(socket);
    if (!token) {
      throw new Error(WS_AUTH_ERROR);
    }

    if (isOperationalToken(token)) {
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      if (await isAccessTokenRevoked(payload)) {
        throw new Error(WS_AUTH_ERROR);
      }
    } catch {
      throw new Error(WS_AUTH_ERROR);
    }
  }

  private trackSocketConnection(socket: Socket): void {
    if (!config.isProduction) {
      return;
    }

    const ip = readClientIp(socket);
    const activeConnections = this.activeConnectionsByIp.get(ip) ?? 0;
    if (activeConnections >= MAX_PRODUCTION_CONNECTIONS_PER_IP) {
      throw new Error(WS_THROTTLE_ERROR);
    }

    this.activeConnectionsByIp.set(ip, activeConnections + 1);
    socket.once("disconnect", () => {
      const currentConnections = this.activeConnectionsByIp.get(ip) ?? 0;
      if (currentConnections <= 1) {
        this.activeConnectionsByIp.delete(ip);
        return;
      }
      this.activeConnectionsByIp.set(ip, currentConnections - 1);
    });
  }
}

function readHandshakeToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const explicitToken = socket.handshake.headers["x-operational-token"];
  if (typeof explicitToken === "string" && explicitToken.trim()) {
    return explicitToken.trim();
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization !== "string") {
    return undefined;
  }

  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    return undefined;
  }

  return token;
}

function isOperationalToken(token: string): boolean {
  const expectedToken = config.operationalEndpointsToken;
  if (!expectedToken) {
    return false;
  }

  const providedBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function readOrigin(socket: Socket): string | undefined {
  const origin = socket.handshake.headers.origin;
  return typeof origin === "string" && origin.trim()
    ? origin.trim()
    : undefined;
}

function readClientIp(socket: Socket): string {
  return socket.handshake.address || socket.conn.remoteAddress || "unknown";
}
