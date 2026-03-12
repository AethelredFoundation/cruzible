from __future__ import annotations

import argparse
import json
from pathlib import Path

from cruzible_sdk.reconciliation import (
    fetch_reconciliation_input,
    is_http_url,
    load_reconciliation_input,
    reconcile_epoch_document,
    render_markdown_report,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a Cruzible reconciliation report from a JSON document or a live API endpoint."
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--input", help="Path to a reconciliation JSON document")
    source_group.add_argument("--url", help="Direct URL to a reconciliation JSON document")
    source_group.add_argument(
        "--api-base",
        help="Cruzible API base URL; fetches /v1/reconciliation/live from this server",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="HTTP timeout in seconds when fetching a live document",
    )
    parser.add_argument("--json-out", help="Optional path to write the JSON report")
    parser.add_argument("--md-out", help="Optional path to write the Markdown report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.input:
        document = load_reconciliation_input(args.input)
    else:
        source_url = args.url or _live_url_from_api_base(args.api_base)
        document = fetch_reconciliation_input(source_url, timeout=args.timeout)

    report = reconcile_epoch_document(document)
    markdown = render_markdown_report(report)

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n")
    if args.md_out:
        Path(args.md_out).write_text(markdown)

    print(json.dumps(report, indent=2))
    print()
    print(markdown)
    return 0 if report["summary"]["ok"] else 1


def _live_url_from_api_base(api_base: str | None) -> str:
    if not api_base:
        raise ValueError("api_base is required when --url is not provided")

    normalized = api_base.rstrip("/")
    if is_http_url(normalized) and normalized.endswith("/v1/reconciliation/live"):
        return normalized
    return f"{normalized}/v1/reconciliation/live"


if __name__ == "__main__":
    raise SystemExit(main())
