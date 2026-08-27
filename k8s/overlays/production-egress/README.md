# Production Egress Overlay

This overlay keeps the base fail-closed network posture while allowing the
minimum external destinations needed by the backend runtime.

Replace the checked-in documentation CIDRs before using this overlay in a real
environment:

- `192.0.2.10/32`: PostgreSQL endpoint.
- `192.0.2.20/32`: Redis endpoint.
- `198.51.100.0/24`: Aethelred RPC, EVM JSON-RPC, and WebSocket RPC endpoints.
- `203.0.113.10/32`: alert webhook endpoint.

Do not widen these rules to `0.0.0.0/0` or `::/0`. If a managed dependency
uses changing addresses, enforce that allowlist at the cloud firewall, private
link, egress gateway, or CNI layer and keep this overlay aligned with those
stable egress points.
