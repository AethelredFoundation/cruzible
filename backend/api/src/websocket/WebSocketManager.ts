import { createHash, timingSafeEqual } from "crypto";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { isAccessTokenRevoked, verifyAccessToken } from "../auth/service";
import { config } from "../config";
import { recordPrivilegedAuditEvent } from "../middleware/privilegedAudit";
import { logger } from "../utils/logger";

const MAX_PRODUCTION_CONNECTIONS_PER_IP = 10;
const WS_HANDSHAKE_PATH = "/socket.io";
const WS_AUTH_ERROR = "WebSocket authentication required";
const WS_ORIGIN_ERROR = "WebSocket origin is not allowed";
const WS_THROTTLE_ERROR = "WebSocket connection limit exceeded";

interface WebSocketAuditContext {
  principalType: "wallet" | "operational-token";
  actorAddress?: string;
  tokenRoles?: readonly string[];
  currentRoles?: readonly string[];
}

export class WebSocketManager {
  private readonly activeConnectionsByIp = new Map<string, number>();

  constructor(private readonly io: SocketIOServer) {}

  initialize(): void {
    this.io.use((socket, next) => {
      void this.authorizeSocket(socket)
        .then((auditContext) => {
          this.trackSocketConnection(socket);
          if (auditContext) {
            recordWebSocketAudit(socket, {
              ...auditContext,
              decision: "allowed",
              outcome: "succeeded",
              statusCode: 101,
            });
          }
          next();
        })
        .catch((error: unknown) => {
          const rejection =
            error instanceof Error ? error : new Error(WS_AUTH_ERROR);
          logger.warn("WebSocket connection rejected", {
            reason: rejection.message,
            origin: readOriginForLogs(socket),
            ipHash: hashLogValue(readClientIp(socket)),
          });
          recordRejectedWebSocketAudit(socket, rejection.message);
          next(rejection);
        });
    });

    this.io.on("connection", (socket) => {
      socket.emit("ready", { ok: true });
    });
  }

  private async authorizeSocket(
    socket: Socket,
  ): Promise<WebSocketAuditContext | undefined> {
    if (!config.isProduction) {
      return undefined;
    }

    const origin = readOrigin(socket);
    if (!origin || !config.corsOrigins.includes(origin)) {
      throw new Error(WS_ORIGIN_ERROR);
    }

    const token = readHandshakeToken(socket);
    if (!token) {
      throw new Error(WS_AUTH_ERROR);
    }

    if (isOperationalToken(token)) {
      return { principalType: "operational-token" };
    }

    try {
      const payload = verifyAccessToken(token);
      if (await isAccessTokenRevoked(payload)) {
        throw new Error(WS_AUTH_ERROR);
      }
      return {
        principalType: "wallet",
        actorAddress: payload.address,
        tokenRoles: payload.roles,
        currentRoles: payload.roles,
      };
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

function recordRejectedWebSocketAudit(socket: Socket, reason: string): void {
  if (!config.isProduction) {
    return;
  }

  recordWebSocketAudit(socket, {
    principalType: inferPrincipalType(socket),
    decision: "rejected",
    reason,
    outcome: "rejected",
    statusCode: reason === WS_THROTTLE_ERROR ? 429 : 401,
  });
}

function recordWebSocketAudit(
  socket: Socket,
  audit: WebSocketAuditContext & {
    decision: "allowed" | "rejected";
    reason?: string;
    outcome: "succeeded" | "rejected";
    statusCode: number;
  },
): void {
  recordPrivilegedAuditEvent({
    requestId: readRequestId(socket),
    method: "WEBSOCKET",
    path: WS_HANDSHAKE_PATH,
    principalType: audit.principalType,
    actorAddress: audit.actorAddress,
    tokenRoles: audit.tokenRoles,
    currentRoles: audit.currentRoles,
    decision: audit.decision,
    reason: audit.reason,
    outcome: audit.outcome,
    statusCode: audit.statusCode,
    ip: readClientIp(socket),
    userAgent: readUserAgent(socket),
  });
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

function inferPrincipalType(socket: Socket): "wallet" | "operational-token" {
  const explicitToken = socket.handshake.headers["x-operational-token"];
  if (typeof explicitToken === "string" && explicitToken.trim()) {
    return "operational-token";
  }

  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && isOperationalToken(authToken.trim())) {
    return "operational-token";
  }

  return "wallet";
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

function hashLogValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readOrigin(socket: Socket): string | undefined {
  const origin = socket.handshake.headers.origin;
  return typeof origin === "string" && origin.trim()
    ? origin.trim()
    : undefined;
}

function readOriginForLogs(socket: Socket): string {
  const origin = readOrigin(socket);
  if (!origin) {
    return "missing";
  }

  try {
    return new URL(origin).origin;
  } catch {
    return "[invalid-origin]";
  }
}

function readClientIp(socket: Socket): string {
  return socket.handshake.address || socket.conn.remoteAddress || "unknown";
}

function readRequestId(socket: Socket): string {
  const requestId = socket.handshake.headers["x-request-id"];
  return typeof requestId === "string" && requestId.trim()
    ? requestId.trim()
    : "unknown";
}

function readUserAgent(socket: Socket): string {
  const userAgent = socket.handshake.headers["user-agent"];
  return typeof userAgent === "string" && userAgent.trim()
    ? userAgent.trim()
    : "unknown";
}
