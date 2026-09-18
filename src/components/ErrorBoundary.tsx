import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Keeps a rendering failure inside one panel. Without this, a single bad frame
 * in the viewer unmounts the whole page and leaves the reviewer staring at a
 * blank tab with their work seemingly gone.
 */
export class ErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Viewer render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel">
        <h2>{this.props.title}</h2>
        <p className="error" role="alert">
          Something went wrong while drawing this case. Your saved work is not
          affected, and unsaved brush strokes are still kept on the server.
        </p>
        <button onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </section>
    );
  }
}
