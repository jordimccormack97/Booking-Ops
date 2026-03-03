import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("UI crash:", error, info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <main style={{ fontFamily: "sans-serif", padding: 24 }}>
          <h1>UI Error</h1>
          <p>The app crashed while rendering. Use this message to debug:</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.message}</pre>
        </main>
      );
    }

    return this.props.children;
  }
}

