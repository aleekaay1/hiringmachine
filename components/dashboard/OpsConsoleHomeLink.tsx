import React from 'react';
import { supabase } from '../../services/supabaseClient';
import { isOpsConsoleEmail } from '../../services/accessControl';
import { QuickLinkCard } from './DashboardWidgets';

/**
 * Ops console home link — visible only when the signed-in auth email is ali@globelife-paz.com.
 * Never uses user_profiles.email (can be stale or missing).
 */
const OpsConsoleHomeLink: React.FC = () => {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setVisible(isOpsConsoleEmail(data.user?.email));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <QuickLinkCard
      title="Ops console"
      description="Private monitoring & tickets."
      to="/ops-console"
      accent="border-[#0B1B34]/20 bg-[#0B1B34] text-white hover:opacity-95"
    />
  );
};

export default OpsConsoleHomeLink;
