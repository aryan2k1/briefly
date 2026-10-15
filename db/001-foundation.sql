CREATE SCHEMA identity;
CREATE TABLE identity.organisations (
 id uuid PRIMARY KEY, name text NOT NULL, accent text NOT NULL CHECK(accent ~ '^#[0-9A-Fa-f]{6}$'),
 integration_mode text NOT NULL DEFAULT 'disabled' CHECK(integration_mode IN ('disabled','sandbox')),
 synthetic boolean NOT NULL DEFAULT false
);
CREATE TABLE identity.users (id uuid PRIMARY KEY, provider_subject text NOT NULL UNIQUE, name text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE identity.teams (
 org_id uuid NOT NULL REFERENCES identity.organisations(id), id uuid NOT NULL, name text NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE TABLE identity.memberships (
 org_id uuid NOT NULL, id uuid NOT NULL, user_id uuid NOT NULL REFERENCES identity.users(id),
 team_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('admin','editor','viewer')),
 title text NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(org_id,id), UNIQUE(org_id,user_id), UNIQUE(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id) REFERENCES identity.teams(org_id,id)
);
CREATE TABLE identity.sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), org_id uuid NOT NULL, membership_id uuid NOT NULL,
 csrf_token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,membership_id) REFERENCES identity.memberships(org_id,id)
);
CREATE INDEX sessions_expiry ON identity.sessions(expires_at);
CREATE FUNCTION public.current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('briefly.org',true),'')::uuid $$;
CREATE FUNCTION public.current_team() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('briefly.team',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('briefly.role',true)='admin',false) $$;
CREATE FUNCTION public.can_edit() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('briefly.role',true) IN ('admin','editor'),false) $$;

CREATE TABLE companies (
 org_id uuid NOT NULL REFERENCES identity.organisations(id), id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), sector text NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE TABLE rating_groups (
 org_id uuid NOT NULL REFERENCES identity.organisations(id), id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
 PRIMARY KEY(org_id,id), UNIQUE(org_id,code)
);
CREATE TABLE contacts (
 org_id uuid NOT NULL, id uuid NOT NULL, team_id uuid NOT NULL, owner_id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 email text NOT NULL CHECK(length(email)<=254), phone text NOT NULL CHECK(length(phone)<=50),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id), UNIQUE(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id,owner_id) REFERENCES identity.memberships(org_id,team_id,id)
);
CREATE TABLE employments (
 org_id uuid NOT NULL, id uuid NOT NULL, contact_id uuid NOT NULL, company_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200), started_on date NOT NULL, ended_on date,
 PRIMARY KEY(org_id,id), UNIQUE(org_id,contact_id,id),
 FOREIGN KEY(org_id,contact_id) REFERENCES contacts(org_id,id),
 FOREIGN KEY(org_id,company_id) REFERENCES companies(org_id,id),
 CHECK(ended_on IS NULL OR ended_on>=started_on)
);
CREATE UNIQUE INDEX one_current_employment ON employments(org_id,contact_id) WHERE ended_on IS NULL;
CREATE INDEX employment_company ON employments(org_id,company_id);
CREATE TABLE contact_rating_groups (
 org_id uuid NOT NULL, contact_id uuid NOT NULL, rating_group_id uuid NOT NULL,
 PRIMARY KEY(org_id,contact_id,rating_group_id),
 FOREIGN KEY(org_id,contact_id) REFERENCES contacts(org_id,id),
 FOREIGN KEY(org_id,rating_group_id) REFERENCES rating_groups(org_id,id)
);
CREATE TABLE meetings (
 org_id uuid NOT NULL, id uuid NOT NULL, team_id uuid NOT NULL, company_id uuid NOT NULL,
 title text NOT NULL, starts_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'Europe/London',
 PRIMARY KEY(org_id,id), UNIQUE(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id) REFERENCES identity.teams(org_id,id),
 FOREIGN KEY(org_id,company_id) REFERENCES companies(org_id,id)
);
CREATE TABLE meeting_contacts (
 org_id uuid NOT NULL, team_id uuid NOT NULL, meeting_id uuid NOT NULL, contact_id uuid NOT NULL, employment_id uuid NOT NULL,
 name_snapshot text NOT NULL, title_snapshot text NOT NULL, company_snapshot text NOT NULL,
 PRIMARY KEY(org_id,meeting_id,contact_id),
 FOREIGN KEY(org_id,team_id,meeting_id) REFERENCES meetings(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id,contact_id) REFERENCES contacts(org_id,team_id,id),
 FOREIGN KEY(org_id,contact_id,employment_id) REFERENCES employments(org_id,contact_id,id)
);
CREATE TABLE meeting_internal_participants (
 org_id uuid NOT NULL, team_id uuid NOT NULL, meeting_id uuid NOT NULL, membership_id uuid NOT NULL,
 name_snapshot text NOT NULL, title_snapshot text NOT NULL,
 PRIMARY KEY(org_id,meeting_id,membership_id),
 FOREIGN KEY(org_id,team_id,meeting_id) REFERENCES meetings(org_id,team_id,id),
 FOREIGN KEY(org_id,team_id,membership_id) REFERENCES identity.memberships(org_id,team_id,id)
);
CREATE TABLE audit_events (
 org_id uuid NOT NULL, id uuid NOT NULL, team_id uuid NOT NULL, actor_id uuid NOT NULL,
 entity_id uuid NOT NULL, action text NOT NULL, version integer NOT NULL, at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id), FOREIGN KEY(org_id,actor_id) REFERENCES identity.memberships(org_id,id),
 FOREIGN KEY(org_id,team_id) REFERENCES identity.teams(org_id,id)
);
CREATE INDEX contacts_name ON contacts(org_id,team_id,lower(name),id);
CREATE INDEX contacts_owner ON contacts(org_id,owner_id);
CREATE INDEX contacts_email ON contacts(org_id,lower(email));
CREATE INDEX meeting_contact_lookup ON meeting_contacts(org_id,contact_id,meeting_id);
CREATE INDEX meetings_company ON meetings(org_id,company_id,starts_at);
CREATE INDEX audit_entity ON audit_events(org_id,entity_id,at);

