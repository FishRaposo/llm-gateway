"use client";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { DashboardView } from "../components/DashboardView";

export default function DashboardPage() {
  return (
    <ErrorBoundary>
      <DashboardView />
    </ErrorBoundary>
  );
}
