"use client";

import { Children, useEffect, useState, type ReactNode } from "react";

/**
 * Multi-slide hero controls only. The slides themselves are Server
 * Components passed as children, so the largest image is not part of
 * this client module.
 * https://nextjs.org/docs/app/getting-started/server-and-client-components
 */
export function HeroRotator({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const slides = Children.toArray(children);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [slides.length]);

  return (
    <div className="relative">
      {slides.map((slide, slideIndex) => (
        <div
          key={slideIndex}
          className={slideIndex === index ? "block" : "hidden"}
          aria-hidden={slideIndex !== index}
        >
          {slide}
        </div>
      ))}
    </div>
  );
}
