import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { EmptyState } from "@/components/EmptyState";
import {
  SkeletonLine,
  SkeletonCard,
  SkeletonTable,
  SkeletonChart,
  SkeletonStats,
} from "@/components/Skeleton";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(<EmptyState title="T" description="No data yet" />);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
  });

  it("omits the description when not provided", () => {
    render(<EmptyState title="T" />);
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
  });

  it("renders a default icon when none supplied", () => {
    const { container } = render(<EmptyState title="T" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders a custom icon", () => {
    render(<EmptyState title="T" icon={<span data-testid="custom-icon" />} />);
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("renders an action button and fires its handler", () => {
    const onClick = vi.fn();
    render(<EmptyState title="T" action={{ label: "Retry", onClick }} />);
    const btn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("omits the action button when no action is given", () => {
    render(<EmptyState title="T" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies a custom className to the container", () => {
    const { container } = render(<EmptyState title="T" className="my-empty" />);
    expect(container.firstChild).toHaveClass("my-empty");
  });
});

describe("Skeleton family", () => {
  it("SkeletonLine renders with default sizing and skeleton class", () => {
    const { container } = render(<SkeletonLine />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("skeleton");
    expect(el.style.width).toBe("100%");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonLine honors custom width/height/className", () => {
    const { container } = render(
      <SkeletonLine width="50%" height="2rem" className="x" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("2rem");
    expect(el).toHaveClass("x");
  });

  it("SkeletonCard renders with a height style", () => {
    const { container } = render(<SkeletonCard height="20rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("skeleton");
    expect(el.style.height).toBe("20rem");
  });

  it.each([
    [3, 4],
    [5, 2],
    [1, 1],
  ])("SkeletonTable renders %d rows x %d columns", (rows, columns) => {
    const { container } = render(
      <SkeletonTable rows={rows} columns={columns} />,
    );
    // header row + N data rows are all flex containers
    const flexRows = container.querySelectorAll(".flex");
    expect(flexRows.length).toBe(rows + 1);
  });

  it("SkeletonTable uses default 5x4 when unspecified", () => {
    const { container } = render(<SkeletonTable />);
    expect(container.querySelectorAll(".flex").length).toBe(6);
  });

  it("SkeletonChart applies a numeric height", () => {
    const { container } = render(<SkeletonChart height={300} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.height).toBe("300px");
  });

  it.each([2, 4, 6])("SkeletonStats renders %d stat tiles", (count) => {
    const { container } = render(<SkeletonStats count={count} />);
    const tiles = container.querySelectorAll(".skeleton");
    expect(tiles.length).toBe(count);
  });

  it("SkeletonStats defaults to 4 tiles", () => {
    const { container } = render(<SkeletonStats />);
    expect(container.querySelectorAll(".skeleton").length).toBe(4);
  });
});
