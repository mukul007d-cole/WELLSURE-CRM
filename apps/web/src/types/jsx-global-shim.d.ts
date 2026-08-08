/**
 * React 19's types dropped the global `JSX` namespace in favour of
 * `React.JSX`. @dnd-kit/core's shipped declarations still reference the global
 * one, so its .d.ts files fail to resolve under React 19 without this alias.
 *
 * Remove once @dnd-kit publishes React 19-compatible types.
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementClass = ReactJSX.ElementClass;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

export {};
