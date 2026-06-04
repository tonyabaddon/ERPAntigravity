-- kasir_counters: persistent per-channel per-day invoice sequence
CREATE TABLE IF NOT EXISTS public.kasir_counters (
  channel TEXT NOT NULL,
  date    DATE NOT NULL,
  counter INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, date)
);

ALTER TABLE public.kasir_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_kasir_counters" ON public.kasir_counters
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_kasir_counters" ON public.kasir_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Atomically increment and return the counter for a channel+date.
-- First call for a new channel+date inserts counter=1; subsequent calls increment.
CREATE OR REPLACE FUNCTION public.next_kasir_number(p_channel text, p_date date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_counter int;
BEGIN
  INSERT INTO public.kasir_counters (channel, date, counter)
  VALUES (p_channel, p_date, 1)
  ON CONFLICT (channel, date)
  DO UPDATE SET counter = kasir_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$$;
