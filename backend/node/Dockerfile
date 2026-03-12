# Aethelred Node Dockerfile
# Multi-stage build for production

# ============ BUILDER ============
FROM rust:1.75-slim-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    libclang-dev \
    cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy Cargo files first for better caching
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

# Create dummy main.rs to cache dependencies
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Copy actual source code
COPY src ./src

# Build the application
RUN cargo build --release --bin aethelred-node

# ============ RUNTIME ============
FROM debian:bookworm-slim AS production

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r aethelred && useradd -r -g aethelred aethelred

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/target/release/aethelred-node /usr/local/bin/

# Copy scripts
COPY scripts/* /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

# Create data directory
RUN mkdir -p /data && chown -R aethelred:aethelred /data

# Switch to non-root user
USER aethelred

# Expose ports
# 26656 - P2P
# 26657 - RPC
# 1317 - REST API
# 9090 - gRPC
# 9091 - gRPC Web
# 6060 - pprof
EXPOSE 26656 26657 1317 9090 9091 6060

# Volume for data persistence
VOLUME ["/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:26657/health || exit 1

# Environment variables
ENV AETHELRED_HOME=/data
ENV AETHELRED_LOG_LEVEL=info
ENV AETHELRED_MONIKER=aethelred-node

# Start the node
ENTRYPOINT ["aethelred-node"]
CMD ["start"]
