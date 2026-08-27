# syntax=docker/dockerfile:1

FROM cosmwasm/optimizer:0.17.0@sha256:7e0b9229c1a4118d0c9a2af2e7f5d95a91f264c26a2ce5681c779926e74d7f85 AS builder

WORKDIR /code

RUN apk add --no-cache bash git coreutils

COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY scripts ./scripts

RUN optimize.sh .

RUN ARTIFACT_BUILDER_KIND=cosmwasm_optimizer \
    ARTIFACT_BUILDER_IMAGE=cosmwasm/optimizer:0.17.0@sha256:7e0b9229c1a4118d0c9a2af2e7f5d95a91f264c26a2ce5681c779926e74d7f85 \
    ARTIFACT_BUILDER_PLATFORM=linux/amd64 \
    TARGET_DIR=artifacts \
    bash scripts/prepare-audit-artifacts.sh /artifacts/contracts

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS artifacts

RUN addgroup -g 1001 -S contracts \
    && adduser -S contracts -u 1001 -G contracts

WORKDIR /artifacts/contracts

COPY --from=builder --chown=contracts:contracts /artifacts/contracts/ ./

USER contracts

CMD ["cat", "SHA256SUMS"]
