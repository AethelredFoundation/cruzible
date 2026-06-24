import openApiPaths from "./openapi-paths.json";

export const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Cruzible API",
    version: process.env.npm_package_version || "1.0.0",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  paths: openApiPaths,
};
