-- Add new enum values for feedback type
ALTER TYPE public.feedback_type ADD VALUE IF NOT EXISTS 'issue';
ALTER TYPE public.feedback_type ADD VALUE IF NOT EXISTS 'error';
