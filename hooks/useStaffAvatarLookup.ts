import React from 'react';
import { listAllUserProfiles } from '../services/accessControl';
import {
  buildStaffAvatarLookup,
  emptyStaffAvatarLookup,
  type StaffAvatarLookup,
} from '../services/staffAvatarLookup';

/** Cached staff avatar URLs keyed by user id and display name. Refreshes on profile photo save. */
export function useStaffAvatarLookup(): StaffAvatarLookup {
  const [lookup, setLookup] = React.useState<StaffAvatarLookup>(() => emptyStaffAvatarLookup());

  React.useEffect(() => {
    let cancelled = false;

    const load = async (force = false) => {
      try {
        const profiles = await listAllUserProfiles(force);
        if (!cancelled) setLookup(buildStaffAvatarLookup(profiles));
      } catch {
        if (!cancelled) setLookup(emptyStaffAvatarLookup());
      }
    };

    void load();
    const onProfileUpdated = () => {
      void load(true);
    };
    window.addEventListener('pohiring:profile-updated', onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('pohiring:profile-updated', onProfileUpdated);
    };
  }, []);

  return lookup;
}
