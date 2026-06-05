import React from 'react';

export type LoadStage = {
  label: string;
  run: () => Promise<unknown>;
};

export type StagedLoadProgress = {
  pct: number;
  label: string;
  loading: boolean;
  error: string | null;
};

export function useStagedLoader(stages: LoadStage[]): StagedLoadProgress & { retry: () => void } {
  const [pct, setPct] = React.useState(0);
  const [label, setLabel] = React.useState(stages[0]?.label || 'Loading…');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [runId, setRunId] = React.useState(0);

  const retry = React.useCallback(() => setRunId((n) => n + 1), []);

  React.useEffect(() => {
    if (!stages.length) {
      setLoading(false);
      setPct(100);
      return;
    }
    let cancelled = false;
    const total = stages.length;

    const run = async () => {
      setLoading(true);
      setError(null);
      setPct(2);
      try {
        for (let i = 0; i < total; i += 1) {
          if (cancelled) return;
          const stage = stages[i];
          setLabel(stage.label);
          setPct(Math.round(((i + 0.15) / total) * 100));
          await stage.run();
          if (cancelled) return;
          setPct(Math.round(((i + 1) / total) * 100));
        }
        setPct(100);
        setLabel('Ready');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [stages, runId]);

  return { pct, label, loading, error, retry };
}
