import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  StatusBadge,
  SectionHeader,
  CopyButton,
  Sparkline,
} from "@/components/PagePrimitives";

describe("StatusBadge", () => {
  it("capitalizes the status label", () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("pulses for an active status", () => {
    const { container } = render(<StatusBadge status="active" />);
    expect(container.innerHTML).toContain("animate-pulse");
  });

  it("does not pulse for a non-active status", () => {
    const { container } = render(<StatusBadge status="inactive" />);
    expect(container.innerHTML).not.toContain("animate-pulse");
  });

  it("falls back to slate styling for an unknown status", () => {
    const { container } = render(<StatusBadge status="mystery" />);
    expect(container.innerHTML).toContain("slate");
  });

  it("uses a custom style map when provided", () => {
    const styles = {
      special: { bg: "bg-pink-500", text: "text-pink-100", dot: "bg-pink-300" },
    };
    const { container } = render(
      <StatusBadge status="special" styles={styles} />,
    );
    expect(container.innerHTML).toContain("pink-500");
  });

  it.each(["active", "inactive", "jailed", "pending"])(
    "renders the %s status label",
    (status) => {
      render(<StatusBadge status={status} />);
      expect(
        screen.getByText(status.charAt(0).toUpperCase() + status.slice(1)),
      ).toBeInTheDocument();
    },
  );
});

describe("SectionHeader", () => {
  it("renders the title", () => {
    render(<SectionHeader title="Validators" />);
    expect(screen.getByText("Validators")).toBeInTheDocument();
  });

  it("renders the subtitle when provided", () => {
    render(<SectionHeader title="T" subtitle="A description" />);
    expect(screen.getByText("A description")).toBeInTheDocument();
  });

  it("omits the subtitle when not provided", () => {
    render(<SectionHeader title="T" />);
    expect(screen.queryByText("A description")).not.toBeInTheDocument();
  });

  it("renders an action node", () => {
    render(<SectionHeader title="T" action={<button>Do it</button>} />);
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });

  it.each([
    ["lg", "text-2xl", "mb-8"],
    ["sm", "text-xl", "mb-6"],
  ] as const)("uses %s sizing", (size, titleClass, marginClass) => {
    const { container } = render(<SectionHeader title="T" size={size} />);
    expect(container.innerHTML).toContain(titleClass);
    expect((container.firstChild as HTMLElement).className).toContain(
      marginClass,
    );
  });
});

describe("CopyButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a copy button with an accessible label", () => {
    render(<CopyButton text="hello" />);
    expect(
      screen.getByRole("button", { name: "Copy to clipboard" }),
    ).toBeInTheDocument();
  });

  it("copies the text and flips the label to Copied on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CopyButton text="0xdeadbeef" />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("0xdeadbeef");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("fires the onCopied callback", () => {
    const onCopied = vi.fn();
    render(<CopyButton text="x" onCopied={onCopied} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onCopied).toHaveBeenCalledOnce();
  });
});

describe("Sparkline", () => {
  it("renders an SVG for a data series", () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it.each([
    [40, 20],
    [80, 32],
    [120, 48],
  ])("respects width %d / height %d", (width, height) => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} width={width} height={height} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe(String(width));
    expect(svg.getAttribute("height")).toBe(String(height));
  });

  it("renders flat data without dividing by zero", () => {
    expect(() => render(<Sparkline data={[5, 5, 5]} />)).not.toThrow();
  });

  it("renders with the gradient option enabled", () => {
    expect(() =>
      render(<Sparkline data={[1, 3, 2, 5]} showGradient />),
    ).not.toThrow();
  });
});
