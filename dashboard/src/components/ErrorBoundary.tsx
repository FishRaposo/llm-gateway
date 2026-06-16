"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Receives the caught error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the dashboard tree and shows a
 * recoverable fallback instead of a blank white screen. Without this, a single
 * malformed API payload could crash the whole console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console so it shows up in logs / dev tools.
    console.error("[Dashboard] render error:", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            background: "#060813",
            color: "#f87171",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Inter', system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "rgba(248, 113, 113, 0.05)",
              border: "1px solid rgba(248, 113, 113, 0.2)",
              borderRadius: 16,
              padding: 32,
              maxWidth: 520,
              width: "100%",
              textAlign: "center",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.6, marginBottom: 24 }}>
              The dashboard hit an unexpected error while rendering: {error.message}
            </p>
            <button
              onClick={this.reset}
              style={{
                background: "#06b6d4",
                color: "#fff",
                border: "none",
                padding: "10px 24px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 650,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
