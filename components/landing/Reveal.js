"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fades its children up the first time they scroll into view, then stops
 * watching. Reduced motion is handled in CSS (.reveal renders at rest), so this
 * never has to know about it.
 */
export function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...props }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ "--reveal-delay": `${delay}ms` }}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Section eyebrow + heading + lede, shared by every section. */
export function SectionHeading({ eyebrow, title, lede, id, dark = false, align = "center" }) {
  const center = align === "center";
  return (
    <Reveal className={`${center ? "mx-auto text-center" : ""} max-w-2xl`}>
      <p
        className={`font-code text-xs font-medium uppercase tracking-[0.16em] ${
          dark ? "text-brand-300" : "text-brand-650"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        id={id}
        className={`mt-3 text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl ${
          dark ? "text-white" : "text-ink-900"
        }`}
      >
        {title}
      </h2>
      {lede && (
        <p className={`mt-4 text-pretty text-base leading-relaxed sm:text-lg ${dark ? "text-ink-300" : "text-ink-600"}`}>
          {lede}
        </p>
      )}
    </Reveal>
  );
}
