import React from 'react';
import { Link } from 'react-router-dom';

type NavMenuLinkProps = {
  to: string;
  active?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
  onNavigate?: () => void;
  children: React.ReactNode;
};

/** Sidebar / menu links must be real anchors so right-click → open in new tab works. */
const NavMenuLink: React.FC<NavMenuLinkProps> = ({
  to,
  active = false,
  className = '',
  title,
  'aria-label': ariaLabel,
  onNavigate,
  children,
}) => (
  <Link
    to={to}
    title={title}
    aria-label={ariaLabel}
    aria-current={active ? 'page' : undefined}
    onClick={onNavigate}
    className={className}
  >
    {children}
  </Link>
);

export default NavMenuLink;
