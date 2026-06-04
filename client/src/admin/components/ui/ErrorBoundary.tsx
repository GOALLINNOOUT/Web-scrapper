import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <div className="admin-card border-[var(--accent-critical)]"><strong>Panel error</strong><p className="text-sm text-[var(--admin-text-secondary)]">{this.state.error.message}</p><button className="admin-btn mt-3" type="button" onClick={() => this.setState({ error: null })}>Retry</button></div>;
    }
    return this.props.children;
  }
}
