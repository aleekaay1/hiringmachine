import React from 'react';
import { useOutletContext } from 'react-router-dom';
import LeadManagerAllLeadsTable from '../components/pipeline/LeadManagerAllLeadsTable';
import type { LeadManagerOutletContext } from './LeadManagerLayout';

const LeadManagerLeadsPage: React.FC = () => {
  const {
    candidates,
    batchGroups,
    latestByCandidate,
    callsByCandidate,
    tone,
    loading,
  } = useOutletContext<LeadManagerOutletContext>();

  return (
    <LeadManagerAllLeadsTable
      candidates={candidates}
      batchGroups={batchGroups}
      latestByCandidate={latestByCandidate}
      callsByCandidate={callsByCandidate}
      tone={tone}
      loading={loading}
      fullPage
    />
  );
};

export default LeadManagerLeadsPage;
