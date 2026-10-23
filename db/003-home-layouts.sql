-- Additive: per-member Home layout preference. No existing table or row is changed.
CREATE FUNCTION public.current_member() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('briefly.member',true),'')::uuid $$;

CREATE TABLE home_layouts (
 org_id uuid NOT NULL, team_id uuid NOT NULL, membership_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 blocks jsonb NOT NULL CHECK(jsonb_typeof(blocks)='array' AND jsonb_array_length(blocks)=4),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,membership_id),
 FOREIGN KEY(org_id,team_id,membership_id) REFERENCES identity.memberships(org_id,team_id,id)
);
ALTER TABLE home_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_layouts FORCE ROW LEVEL SECURITY;
-- A member can only see and change their own row, in their own organisation and team.
-- Viewers may personalise their own view: it is a display preference, not shared business data.
CREATE POLICY own_read ON home_layouts FOR SELECT
 USING(org_id=current_org() AND team_id=current_team() AND membership_id=current_member());
CREATE POLICY own_insert ON home_layouts FOR INSERT
 WITH CHECK(org_id=current_org() AND team_id=current_team() AND membership_id=current_member());
CREATE POLICY own_update ON home_layouts FOR UPDATE
 USING(org_id=current_org() AND team_id=current_team() AND membership_id=current_member())
 WITH CHECK(org_id=current_org() AND team_id=current_team() AND membership_id=current_member());
GRANT SELECT,INSERT,UPDATE ON home_layouts TO briefly_runtime;
