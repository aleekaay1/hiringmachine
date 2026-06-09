import React from 'react';

/** @deprecated Routes use AdminShell for auth + layout. Kept as a no-op wrapper for gradual migration. */
type PipelineAuthShellProps = {
  title?: string;
  subtitle?: string;
  redirectPath?: string;
  children: React.ReactNode;
};

const PipelineAuthShell: React.FC<PipelineAuthShellProps> = ({ children }) => {
  return <>{children}</>;
};

export default PipelineAuthShell;
