import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  title?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface3 p-6">
          <div className="max-w-lg border border-border bg-surface2 p-6">
            <h1 className="text-lg font-semibold text-textPrimary">
              {this.props.title ?? 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-textSecondary">
              This page hit an unexpected error. The rest of the app should still work after you go
              back home or reload.
            </p>
            <p className="mt-4 rounded-lg bg-surface2 px-3 py-2 font-mono text-xs text-danger">
              {this.state.error.message}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
                onClick={() => window.location.assign('/')}
              >
                Go to dashboard
              </button>
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
