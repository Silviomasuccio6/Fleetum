import { Component, type ReactNode } from "react";
import { Button } from "../ui/button";
import { getUiRecoveryCopy, reportUiRecovery, type UiRecoveryScope } from "./ui-recovery";

type Props = {
  children: ReactNode;
  scope: Exclude<UiRecoveryScope, "bootstrap">;
  resetKey?: string;
};

type State = {
  failed: boolean;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    reportUiRecovery(this.props.scope);
  }

  componentDidUpdate(previous: Props) {
    // Navigation recovers a failed route without remounting a healthy app.
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const copy = getUiRecoveryCopy(this.props.scope);
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10" role="alert">
        <section className="w-full max-w-md rounded-3xl border bg-card p-6 text-center shadow-xl" aria-labelledby={`fleetum-${this.props.scope}-error-title`}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{copy.eyebrow}</p>
          <h1 id={`fleetum-${this.props.scope}-error-title`} className="mt-3 text-2xl font-bold text-foreground">
            {copy.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.message}</p>
          <Button className="mt-5 w-full" type="button" onClick={() => window.location.reload()}>
            {copy.action}
          </Button>
        </section>
      </main>
    );
  }
}
