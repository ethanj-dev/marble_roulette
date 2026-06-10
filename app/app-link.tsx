import type { AnchorHTMLAttributes, ReactNode } from "react";
import { toAppHref } from "./static-spa";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
};

export default function AppLink({
  children,
  href,
  ...props
}: AppLinkProps) {
  return (
    <a href={toAppHref(href)} {...props}>
      {children}
    </a>
  );
}
