import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Lead packs', route: '/pipeline/lead-manager' },
  { label: 'Search all leads', route: '/pipeline/lead-manager/leads' },
] as const;

const LeadManagerTabs: React.FC = () => {
  const { pathname } = useLocation();
  const onLeads = pathname.startsWith('/pipeline/lead-manager/leads');

  return (
    <nav
      className="flex w-full gap-2 rounded-2xl border border-[#c8ddf4] bg-[#f0f6ff] p-2"
      aria-label="Lead manager sections"
    >
      {TABS.map((tab) => {
        const active = tab.route === '/pipeline/lead-manager/leads' ? onLeads : !onLeads;
        return (
          <Link
            key={tab.route}
            to={tab.route}
            className={`flex-1 rounded-xl px-4 py-3 text-center text-sm font-semibold transition sm:flex-none sm:min-w-[180px] ${
              active
                ? 'bg-white text-[#005EB8] shadow-sm ring-1 ring-[#9bc8f6]'
                : 'text-[#4b6d95] hover:bg-white/70 hover:text-[#285082]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default LeadManagerTabs;
