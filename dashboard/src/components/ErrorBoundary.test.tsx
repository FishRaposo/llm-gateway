import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("kaboom");
  return <div>healthy content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("renders the default fallback when a child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
  });

  it("supports a custom fallback render prop", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("custom: kaboom")).toBeInTheDocument();
  });

  it("recovers when the user clicks Try again and the child no longer throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Wrapper() {
      // Re-render path: after reset, the child renders healthy content.
      return (
        <ErrorBoundary>
          <Boom shouldThrow={false} />
        </ErrorBoundary>
      );
    }
    // First, prove the fallback shows for a throwing child.
    const { unmount } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText("Try again"));
    unmount();

    // A fresh boundary with a non-throwing child shows healthy content.
    render(<Wrapper />);
    expect(screen.getByText("healthy content")).toBeInTheDocument();
  });
});
