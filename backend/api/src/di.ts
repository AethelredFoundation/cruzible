import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { container } from "tsyringe";

/**
 * Container bootstrap. Must be imported before any module that resolves from
 * the container at module scope (the v1 route modules do).
 *
 * PrismaClient is an external, non-@injectable class whose generated
 * constructor cannot be auto-constructed by tsyringe (minified class name,
 * non-zero arity), so it must be registered explicitly. Registering a single
 * shared instance also guarantees one connection pool per process instead of
 * a new client per resolution. PrismaClient connects lazily on first query,
 * so constructing it here is side-effect-free for tests, which can override
 * this registration with their own instance.
 */
container.registerInstance(PrismaClient, new PrismaClient());
