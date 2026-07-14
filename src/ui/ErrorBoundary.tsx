import { Component, type ReactNode } from "react";

interface Props {
  /** Names the section in the fallback message. */
  label?: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches a render error in its subtree and shows the message instead of blanking
 *  the whole page. Used around the admin test bench so a game crash stays contained
 *  and surfaces what went wrong. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Keep the detail in the console for debugging; the UI shows the message.
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="errbound" role="alert">
          <div className="errbound-ttl">⚠ {this.props.label ?? "This section"} hit an error</div>
          <pre className="errbound-msg">{this.state.error.message}</pre>
          <button className="linkbtn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
