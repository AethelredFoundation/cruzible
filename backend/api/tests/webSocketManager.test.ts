import type { Server as SocketIOServer, Socket } from "socket.io";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATIONAL_TOKEN = "12345678901234567890123456789012";

vi.mock("../src/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("WebSocketManager", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function buildManager(options: {
    isProduction: boolean;
    corsOrigins?: string[];
    operationalEndpointsToken?: string;
    verifyAccessToken?: () => unknown;
    isAccessTokenRevoked?: () => unknown;
  }) {
    const verifyAccessToken = vi.fn(
      options.verifyAccessToken ??
        (() => ({ address: "aeth1user", iat: 1_777_928_000, roles: ["user"] })),
    );
    const isAccessTokenRevoked = vi.fn(
      options.isAccessTokenRevoked ?? (async () => false),
    );
    vi.doMock("../src/auth/service", () => ({
      isAccessTokenRevoked,
      verifyAccessToken,
    }));

    const { config } = await import("../src/config");
    (config as any).isProduction = options.isProduction;
    (config as any).corsOrigins = options.corsOrigins ?? [
      "https://app.example",
    ];
    (config as any).operationalEndpointsToken =
      options.operationalEndpointsToken;

    const { WebSocketManager } =
      await import("../src/websocket/WebSocketManager");
    const io = new FakeSocketServer();
    const manager = new WebSocketManager(io as unknown as SocketIOServer);
    manager.initialize();

    return { io, isAccessTokenRevoked, verifyAccessToken };
  }

  it("allows local sockets without production credentials", async () => {
    const { io } = await buildManager({ isProduction: false });
    const socket = createSocket();

    const rejection = await io.authorize(socket);
    io.connect(socket);

    expect(rejection).toBeUndefined();
    expect(socket.emit).toHaveBeenCalledWith("ready", { ok: true });
  });

  it("rejects production sockets without a valid token", async () => {
    const { io } = await buildManager({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });

    const rejection = await io.authorize(
      createSocket({ origin: "https://app.example" }),
    );

    expect(rejection?.message).toBe("WebSocket authentication required");

    const { flushPendingPrivilegedAuditTasks, getMemoryPrivilegedAuditEvents } =
      await import("../src/middleware/privilegedAudit");
    await flushPendingPrivilegedAuditTasks();

    expect(getMemoryPrivilegedAuditEvents()).toContainEqual(
      expect.objectContaining({
        method: "WEBSOCKET",
        path: "/socket.io",
        principalType: "wallet",
        decision: "rejected",
        reason: "WebSocket authentication required",
        outcome: "rejected",
        statusCode: 401,
      }),
    );
  });

  it("rejects production sockets without an origin", async () => {
    const { io } = await buildManager({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
      corsOrigins: ["https://app.example"],
    });

    const rejection = await io.authorize(
      createSocket({ authorization: "Bearer valid-access-token" }),
    );

    expect(rejection?.message).toBe("WebSocket origin is not allowed");
  });

  it("rejects production sockets from disallowed origins", async () => {
    const { io } = await buildManager({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
      corsOrigins: ["https://app.example"],
    });

    const rejection = await io.authorize(
      createSocket({
        origin: "https://evil.example",
        authorization: "Bearer valid-access-token",
      }),
    );

    expect(rejection?.message).toBe("WebSocket origin is not allowed");
  });

  it("accepts production access and operational tokens", async () => {
    const { io, isAccessTokenRevoked, verifyAccessToken } = await buildManager({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });

    const accessTokenRejection = await io.authorize(
      createSocket({
        authorization: "Bearer valid-access-token",
        origin: "https://app.example",
      }),
    );
    const operationalTokenRejection = await io.authorize(
      createSocket({
        operationalToken: OPERATIONAL_TOKEN,
        origin: "https://app.example",
      }),
    );

    expect(accessTokenRejection).toBeUndefined();
    expect(operationalTokenRejection).toBeUndefined();
    expect(verifyAccessToken).toHaveBeenCalledWith("valid-access-token");
    expect(isAccessTokenRevoked).toHaveBeenCalledWith({
      address: "aeth1user",
      iat: 1_777_928_000,
      roles: ["user"],
    });

    const { flushPendingPrivilegedAuditTasks, getMemoryPrivilegedAuditEvents } =
      await import("../src/middleware/privilegedAudit");
    await flushPendingPrivilegedAuditTasks();
    const events = getMemoryPrivilegedAuditEvents();

    expect(events).toContainEqual(
      expect.objectContaining({
        method: "WEBSOCKET",
        path: "/socket.io",
        principalType: "wallet",
        actorAddress: "aeth1user",
        tokenRoles: ["user"],
        currentRoles: ["user"],
        decision: "allowed",
        outcome: "succeeded",
        statusCode: 101,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        method: "WEBSOCKET",
        path: "/socket.io",
        principalType: "operational-token",
        actorAddress: null,
        decision: "allowed",
        outcome: "succeeded",
        statusCode: 101,
      }),
    );
  });

  it("rejects revoked production access tokens", async () => {
    const { io } = await buildManager({
      isProduction: true,
      isAccessTokenRevoked: async () => true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });

    const rejection = await io.authorize(
      createSocket({
        authorization: "Bearer revoked-access-token",
        origin: "https://app.example",
      }),
    );

    expect(rejection?.message).toBe("WebSocket authentication required");
  });

  it("limits active production sockets per IP and frees capacity on disconnect", async () => {
    const { io } = await buildManager({
      isProduction: true,
      operationalEndpointsToken: OPERATIONAL_TOKEN,
    });
    const activeSockets = Array.from({ length: 10 }, () =>
      createSocket({
        authorization: "Bearer valid-access-token",
        origin: "https://app.example",
        ip: "203.0.113.10",
      }),
    );

    for (const socket of activeSockets) {
      await expect(io.authorize(socket)).resolves.toBeUndefined();
    }

    const rejected = await io.authorize(
      createSocket({
        authorization: "Bearer valid-access-token",
        origin: "https://app.example",
        ip: "203.0.113.10",
      }),
    );
    activeSockets[0].disconnect();
    const acceptedAfterDisconnect = await io.authorize(
      createSocket({
        authorization: "Bearer valid-access-token",
        origin: "https://app.example",
        ip: "203.0.113.10",
      }),
    );

    expect(rejected?.message).toBe("WebSocket connection limit exceeded");
    expect(acceptedAfterDisconnect).toBeUndefined();
  });
});

