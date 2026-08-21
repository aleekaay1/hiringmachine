-- Fix public check-in on clone: allow both anon and authenticated (staff session in same browser).
-- Paste in Supabase SQL Editor for ofhcnsuwrhyvxtvtdunw if needed.

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'candidates'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.candidates', pol.policyname);
  END LOOP;
END$$;

CREATE POLICY "candidates_anon_insert" ON public.candidates
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "candidates_anon_select" ON public.candidates
  FOR SELECT TO anon USING (true);
CREATE POLICY "candidates_anon_update" ON public.candidates
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "candidates_anon_delete" ON public.candidates
  FOR DELETE TO anon USING (true);

CREATE POLICY "candidates_authenticated_insert" ON public.candidates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "candidates_authenticated_select" ON public.candidates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "candidates_authenticated_update" ON public.candidates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "candidates_authenticated_delete" ON public.candidates
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
