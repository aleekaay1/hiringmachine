import React from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { loadPublicAgentCard, type HiredPublicCard } from '../services/hiredAgentsService';

function telHref(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '#';
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)}${digits.slice(4, 7)}${digits.slice(7)}`;
  }
  if (digits.length === 10) return `+1 ${digits.slice(0, 3)}${digits.slice(3, 6)}${digits.slice(6)}`;
  return raw;
}

function GreenDot({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#21c45a] text-sm text-white">
      {children}
    </span>
  );
}

const AgentContactPage: React.FC = () => {
  const { slug = '' } = useParams();
  const [card, setCard] = React.useState<HiredPublicCard | null>(null);
  const [vcard, setVcard] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadPublicAgentCard(slug)
      .then((data) => {
        if (cancelled) return;
        setCard(data.card);
        setVcard(data.vcard);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Contact not found');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const saveContact = () => {
    if (!vcard || !card) return;
    const blob = new Blob([vcard], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.fullName.replace(/\s+/g, '-')}-AO.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout compactHeader>
      <div className="mx-auto w-full max-w-xl px-4 py-10">
        {error && <p className="text-center text-sm text-red-700">{error}</p>}
        {!error && !card && <p className="text-center text-sm text-slate-500">Loading contact…</p>}
        {card && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex gap-4">
              <img src={card.logoUrl || '/logo.png'} alt="AO Globe Life" className="h-20 w-auto object-contain" />
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{card.fullName}</h1>
                <p className="text-sm text-slate-600">{card.title}</p>
                <p className="mt-1 text-sm text-slate-900">{card.teamLine}</p>
                <p className="text-sm text-slate-600">{card.tagline}</p>
              </div>
            </div>
            <div className="my-4 border-t-2 border-[#21c45a]" />
            <div className="space-y-3 text-sm text-slate-800">
              {card.officePhone && (
                <div className="flex gap-6">
                  <a href={telHref(card.officePhone)} className="flex items-center gap-2">
                    <GreenDot>☎</GreenDot>
                    <span>
                      {formatPhone(card.officePhone)}
                      {card.officeExt ? ` Ext. ${card.officeExt}` : ''}
                      <span className="block text-[11px] text-slate-500">Office</span>
                    </span>
                  </a>
                  {card.directPhone && (
                    <a href={telHref(card.directPhone)} className="flex items-center gap-2">
                      <GreenDot>☎</GreenDot>
                      <span>
                        {formatPhone(card.directPhone)}
                        <span className="block text-[11px] text-slate-500">Direct</span>
                      </span>
                    </a>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-6">
                <a href={`mailto:${card.email}`} className="flex items-center gap-2">
                  <GreenDot>✉</GreenDot>
                  {card.email}
                </a>
                <a href={card.websiteUrl} className="flex items-center gap-2" target="_blank" rel="noreferrer">
                  <GreenDot>⌂</GreenDot>
                  AO Globe Life Website
                </a>
              </div>
              <div className="flex items-center gap-2">
                <GreenDot>📍</GreenDot>
                {card.address}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t-2 border-[#21c45a] pt-4">
              <p className="text-[11px] text-slate-500">AO Globe Life — Team Paz</p>
              <button
                type="button"
                onClick={saveContact}
                className="rounded-full bg-[#21c45a] px-4 py-2 text-sm font-semibold text-white"
              >
                Save contact
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AgentContactPage;
