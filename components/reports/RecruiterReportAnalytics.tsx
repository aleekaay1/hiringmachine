import React from 'react';
import {
  DailyCallVolumeChart,
  DispositionBreakdownChart,
  HourlyPickupChart,
  PackInsightCard,
  SourcePerformanceChart,
} from '../pipeline/RecruiterPackCharts';
import type { RecruiterCallAnalytics } from '../../services/recruiterCallAnalytics';

const tone = {
  panelTitle: 'text-[#0B1B34]',
  panelMuted: 'text-[#6b84a8]',
  panelLabel: 'text-[#4b6d95]',
};

type RecruiterReportAnalyticsProps = {
  analytics: RecruiterCallAnalytics;
  rangeLabel: string;
};

const RecruiterReportAnalytics: React.FC<RecruiterReportAnalyticsProps> = ({ analytics, rangeLabel }) => {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#d9e5f6] bg-white/90 p-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#2f6ea8]">Call insights</p>
        <p className="mt-1 text-xs text-[#5c7594]">{rangeLabel}</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <PackInsightCard
            title="Total dials"
            body={`${analytics.totalCalls} calls logged`}
            tone={tone}
          />
          <PackInsightCard
            title="Pickups"
            body={`${analytics.totalPickups} conversations (${analytics.totalCalls ? Math.round((analytics.totalPickups / analytics.totalCalls) * 100) : 0}% rate)`}
            tone={tone}
            accent="emerald"
          />
          <PackInsightCard
            title="Best pickup hour"
            body={analytics.bestHourLabel || 'Dial more between 10 AM – 5 PM ET to find a peak.'}
            tone={tone}
            accent="sky"
          />
          <PackInsightCard
            title="Best booking hour"
            body={analytics.bestBookingHourLabel || 'Bookings by hour appear as this caller closes deals.'}
            tone={tone}
            accent="amber"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Daily volume</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">Calls vs pickups per day</p>
          <div className="mt-3">
            <DailyCallVolumeChart bars={analytics.dailyBars} tone={tone} />
          </div>
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Pickup times (10 AM – 5 PM ET)</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">Peak hours when this caller reaches people</p>
          <div className="mt-3">
            <HourlyPickupChart bars={analytics.hourlyBars} tone={tone} />
          </div>
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Booking times</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">When booked dispositions happen</p>
          <div className="mt-3">
            <HourlyPickupChart
              bars={analytics.hourlyBookedBars}
              tone={tone}
              highlightBest={false}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Dispositions</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">Outcome mix for this caller</p>
          <div className="mt-3">
            <DispositionBreakdownChart
              counts={analytics.dispositionCounts}
              worked={analytics.workedCount}
              tone={tone}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Lead packs (HR uploads)</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">Which assigned packs respond for this caller</p>
          <div className="mt-3">
            <SourcePerformanceChart
              bars={analytics.leadPackBars}
              tone={tone}
              emptyLabel="No lead-pack dials in this range."
            />
          </div>
        </section>

        <section className="rounded-2xl border border-[#d9e5f6] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#0B1B34]">Webinar file tags</h3>
          <p className="mt-0.5 text-[11px] text-[#6b84a8]">Bookings attributed to each inviter file</p>
          <div className="mt-3">
            <SourcePerformanceChart
              bars={analytics.webinarFileBars}
              tone={tone}
              emptyLabel="No webinar bookings in this range."
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default RecruiterReportAnalytics;
