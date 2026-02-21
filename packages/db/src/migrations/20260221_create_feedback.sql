BEGIN;

-- Create enum for feedback type in the public schema
DO $$ BEGIN
  CREATE TYPE public.feedback_type AS ENUM ('bug','suggestion','general');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create feedback table explicitly in the public schema
CREATE TABLE IF NOT EXISTS public.feedback (
  id text PRIMARY KEY,
  type public.feedback_type NOT NULL,
  email text,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMIT;