-- Runtime is never a table owner. Missing context denies all business rows.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['companies','rating_groups','contacts','employments','contact_rating_groups','meetings','meeting_contacts','meeting_internal_participants','audit_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['companies','rating_groups'] LOOP
  EXECUTE format('CREATE POLICY scoped_read ON %I FOR SELECT USING (org_id=current_org())',tab);
  EXECUTE format('CREATE POLICY scoped_insert ON %I FOR INSERT WITH CHECK (org_id=current_org() AND can_edit())',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['contacts','meetings','meeting_contacts','meeting_internal_participants','audit_events'] LOOP
  EXECUTE format('CREATE POLICY scoped_read ON %I FOR SELECT USING (org_id=current_org() AND (team_id=current_team() OR is_admin()))',tab);
  EXECUTE format('CREATE POLICY scoped_insert ON %I FOR INSERT WITH CHECK (org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit())',tab);
 END LOOP;
END $$;
CREATE POLICY scoped_update ON contacts FOR UPDATE
 USING(org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit())
 WITH CHECK(org_id=current_org() AND (team_id=current_team() OR is_admin()) AND can_edit());
CREATE POLICY employment_read ON employments FOR SELECT USING(org_id=current_org() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=employments.org_id AND c.id=contact_id));
CREATE POLICY employment_insert ON employments FOR INSERT WITH CHECK(org_id=current_org() AND can_edit() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=employments.org_id AND c.id=contact_id));
CREATE POLICY employment_update ON employments FOR UPDATE USING(org_id=current_org() AND can_edit() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=employments.org_id AND c.id=contact_id)) WITH CHECK(org_id=current_org() AND can_edit() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=employments.org_id AND c.id=contact_id));
CREATE POLICY groups_read ON contact_rating_groups FOR SELECT USING(org_id=current_org() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=contact_rating_groups.org_id AND c.id=contact_id));
CREATE POLICY groups_insert ON contact_rating_groups FOR INSERT WITH CHECK(org_id=current_org() AND can_edit() AND EXISTS(SELECT 1 FROM contacts c WHERE c.org_id=contact_rating_groups.org_id AND c.id=contact_id));

REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA identity,public TO briefly_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA identity TO briefly_runtime;
GRANT INSERT,UPDATE,DELETE ON identity.sessions TO briefly_runtime;
GRANT SELECT ON companies,rating_groups,contacts,employments,contact_rating_groups,meetings,meeting_contacts,meeting_internal_participants,audit_events TO briefly_runtime;
GRANT INSERT ON companies,rating_groups,contacts,employments,contact_rating_groups,meetings,meeting_contacts,meeting_internal_participants,audit_events TO briefly_runtime;
GRANT UPDATE ON contacts,employments TO briefly_runtime;
