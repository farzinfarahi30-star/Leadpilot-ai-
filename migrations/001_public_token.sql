ALTER TABLE onboarding ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_public_token ON onboarding(public_token);
