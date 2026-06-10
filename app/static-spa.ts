declare global {
  interface Window {
    __PINBALL_STATIC_SPA__?: boolean;
  }
}

export function isStaticSpa() {
  return (
    typeof window !== "undefined" &&
    window.__PINBALL_STATIC_SPA__ === true
  );
}

export function toAppHref(href: string) {
  if (!isStaticSpa() || !href.startsWith("/")) {
    return href;
  }

  return `#${href}`;
}

export {};
