import React from 'react';

/** Lightweight shell shown while lazy admin routes load. */
const AdminRouteFallback: React.FC = () => (
  <div className="flex min-h-[40vh] flex-1 items-center justify-center p-8">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#005EB8] border-t-transparent" />
      <p className="text-xs font-medium text-[#5c7594]">Loading page…</p>
    </div>
  </div>
);

export default AdminRouteFallback;
