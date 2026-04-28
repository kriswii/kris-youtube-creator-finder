PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  lookback_days INTEGER NOT NULL DEFAULT 30,
  subscriber_min INTEGER NOT NULL DEFAULT 3000,
  subscriber_max INTEGER NOT NULL DEFAULT 50000,
  max_candidates INTEGER NOT NULL DEFAULT 200,
  shortlist_size INTEGER NOT NULL DEFAULT 50,
  minimum_pre_score REAL NOT NULL DEFAULT 55,
  channel_country TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'completed', 'failed', 'cancelled')),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'created',
      'search',
      'enrichment',
      'pre_score',
      'shortlist',
      'contacts',
      'comet',
      'minimax',
      'export',
      'done',
      'failed'
    )
  ),
  config_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  raw_search_rank INTEGER,
  search_page INTEGER,
  search_source TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  subscribers INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  channel_title TEXT,
  channel_description TEXT,
  channel_avatar_url TEXT,
  channel_country TEXT,
  days_since_publish INTEGER,
  engagement_rate REAL,
  comment_rate REAL,
  view_sub_ratio REAL,
  relative_velocity REAL,
  sub_fit_score REAL,
  view_sub_score REAL,
  engagement_score REAL,
  comment_score REAL,
  relative_velocity_score REAL,
  pre_score REAL,
  pre_score_breakdown_json TEXT,
  opportunity_tier TEXT CHECK (opportunity_tier IS NULL OR opportunity_tier IN ('A', 'B', 'C', 'D')),
  public_email TEXT,
  social_links_json TEXT,
  website_url TEXT,
  contactability_score REAL,
  contact_status TEXT CHECK (contact_status IS NULL OR contact_status IN ('pending', 'found', 'gated', 'not_found', 'failed')),
  raw_comet_output TEXT,
  comet_video_summary TEXT,
  comet_comments_summary TEXT,
  minimax_content_type TEXT,
  minimax_content_fit_score REAL,
  minimax_audience_fit_score REAL,
  minimax_brand_safety_score REAL,
  minimax_commercial_intent_score REAL,
  minimax_reason TEXT,
  minimax_status TEXT CHECK (minimax_status IS NULL OR minimax_status IN ('pending', 'completed', 'failed')),
  minimax_error TEXT,
  final_score REAL,
  final_score_breakdown_json TEXT,
  outreach_priority TEXT CHECK (outreach_priority IS NULL OR outreach_priority IN ('P1', 'P2', 'P3', 'P4')),
  status TEXT NOT NULL CHECK (
    status IN (
      'candidate',
      'enriched',
      'pre_scored',
      'shortlisted',
      'contacted',
      'summarized',
      'analyzed',
      'exported',
      'rejected',
      'failed'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, video_id),
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comet_summaries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('automated', 'manual')),
  prompt TEXT NOT NULL,
  raw_output TEXT,
  video_summary TEXT,
  comments_summary TEXT,
  audience TEXT,
  sentiment TEXT,
  brand_fit TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('pending', 'parsed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(result_id) REFERENCES results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx')),
  file_path TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quota_usage_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  usage_date TEXT NOT NULL,
  action_type TEXT NOT NULL,
  units INTEGER NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_results_job_id ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_job_pre_score ON results(job_id, pre_score DESC);
CREATE INDEX IF NOT EXISTS idx_results_job_final_score ON results(job_id, final_score DESC);
CREATE INDEX IF NOT EXISTS idx_results_job_subscribers ON results(job_id, subscribers);
CREATE INDEX IF NOT EXISTS idx_results_job_published_at ON results(job_id, published_at);
CREATE INDEX IF NOT EXISTS idx_comet_summaries_result_id ON comet_summaries(result_id);
CREATE INDEX IF NOT EXISTS idx_exports_job_id ON exports(job_id);
CREATE INDEX IF NOT EXISTS idx_quota_usage_logs_date ON quota_usage_logs(usage_date);
