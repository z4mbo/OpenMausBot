"use client";

import { createElement, useEffect, useState, type ComponentType, type ReactNode } from "react";

/**
 * A component whose code loads on first use (or earlier through `preload`). Unlike `next/dynamic` it does not go
 * through Suspense, so a module that arrives quickly shows at once instead of after React's 300ms fallback throttle,
 * and a module that is already loaded renders on the first pass with no fallback at all.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null) {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  const preload = () => pending ??= load().then(component => (loaded = component), error => {
    pending = undefined;
    throw error;
  });
  function Lazy(props: P) {
    const [component, setComponent] = useState<{ value?: ComponentType<P>; error?: unknown }>(() => ({ value: loaded }));
    useEffect(() => {
      if (component.value) return;
      let alive = true;
      preload().then(value => { if (alive) setComponent({ value }); }, error => { if (alive) setComponent({ error }); });
      return () => { alive = false; };
    }, [component.value]);
    // A chunk that failed to load reaches the nearest error boundary, like a failed import would.
    if (component.error) throw component.error;
    return component.value ? createElement(component.value, props) : fallback;
  }
  return Object.assign(Lazy, { preload });
}
