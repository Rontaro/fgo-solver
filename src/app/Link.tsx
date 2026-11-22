import type { MouseEvent, ReactNode } from 'react';
import { navigate } from './router';

/** An in-app link: a real <a href> (open in new tab works) that navigates with pushState on a plain click. */
export function Link({ to, className, children, ...rest }: {
  to: string; className?: string; children: ReactNode; 'aria-current'?: 'page';
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} className={className} {...rest}>{children}</a>;
}
