"use client";
import { Component, type ReactNode } from "react";

/**
 * Catches render errors (including Convex queries that throw, e.g. a deleted issue or revoked access)
 * so one broken view shows a fallback instead of taking down the whole workspace.
 * Changing `resetKey` clears the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey?: string }, { error: boolean; key?: string }> {
  state: { error: boolean; key?: string } = { error: false, key: this.props.resetKey };
  static getDerivedStateFromError() { return { error: true }; }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: boolean; key?: string }) {
    return props.resetKey !== state.key ? { error: false, key: props.resetKey } : null;
  }
  render() { return this.state.error ? this.props.fallback : this.props.children; }
}
