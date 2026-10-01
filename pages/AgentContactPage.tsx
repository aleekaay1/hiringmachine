import React from 'react';
import { useParams } from 'react-router-dom';
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

function Row({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#21c45a] text-xs text-white">
        {label || '•'}
      </span>
      <div className="min-w-0 flex-1 break-words text-sm text-slate-800">{children}</div>
    </div>
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
    <div className="min-h-screen overflow-x-hidden bg-[#f4f1ea]">
      <header className="bg-[#0a0a0a] px-4 py-3">
        <img src="/logo.png" alt="AO Globe Life" className="mx-auto h-10 w-auto max-w-[220px] object-contain" />
      </header>
      <div className="mx-auto w-full max-w-md px-4 py-6">
        {error && <p className="text-center text-sm text-red-700">{error}</p>}
        {!error && !card && <p className="text-center text-sm text-slate-500">Loading contact…</p>}
        {card && (
          <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <img
              src={card.logoUrl || '/logo.png'}
              alt="AO Globe Life"
              className="mb-3 h-16 w-auto max-w-full object-contain"
            />
            <h1 className="break-words text-xl font-bold leading-snug text-slate-900">{card.fullName}</h1>
            <p className="mt-1 break-words text-sm text-slate-600">{card.title}</p>
            <p className="mt-1 break-words text-sm text-slate-900">{card.teamLine}</p>
            <p className="break-words text-sm text-slate-600">{card.tagline}</p>
            <div className="my-4 border-t-2 border-[#21c45a]" />
            <div className="space-y-3">
              {card.officePhone && (
                <Row label="☎">
                  <a href={telHref(card.officePhone)} className="block">
                    {formatPhone(card.officePhone)}
                    {card.officeExt ? ` Ext. ${card.officeExt}` : ''}
                  </a>
                  <span className="block text-[11px] text-slate-500">Office</span>
                </Row>
              )}
              {card.directPhone && (
                <Row label="☎">
                  <a href={telHref(card.directPhone)} className="block">
                    {formatPhone(card.directPhone)}
                  </a>
                  <span className="block text-[11px] text-slate-500">Direct</span>
                </Row>
              )}
              <Row label="✉">
                <a href={`mailto:${card.email}`} className="break-all">
                  {card.email}
                </a>
              </Row>
              <Row label="⌂">
                <a href={card.websiteUrl} target="_blank" rel="noreferrer">
                  AO Globe Life Website
                </a>
              </Row>
              <Row label="📍">{card.address}</Row>
            </div>
            <div className="mt-5 border-t-2 border-[#21c45a] pt-4">
              <button
                type="button"
                onClick={saveContact}
                className="w-full rounded-full bg-[#21c45a] px-4 py-3 text-sm font-semibold text-white"
              >
                Save contact
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentContactPage;
