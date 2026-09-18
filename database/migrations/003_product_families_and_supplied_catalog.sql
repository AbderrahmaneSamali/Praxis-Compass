UPDATE praxis.content_records
SET attributes = jsonb_set(
  attributes,
  '{productFamily}',
  to_jsonb(CASE slug
    WHEN 'data-storytelling-sprint' THEN 'Sprint'
    WHEN 'operational-risk-clinic' THEN 'Sprint'
    ELSE 'Professional'
  END),
  true
)
WHERE slug IN (
  'project-delivery-lab',
  'data-storytelling-sprint',
  'operational-risk-clinic',
  'quality-traceability-studio',
  'site-coordinator-pathway',
  'insight-lead-pathway'
);

INSERT INTO praxis.content_records
  (record_type, slug, title, status, summary, attributes, published_at)
SELECT
  record_type,
  slug,
  title,
  'published',
  promise,
  jsonb_build_object(
    'sector', sector,
    'productFamily', product_family,
    'description', promise || ' This provisional record comes from the supplied PRAXIS catalog package and remains editable in the back office.',
    'format', format,
    'duration', duration,
    'level', level,
    'price', price,
    'nextSession', next_session,
    'language', 'EN / FR',
    'skills', to_jsonb(skills),
    'validator', 'Editorial review pending',
    'relation', relation,
    'initials', initials,
    'imageUrl', image_url,
    'tone', tone,
    'provisional', true
  ),
  now()
FROM (VALUES
  ('course', 'sprint-artificial-intelligence', 'Artificial Intelligence', 'Sprint', 'Digital & Data', 'Build a practical AI workflow in one focused intensive.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '12 Sep 2026', ARRAY['Frame an AI use case','Test a workflow','Evaluate output quality'], 'Focused skill intensive', 'AI', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=82', 'orange'),
  ('course', 'sprint-power-bi', 'Power BI', 'Sprint', 'Digital & Data', 'Turn a raw dataset into a decision-ready dashboard.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '15 Sep 2026', ARRAY['Prepare data','Build a dashboard','Explain one decision'], 'Focused skill intensive', 'PB', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=82', 'orange'),
  ('course', 'sprint-data-analytics', 'Data Analytics', 'Sprint', 'Digital & Data', 'Move from a business question to a concise evidence-backed answer.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '18 Sep 2026', ARRAY['Frame a question','Analyze a dataset','Communicate a finding'], 'Focused skill intensive', 'DA', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=82', 'orange'),
  ('course', 'sprint-management', 'Management', 'Sprint', 'Management', 'Practice a clear management routine for priorities, feedback, and follow-through.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '21 Sep 2026', ARRAY['Set priorities','Give feedback','Run a review'], 'Focused skill intensive', 'MA', 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&q=82', 'orange'),
  ('course', 'sprint-finance', 'Finance', 'Sprint', 'Finance', 'Read the essential signals in a financial snapshot and act on them.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '24 Sep 2026', ARRAY['Read key statements','Assess a variance','Present an action'], 'Focused skill intensive', 'FI', 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=82', 'orange'),
  ('course', 'sprint-human-resources', 'Human Resources', 'Sprint', 'People & Organizations', 'Structure one fair, useful people process from need to decision.', '10-hour intensive', '10 hours', 'L2 · Application', '1,200 MAD', '27 Sep 2026', ARRAY['Clarify a people need','Structure evidence','Document a decision'], 'Focused skill intensive', 'HR', 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=82', 'orange'),
  ('pathway', 'professional-ai-business', 'Artificial Intelligence for Business', 'Professional', 'Digital & Data', 'Apply AI to a business process with mentoring and an evidence-based work sample.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Select a use case','Design a workflow','Manage AI risk'], 'Mentored professional progression', 'AI', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=82', 'blue'),
  ('pathway', 'professional-power-bi-expert', 'Power BI Expert', 'Professional', 'Digital & Data', 'Build governed analytical products that teams can trust and reuse.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Model data','Design metrics','Govern a dashboard'], 'Mentored professional progression', 'PB', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=82', 'blue'),
  ('pathway', 'professional-advanced-data-analytics', 'Advanced Data Analytics', 'Professional', 'Digital & Data', 'Connect analytical methods, business framing, and stakeholder action.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Choose a method','Validate findings','Influence a decision'], 'Mentored professional progression', 'AD', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=82', 'blue'),
  ('pathway', 'professional-digital-transformation', 'Digital Transformation', 'Professional', 'Digital & Data', 'Lead a practical transformation sequence from diagnosis to adoption.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Diagnose a process','Prioritize change','Plan adoption'], 'Mentored professional progression', 'DT', 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=82', 'blue'),
  ('pathway', 'professional-project-management', 'Project Management', 'Professional', 'Management', 'Coordinate scope, risk, evidence, and stakeholder decisions.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Plan delivery','Manage risk','Lead reviews'], 'Mentored professional progression', 'PM', 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=82', 'blue'),
  ('pathway', 'professional-financial-analysis', 'Financial Analysis', 'Professional', 'Finance', 'Turn financial information into a clear operational recommendation.', 'Mentored pathway', 'Flexible pathway', 'L2 · Application', 'Price on request', 'Schedule pending', ARRAY['Analyze performance','Test assumptions','Present a recommendation'], 'Mentored professional progression', 'FA', 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&q=82', 'blue'),
  ('course', 'academic-mathematics', 'Mathematics', 'Academic', 'Academic Foundations', 'Strengthen core mathematical reasoning through guided practice and feedback.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Reason quantitatively','Solve structured problems','Check an argument'], 'Academic support progression', 'MA', 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=1200&q=82', 'navy'),
  ('course', 'academic-programming', 'Programming', 'Academic', 'Academic Foundations', 'Build programming foundations through exercises, correction, and applied mini-projects.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Read code','Write a program','Debug systematically'], 'Academic support progression', 'PR', 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&q=82', 'navy'),
  ('course', 'academic-artificial-intelligence', 'Artificial Intelligence', 'Academic', 'Academic Foundations', 'Understand AI foundations and apply them in a supervised academic lab.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Explain core concepts','Prepare data','Evaluate a model'], 'Academic support progression', 'AI', 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=82', 'navy'),
  ('course', 'academic-data-science', 'Data Science', 'Academic', 'Academic Foundations', 'Connect statistics, programming, and evidence in an academic project.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Explore data','Build an analysis','Report limitations'], 'Academic support progression', 'DS', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=82', 'navy'),
  ('course', 'academic-research-methodology', 'Research Methodology', 'Academic', 'Academic Foundations', 'Move from a research question to a defensible method and clear academic plan.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Frame a question','Review sources','Design a method'], 'Academic support progression', 'RM', 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=1200&q=82', 'navy'),
  ('course', 'academic-database-systems', 'Database Systems', 'Academic', 'Academic Foundations', 'Learn relational foundations through design exercises and practical queries.', 'Guided academic course', 'Flexible course', 'Academic level · adaptable', 'Price on request', 'Flexible start', ARRAY['Model data','Write queries','Check data integrity'], 'Academic support progression', 'DB', 'https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=1200&q=82', 'navy')
) AS catalog(
  record_type, slug, title, product_family, sector, promise, format, duration,
  level, price, next_session, skills, relation, initials, image_url, tone
)
ON CONFLICT (record_type, slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  attributes = EXCLUDED.attributes,
  status = 'published',
  published_at = COALESCE(praxis.content_records.published_at, EXCLUDED.published_at);
