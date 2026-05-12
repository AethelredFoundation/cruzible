# syntax=docker/dockerfile:1

FROM rust:1.85-bookworm@sha256:e51d0265072d2d9d5d320f6a44dde6b9ef13653b035098febd68cce8fa7c0bc4 AS builder

WORKDIR /workspace

RUN rustup target add wasm32-unknown-unknown

COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY scripts ./scripts

RUN cargo build --workspace --release --target wasm32-unknown-unknown --locked

RUN bash scripts/prepare-audit-artifacts.sh /artifacts/contracts

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS artifacts

RUN addgroup -g 1001 -S contracts \
    && adduser -S contracts -u 1001 -G contracts

WORKDIR /artifacts/contracts

COPY --from=builder --chown=contracts:contracts /artifacts/contracts/ ./

USER contracts

CMD ["cat", "SHA256SUMS"]
