import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock SWR so we control the data/error each test sees without real network.
const swrMock = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => swrMock(key),
}));

import { DashboardView } from "./DashboardView";
import { DEMO_LOGS } from "../lib/dashboard-data";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardView", () => {
  it("shows the loading state before any data or error arrives", () => {
    swrMock.mockReturnValue({ data: undefined, error: undefined });
    render(<DashboardView />);
    expect(screen.getByText(/Synchronizing with Gateway telemetry/)).toBeInTheDocument();
  });

  describe("demo mode (backend unreachable)", () => {
    beforeEach(() => {
      // The logs feed errors out -> page falls back to demo mode.
      swrMock.mockImplementation((key: string) =>
        key.includes("/admin/logs")
          ? { data: undefined, error: new Error("HTTP 503") }
          : { data: undefined, error: undefined }
      );
    });

    it("renders a visible demo banner", () => {
      render(<DashboardView />);
      expect(screen.getByTestId("demo-banner")).toBeInTheDocument();
      expect(screen.getByText(/DEMO MODE/)).toBeInTheDocument();
    });

    it("shows the DEMO status pill instead of LIVE TAIL", () => {
      render(<DashboardView />);
      expect(screen.getByText("DEMO")).toBeInTheDocument();
      expect(screen.queryByText("LIVE TAIL")).not.toBeInTheDocument();
    });

    it("populates the audit table with demo log rows", () => {
      render(<DashboardView />);
      // gpt-4o appears in demo logs.
      expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
      // The header should not show the empty-buffer message.
      expect(screen.queryByText("No logs currently in buffer")).not.toBeInTheDocument();
    });

    it("renders demo budget pools", () => {
      render(<DashboardView />);
      expect(screen.getByText("Research Team")).toBeInTheDocument();
      expect(screen.getByText("Production")).toBeInTheDocument();
    });

    it("renders provider health adapters from demo data", () => {
      render(<DashboardView />);
      // "Core Adapter Status" is the health section; GEMINI only appears there
      // (demo logs contain a gemini row too, so OPENAI/ANTHROPIC are ambiguous).
      expect(screen.getByText("Core Adapter Status")).toBeInTheDocument();
      // OPENAI/ANTHROPIC/GEMINI appear as provider pills and/or health cards.
      expect(screen.getAllByText("OPENAI").length).toBeGreaterThan(0);
      expect(screen.getAllByText("GEMINI").length).toBeGreaterThan(0);
    });

    it("computes a non-zero violations count from demo data", () => {
      render(<DashboardView />);
      // Demo data has 2 blocked entries; the violations card shows that count.
      const blocked = DEMO_LOGS.filter(
        (l) => l.status === "policy_denied" || l.status === "budget_exceeded"
      ).length;
      expect(screen.getByText("Total Violations")).toBeInTheDocument();
      expect(screen.getByText(String(blocked))).toBeInTheDocument();
    });
  });

  describe("live mode (backend reachable)", () => {
    it("renders live data without the demo banner", () => {
      swrMock.mockImplementation((key: string) => {
        if (key.includes("/admin/logs")) {
          return {
            data: {
              logs: [
                {
                  id: "live-1",
                  timestamp: "t",
                  model: "live-model",
                  provider: "openai",
                  costUsd: 0.05,
                  latencyMs: 123,
                  status: "success",
                  fallbackUsed: false,
                },
              ],
            },
            error: undefined,
          };
        }
        return { data: undefined, error: undefined };
      });
      render(<DashboardView />);
      expect(screen.queryByTestId("demo-banner")).not.toBeInTheDocument();
      expect(screen.getByText("LIVE TAIL")).toBeInTheDocument();
      expect(screen.getByText("live-model")).toBeInTheDocument();
    });

    it("shows the empty-buffer message when live logs are empty", () => {
      swrMock.mockImplementation((key: string) =>
        key.includes("/admin/logs") ? { data: { logs: [] }, error: undefined } : { data: undefined, error: undefined }
      );
      render(<DashboardView />);
      expect(screen.getByText("No logs currently in buffer")).toBeInTheDocument();
    });
  });
});
