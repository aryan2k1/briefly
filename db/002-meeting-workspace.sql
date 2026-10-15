-- Additive upgrade: existing meetings and participant snapshots are retained.
ALTER TABLE meetings
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
 ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','outlook-demo')),
 ADD COLUMN external_key text,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX meetings_external_key ON meetings(org_id,team_id,external_key) WHERE external_key IS NOT NULL;
CREATE INDEX meetings_calendar ON meetings(org_id,team_id,starts_at,id);
CREATE POLICY scoped_update ON meetings FOR UPDATE
 USING(org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit())
 WITH CHECK(org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit());
GRANT UPDATE ON meetings TO briefly_runtime;

CREATE TABLE meeting_notes (
 org_id uuid NOT NULL, team_id uuid NOT NULL, meeting_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), body text NOT NULL CHECK(length(body)<=8000),
 author_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,meeting_id,version),
 FOREIGN KEY(org_id,team_id,meeting_id) REFERENCES meetings(org_id,team_id,id),
 FOREIGN KEY(org_id,author_id) REFERENCES identity.memberships(org_id,id)
);
CREATE TABLE meeting_tags (
 org_id uuid NOT NULL, team_id uuid NOT NULL, meeting_id uuid NOT NULL,
 tag text NOT NULL CHECK(length(trim(tag)) BETWEEN 1 AND 30),
 PRIMARY KEY(org_id,meeting_id,tag),
 FOREIGN KEY(org_id,team_id,meeting_id) REFERENCES meetings(org_id,team_id,id)
);
CREATE TABLE meeting_actions (
 org_id uuid NOT NULL, team_id uuid NOT NULL, meeting_id uuid NOT NULL, id uuid NOT NULL,
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 owner_id uuid NOT NULL, due_on date NOT NULL, status text NOT NULL CHECK(status IN ('open','done')),
 PRIMARY KEY(org_id,meeting_id,id),
 FOREIGN KEY(org_id,team_id,meeting_id) REFERENCES meetings(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id,owner_id) REFERENCES identity.memberships(org_id,team_id,id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['meeting_notes','meeting_tags','meeting_actions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY scoped_read ON %I FOR SELECT USING (org_id=current_org() AND (team_id=current_team() OR is_admin()))',tab);
  EXECUTE format('CREATE POLICY scoped_insert ON %I FOR INSERT WITH CHECK (org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit())',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['meeting_tags','meeting_actions'] LOOP
  EXECUTE format('CREATE POLICY scoped_delete ON %I FOR DELETE USING (org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit())',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON meeting_notes,meeting_tags,meeting_actions TO briefly_runtime;
GRANT DELETE ON meeting_tags,meeting_actions TO briefly_runtime;
