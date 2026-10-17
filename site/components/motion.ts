"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(listener: () => void) {
  const query = matchMedia(REDUCED);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => matchMedia(REDUCED).matches, () => false);
}

/**
 * Marks `[data-reveal]` descendants with `data-in` as they scroll into view. Elements already on screen are marked
 * before `data-motion` switches the hidden state on, so nothing that was painted disappears.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element || matchMedia(REDUCED).matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-in", "");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    const seen = new WeakSet<Element>();
    const scan = () => element.querySelectorAll("[data-reveal]").forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      if (node.getBoundingClientRect().top < innerHeight) node.setAttribute("data-in", "");
      else observer.observe(node);
    });
    scan();
    element.setAttribute("data-motion", "");
    const mutations = new MutationObserver(scan);
    mutations.observe(element, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      element.removeAttribute("data-motion");
    };
  }, [root]);
}

export function useInView(ref: RefObject<Element | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function usePageVisible() {
  return useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => true);
}
