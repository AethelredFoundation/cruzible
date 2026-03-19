/**
 * MSW Server Setup for Node.js (Testing)
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
