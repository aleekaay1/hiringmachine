import { wrapTransactionalEmailHtml } from './emailHtmlShell.ts';

export type WeeklyLeaderboardEmailRow = {
  rank: number;
  displayName: string;
  score: number;
  calls: number;
  webinarBooked: number;
  webinarShowed: number;
  liveSessionBooked: number;
  liveSessionShowed: number;
  showRatio: number;
  rankDelta: number;
  periodCoins: number;
  coinBalance: number;
  badges: string[];
};

export type WeeklyLeaderboardEmailInput = {
  windowLabel: string;
  periodKey: string;
  fetchedAt: string | null;
  rows: WeeklyLeaderboardEmailRow[];
  topPerformerName: string | null;
  fastClimberName: string | null;
  consistentCloserName: string | null;
  previousTopPerformerName: string | null;
  appUrl?: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function movementLabel(delta: number): string {
  if (delta > 0) return `▲ +${delta}`;
  if (delta < 0) return `▼ ${delta}`;
  return '—';
}

function movementColor(delta: number): string {
  if (delta > 0) return '#047857';
  if (delta < 0) return '#b91c1c';
  return '#64748b';
}

function rankBadge(rank: number): { bg: string; fg: string; label: string } {
  if (rank === 1) return { bg: '#ffecc5', fg: '#7e5400', label: '#1' };
  if (rank === 2) return { bg: '#eef2f7', fg: '#475569', label: '#2' };
  if (rank === 3) return { bg: '#fde8d8', fg: '#9a3412', label: '#3' };
  return { bg: '#f8fafc', fg: '#334155', label: `#${rank}` };
}

function highlightCard(title: string, name: string | null, detail: string, accent: string): string {
  if (!name) {
    return `<td width="33%" style="padding:6px;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;">
        <tr><td style="padding:14px;font-family:Arial,Helvetica,sans-serif;">
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;">${esc(title)}</p>
          <p style="margin:0;font-size:13px;color:#94a3b8;">No winner this period</p>
        </td></tr>
      </table>
    </td>`;
  }
  return `<td width="33%" style="padding:6px;vertical-align:top;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${accent};border-radius:12px;background:#ffffff;">
      <tr><td style="padding:14px;font-family:Arial,Helvetica,sans-serif;">
        <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${accent};font-weight:bold;">${esc(title)}</p>
        <p style="margin:0 0 4px;font-size:17px;font-weight:bold;color:#0B1B34;">${esc(name)}</p>
        <p style="margin:0;font-size:12px;line-height:1.45;color:#5c7594;">${esc(detail)}</p>
      </td></tr>
    </table>
  </td>`;
}

export function buildWeeklyLeaderboardEmailHtml(input: WeeklyLeaderboardEmailInput): string {
  const sorted = [...input.rows].sort((a, b) => a.rank - b.rank);
  const top = sorted[0] ?? null;
  const totalShows = sorted.reduce((sum, r) => sum + r.webinarShowed + r.liveSessionShowed, 0);
  const totalBooked = sorted.reduce((sum, r) => sum + r.webinarBooked + r.liveSessionBooked, 0);
  const totalPeriodCoins = sorted.reduce((sum, r) => sum + r.periodCoins, 0);
  const generated = input.fetchedAt
    ? new Date(input.fetchedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
  const appUrl = (input.appUrl || 'https://paz-talent-journey.vercel.app').replace(/\/$/, '');

  const heroName = input.topPerformerName || top?.displayName || '—';
  const heroScore = top ? top.score.toFixed(1) : '—';
  const heroShows = top ? top.webinarShowed + top.liveSessionShowed : 0;
  const heroCoins = top?.periodCoins ?? 0;

  const tableRows = sorted
    .map((row) => {
      const badge = rankBadge(row.rank);
      return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;">
          <span style="display:inline-block;min-width:28px;text-align:center;padding:4px 8px;border-radius:8px;background:${badge.bg};color:${badge.fg};font-size:12px;font-weight:bold;">${badge.label}</span>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#0B1B34;">${esc(row.displayName)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#0B1B34;text-align:center;font-weight:bold;">${row.score.toFixed(1)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#334155;text-align:center;">${row.calls}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#334155;text-align:center;">${row.webinarBooked} / ${row.webinarShowed}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#334155;text-align:center;">${row.liveSessionBooked} / ${row.liveSessionShowed}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#334155;text-align:center;">${pct(row.showRatio)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;text-align:center;font-weight:bold;color:${movementColor(row.rankDelta)};">${movementLabel(row.rankDelta)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#005EB8;text-align:center;font-weight:bold;">+${row.periodCoins}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#0B1B34;text-align:center;">${row.coinBalance}</td>
      </tr>`;
    })
    .join('');

  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
  <tr>
    <td style="background:linear-gradient(135deg,#005EB8 0%,#0B1B34 100%);border-radius:14px;padding:22px 20px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#9ec5ea;">Paz Organization · Globe Life AIL</p>
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#ffffff;">Weekly recruiting leaderboard</h1>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#d7e9ff;">${esc(input.windowLabel)}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#b8d4f5;">Rankings refreshed ${esc(generated)} (Toronto)</p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
  <tr>
    <td style="padding:16px 18px;border:1px solid #f0ce8f;border-radius:14px;background:#fff8ea;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9b6b00;font-weight:bold;">Week winner</p>
      <p style="margin:0 0 6px;font-size:22px;font-weight:bold;color:#0B1B34;">${esc(heroName)}</p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:#6d5a39;">
        Score <strong>${heroScore}</strong> · ${heroShows} combined shows · <strong>+${heroCoins} Paz Coins</strong> earned this period
        ${input.previousTopPerformerName ? ` · previous #1: ${esc(input.previousTopPerformerName)}` : ''}
      </p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
  <tr>
    ${highlightCard('Top performer', input.topPerformerName, 'Highest overall score', '#c58a00')}
    ${highlightCard('Fast climber', input.fastClimberName, 'Biggest rank jump vs prior period', '#dc2626')}
    ${highlightCard('Consistent closer', input.consistentCloserName, 'Strong show rate + steady bookings', '#059669')}
  </tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
  <tr>
    <td width="25%" style="padding:6px;">
      <table width="100%" style="border:1px solid #d6e6f9;border-radius:10px;background:#f8fbff;"><tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#005EB8;">${sorted.length}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#5c7594;">Callers ranked</p>
      </td></tr></table>
    </td>
    <td width="25%" style="padding:6px;">
      <table width="100%" style="border:1px solid #d6e6f9;border-radius:10px;background:#f8fbff;"><tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#005EB8;">${totalBooked}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#5c7594;">Sessions booked</p>
      </td></tr></table>
    </td>
    <td width="25%" style="padding:6px;">
      <table width="100%" style="border:1px solid #d6e6f9;border-radius:10px;background:#f8fbff;"><tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#047857;">${totalShows}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#5c7594;">Combined shows</p>
      </td></tr></table>
    </td>
    <td width="25%" style="padding:6px;">
      <table width="100%" style="border:1px solid #d6e6f9;border-radius:10px;background:#f8fbff;"><tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#005EB8;">${totalPeriodCoins}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#5c7594;">Paz Coins (period)</p>
      </td></tr></table>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dbe7f5;border-radius:12px;overflow:hidden;margin-bottom:18px;">
  <tr style="background:#f1f7ff;">
    <th align="left" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Rank</th>
    <th align="left" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Caller</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Score</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Calls</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Webinar B/S</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Live B/S</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Show %</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Move</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Coins +</th>
    <th style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#4e79a9;">Balance</th>
  </tr>
  ${tableRows || `<tr><td colspan="10" style="padding:18px;font-family:Arial,Helvetica,sans-serif;color:#64748b;text-align:center;">No rankings for this period.</td></tr>`}
</table>

<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#5c7594;">
  Webinar B/S = booked / showed · Live B/S = live session booked / showed · Coins + = Paz Coins earned in this period · Balance = current wallet total.
</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;">
  <a href="${esc(`${appUrl}/#/calls-analytics/leaderboard`)}" style="color:#005EB8;font-weight:bold;text-decoration:none;">Open live leaderboard →</a>
</p>`;

  return wrapTransactionalEmailHtml(body);
}

export function buildWeeklyLeaderboardEmailSubject(windowLabel: string): string {
  return `Weekly Leaderboard — ${windowLabel}`;
}
