-- Branches allowed per plan (NULL = unlimited), and a per-company override set by the super admin.

ALTER TABLE price_tiers ADD COLUMN max_branches integer CHECK (max_branches IS NULL OR max_branches >= 1);
-- 1-5 and 6-10 staff: 1 branch; 11-15 and 16-25: 2; 26-50 and 51-100: 10; bigger plans: unlimited.
UPDATE price_tiers SET max_branches = CASE WHEN max_staff <= 10 THEN 1 WHEN max_staff <= 25 THEN 2 WHEN max_staff <= 100 THEN 10 ELSE NULL END;

-- branch_limit_custom = false: the plan decides. true: branch_limit decides (NULL = unlimited).
ALTER TABLE companies ADD COLUMN branch_limit_custom boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN branch_limit integer CHECK (branch_limit IS NULL OR branch_limit >= 0);