class FakeSocketServer {
  private middleware:
    | ((socket: Socket, next: (err?: Error) => void) => void)
    | null = null;
  private connectionHandler: ((socket: Socket) => void) | null = null;

  use(handler: (socket: Socket, next: (err?: Error) => void) => void): this {
    this.middleware = handler;
    return this;
  }

  on(event: "connection", handler: (socket: Socket) => void): this {
    this.connectionHandler = handler;
    return this;
  }

  authorize(socket: TestSocket): Promise<Error | undefined> {
    return new Promise((resolve) => {
      this.middleware?.(socket as unknown as Socket, (error?: Error) => {
        resolve(error);
      });
    });
  }

  connect(socket: TestSocket): void {
    this.connectionHandler?.(socket as unknown as Socket);
  }
}

interface TestSocket {
  handshake: {
    auth: Record<string, unknown>;
    headers: Record<string, string | undefined>;
    address: string;
  };
  conn: { remoteAddress: string };
  data: Record<string, unknown>;
  emit: ReturnType<typeof vi.fn>;
  once: (event: "disconnect", handler: () => void) => void;
  disconnect: () => void;
}

function createSocket(
  options: {
    authorization?: string;
    operationalToken?: string;
    origin?: string;
    ip?: string;
  } = {},
): TestSocket {
  let disconnectHandler: (() => void) | null = null;
  const ip = options.ip ?? "127.0.0.1";

  return {
    handshake: {
      auth: {},
      headers: {
        authorization: options.authorization,
        origin: options.origin,
        "x-operational-token": options.operationalToken,
      },
      address: ip,
    },
    conn: { remoteAddress: ip },
    data: {},
    emit: vi.fn(),
    once: (_event, handler) => {
      disconnectHandler = handler;
    },
    disconnect: () => {
      disconnectHandler?.();
    },
  };
}
