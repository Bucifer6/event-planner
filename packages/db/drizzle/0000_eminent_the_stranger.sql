CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"before" jsonb,
	"after" jsonb,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"account_id" text,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"last_slot" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"unique_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"metric" text NOT NULL,
	"dimension_key" text DEFAULT '' NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatif_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"title_key" text,
	"title_params" jsonb,
	"input" jsonb NOT NULL,
	"delta" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"proposed_by_kind" text NOT NULL,
	"proposed_by_id" text,
	"account_id" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"name" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"scan_state" text DEFAULT 'pending' NOT NULL,
	"visible_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "storage_usage" (
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_usage_owner_type_owner_id_pk" PRIMARY KEY("owner_type","owner_id")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"message_ro" text,
	"message_en" text,
	"internal_note" text,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by" text,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"username" text,
	"password_hash" text,
	"locale" text DEFAULT 'ro' NOT NULL,
	"display_name" text,
	"email_verified_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"requested_by_kind" text NOT NULL,
	"requested_by_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"undo_until" timestamp with time zone NOT NULL,
	"undone_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"retained_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_daily_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"to_email" text NOT NULL,
	"template" text NOT NULL,
	"locale" text NOT NULL,
	"occasion_id" text,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"sign_in_code_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"resend_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limit_backoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"strikes" integer DEFAULT 0 NOT NULL,
	"last_strike_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"axis" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_seconds" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"last_four" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"scope" text,
	"axis" text,
	"key_hash" text,
	"ip" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_type" text DEFAULT 'unknown' NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"fresh_auth_at" timestamp with time zone,
	"second_factor_pending" boolean DEFAULT false NOT NULL,
	"challenge" text,
	"challenge_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sign_in_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"email_hash" text NOT NULL,
	"purpose" text DEFAULT 'sign_in' NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_used_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occasion_members" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"account_id" text,
	"invite_email" text,
	"invite_token_hash" text,
	"role" text NOT NULL,
	"grant_finance" boolean DEFAULT false NOT NULL,
	"grant_private_requests" boolean DEFAULT false NOT NULL,
	"custom_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "occasions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_account_id" text NOT NULL,
	"business_id" text,
	"title" text NOT NULL,
	"kind" text DEFAULT 'blank' NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"date_mode" text DEFAULT 'date' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Bucharest' NOT NULL,
	"venue_name" text,
	"venue_address" text,
	"purpose" text,
	"priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale" text DEFAULT 'ro' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capacity_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"claim_key" text NOT NULL,
	"places" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_claims_places_ck" CHECK ("capacity_claims"."places" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contribution_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"need_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text,
	"account_id" text,
	"units" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_claims_units_ck" CHECK ("contribution_claims"."units" >= 1),
	CONSTRAINT "contribution_claims_holder_ck" CHECK (("contribution_claims"."household_id" IS NULL) <> ("contribution_claims"."account_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "contribution_needs" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"units_needed" integer NOT NULL,
	"units_claimed" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_needs_units_ck" CHECK ("contribution_needs"."units_needed" >= 1 AND "contribution_needs"."units_claimed" >= 0 AND "contribution_needs"."units_claimed" <= "contribution_needs"."units_needed")
);
--> statement-breakpoint
CREATE TABLE "date_poll_options" (
	"id" text PRIMARY KEY NOT NULL,
	"poll_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "date_poll_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"poll_id" text NOT NULL,
	"option_id" text NOT NULL,
	"household_id" text NOT NULL,
	"vote" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "date_polls" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"confirmed_option_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"lead_name" text,
	"lead_email" text,
	"language" text DEFAULT 'ro' NOT NULL,
	"expected_party_size" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"qr_id" text,
	"language" text DEFAULT 'ro' NOT NULL,
	"expiry_mode" text DEFAULT 'never' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"seen_revision" integer DEFAULT 0 NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occasion_capacity" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"total" integer,
	"taken" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occasion_capacity_taken_ck" CHECK ("occasion_capacity"."taken" >= 0 AND ("occasion_capacity"."total" IS NULL OR "occasion_capacity"."total" >= 0))
);
--> statement-breakpoint
CREATE TABLE "occasion_guest_settings" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"rsvp_deadline" timestamp with time zone,
	"guest_revision" integer DEFAULT 0 NOT NULL,
	"guest_revision_at" timestamp with time zone,
	"guest_revision_reason_key" text,
	"invitation_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"question_id" text NOT NULL,
	"option_id" text,
	"value_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text NOT NULL,
	"text_ro" text NOT NULL,
	"text_en" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvp_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"attending" text NOT NULL,
	"adults_count" integer DEFAULT 0 NOT NULL,
	"children_count" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvp_responses_counts_ck" CHECK ("rsvp_responses"."adults_count" >= 0 AND "rsvp_responses"."children_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"decision" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requester_staff_id" text NOT NULL,
	"approver_staff_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"decision_reason" text,
	"single_operator_mode" boolean DEFAULT false NOT NULL,
	"approvals_needed" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "console_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"tool" text NOT NULL,
	"scope" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last4" text NOT NULL,
	"scope" text NOT NULL,
	"business_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"consent_accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"target_ref" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"reason_category" text NOT NULL,
	"description" text NOT NULL,
	"reporter_contact_hash" text,
	"reporter_contact" text,
	"locale" text DEFAULT 'ro' NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"reason_given_to_affected" text,
	"internal_note" text,
	"decided_by_staff_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"task_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"state" text DEFAULT 'offered' NOT NULL,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reminder_digests" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"member_id" text NOT NULL,
	"date_key" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_check_items" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"depends_on_task_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"owner_member_id" text,
	"due_at" timestamp with time zone,
	"stage" text,
	"parent_id" text,
	"priority_index" integer,
	"template_task_key" text,
	"offset_months" integer,
	"offset_days" integer,
	"created_by_member_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"key" text NOT NULL,
	"title_ro" text NOT NULL,
	"title_en" text NOT NULL,
	"stage" text NOT NULL,
	"offset_months" integer DEFAULT 0 NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ro" text,
	"description_en" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text,
	"target_table" text NOT NULL,
	"target_id" text NOT NULL,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"preset_key" text,
	"estimate_minor" bigint,
	"forecast_minor" bigint,
	"currency" text DEFAULT 'RON' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_amounts_ck" CHECK (("budget_categories"."estimate_minor" IS NULL OR "budget_categories"."estimate_minor" >= 0) AND ("budget_categories"."forecast_minor" IS NULL OR "budget_categories"."forecast_minor" >= 0))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"category_id" text,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"spent_on" text NOT NULL,
	"supplier_label" text,
	"booking_id" text,
	"receipt_asset_id" text,
	"approval_state" text DEFAULT 'pending' NOT NULL,
	"approval_decided_at" timestamp with time zone,
	"approval_decided_by" text,
	"payment_state" text DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_on" text,
	"created_by_member_id" text,
	"idempotency_key" text,
	"retained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text DEFAULT 'cost' NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"paid_by_participant_id" text NOT NULL,
	"split_mode" text DEFAULT 'even' NOT NULL,
	"occurred_on" text NOT NULL,
	"expense_id" text,
	"created_by_member_id" text,
	"idempotency_key" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_ck" CHECK ("ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text NOT NULL,
	"member_id" text,
	"household_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"share_minor" bigint NOT NULL,
	"weight" integer,
	CONSTRAINT "ledger_shares_amount_ck" CHECK ("ledger_shares"."share_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"occasion_kind" text NOT NULL,
	"occasion_id" text NOT NULL,
	"occasion_title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"state" text DEFAULT 'enquired' NOT NULL,
	"agreed_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"quote_asset_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefing_acks" (
	"id" text PRIMARY KEY NOT NULL,
	"briefing_version_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"ack_name" text NOT NULL,
	"link_id" text,
	"ack_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefing_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_deltas" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"household_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"folded_into_snapshot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"version" integer NOT NULL,
	"items" jsonb NOT NULL,
	"based_on" jsonb NOT NULL,
	"created_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_deadlines" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text NOT NULL,
	"due_on" date NOT NULL,
	"amount_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_links" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"language" text DEFAULT 'ro' NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"category_label" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"listing_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"supplier_id" text,
	"title" text NOT NULL,
	"kind" text DEFAULT 'delivery' NOT NULL,
	"expected_from" timestamp with time zone,
	"expected_to" timestamp with time zone,
	"place" text,
	"state" text DEFAULT 'expected' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_items" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"expected_qty" integer NOT NULL,
	"unit" text,
	"received_qty" integer,
	"received_at" timestamp with time zone,
	"returned_qty" integer,
	"returned_at" timestamp with time zone,
	"deposit_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"deposit_recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"decision" text NOT NULL,
	"conditions" text,
	"note" text,
	"evidence" jsonb NOT NULL,
	"decided_by_member_id" text,
	"decided_by_account_id" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_day_state" (
	"task_id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"start_time" text,
	"contact_phone" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"merged_into_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counties" (
	"code" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"launch_area" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"merged_into_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_link_prefs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"subject_id" text NOT NULL,
	"set_by_account_id" text,
	"dismissed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "localities" (
	"id" text PRIMARY KEY NOT NULL,
	"county_code" text NOT NULL,
	"slug" text NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text,
	"kind" text DEFAULT 'oras' NOT NULL,
	"county_seat" boolean DEFAULT false NOT NULL,
	"public_page" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"merged_into_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_fact_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text DEFAULT 'verified' NOT NULL,
	"staff_id" text NOT NULL,
	"seen" text NOT NULL,
	"valid_until" text,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_fact_checks_kind_ck" CHECK ("business_fact_checks"."kind" in ('onrc', 'insurance')),
	CONSTRAINT "business_fact_checks_outcome_ck" CHECK ("business_fact_checks"."outcome" in ('verified', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"account_id" text,
	"role" text NOT NULL,
	"invite_email" text,
	"invite_token_hash" text,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "business_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"listing_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_account_id" text NOT NULL,
	"onrc_registration" text,
	"onrc_verified_at" timestamp with time zone,
	"insurance_valid_until" text,
	"insurance_seen_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"restriction_reason" text,
	"restricted_at" timestamp with time zone,
	"plan_lapsed_at" timestamp with time zone,
	"nudge_48h" boolean DEFAULT true NOT NULL,
	"hide_stats" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_categories" (
	"listing_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "listing_categories_listing_id_category_id_pk" PRIMARY KEY("listing_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "listing_localities" (
	"listing_id" text NOT NULL,
	"locality_id" text NOT NULL,
	"county_code" text NOT NULL,
	CONSTRAINT "listing_localities_listing_id_locality_id_pk" PRIMARY KEY("listing_id","locality_id")
);
--> statement-breakpoint
CREATE TABLE "listing_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'listing' NOT NULL,
	"subject_id" text NOT NULL,
	"listing_id" text,
	"business_id" text,
	"payload" jsonb NOT NULL,
	"base_payload" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"submitted_by_account_id" text,
	"submitted_by_staff_id" text,
	"source_note" text,
	"moderator_staff_id" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_revisions_state_ck" CHECK ("listing_revisions"."state" in ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "listing_stats" (
	"listing_id" text NOT NULL,
	"day" text NOT NULL,
	"enquiries_received" integer DEFAULT 0 NOT NULL,
	"enquiries_answered" integer DEFAULT 0 NOT NULL,
	"median_reply_minutes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_stats_listing_id_day_pk" PRIMARY KEY("listing_id","day"),
	CONSTRAINT "listing_stats_counts_ck" CHECK ("listing_stats"."enquiries_received" >= 0 and "listing_stats"."enquiries_answered" >= 0 and "listing_stats"."enquiries_answered" <= "listing_stats"."enquiries_received")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"claimed" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"description_ro" text,
	"description_en" text,
	"contact_phone" text,
	"contact_email" text,
	"website" text,
	"photo_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"live_revision_id" text,
	"published_at" timestamp with time zone,
	"draft" jsonb,
	"source_url" text,
	"collected_at" timestamp with time zone,
	"public_contact_route" text,
	"hide_stats" boolean DEFAULT false NOT NULL,
	"suspension_reason" text,
	"suspended_at" timestamp with time zone,
	"status_before_suspension" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_status_ck" CHECK ("listings"."status" in ('draft', 'pending', 'live', 'suspended', 'retired')),
	CONSTRAINT "listings_claimed_ck" CHECK (("listings"."claimed" and "listings"."business_id" is not null) or (not "listings"."claimed" and "listings"."business_id" is null))
);
--> statement-breakpoint
CREATE TABLE "deploys" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'deploy' NOT NULL,
	"tag" text NOT NULL,
	"commit_hash" text NOT NULL,
	"previous_tag" text,
	"requested_by_staff_id" text NOT NULL,
	"approved_by_staff_id" text,
	"approval_request_id" text,
	"emergency" boolean DEFAULT false NOT NULL,
	"reason" text,
	"ci_status" text DEFAULT 'unknown' NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"stage" text,
	"active_lock" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"rollback_reason" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_staff_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"legal_reason" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"hours" integer DEFAULT 24 NOT NULL,
	"granted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawing_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_parking" (
	"listing_id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"live" jsonb,
	"live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"business_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"width_mm" integer,
	"length_mm" integer,
	"drawing_asset_id" text,
	"display_asset_id" text,
	"pixel_width" integer,
	"pixel_height" integer,
	"calibration" jsonb,
	"mm_per_px" double precision,
	"markings" jsonb DEFAULT '{"areas":[],"tableTypes":[],"fixtures":[],"pois":[],"parkingAreas":[]}'::jsonb NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"live_version_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_status_ck" CHECK ("spaces"."status" in ('draft', 'pending', 'live', 'retired')),
	CONSTRAINT "spaces_dims_ck" CHECK (("spaces"."width_mm" is null or "spaces"."width_mm" > 0) and ("spaces"."length_mm" is null or "spaces"."length_mm" > 0)),
	CONSTRAINT "spaces_calibration_ck" CHECK (("spaces"."mm_per_px" is null) = ("spaces"."calibration" is null))
);
--> statement-breakpoint
CREATE TABLE "meal_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"space_model_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"venue_ref" text,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"shape" text NOT NULL,
	"diameter_mm" integer,
	"width_mm" integer,
	"length_mm" integer,
	"seats" integer,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_kind_ck" CHECK ("plan_items"."kind" in ('table', 'fixture')),
	CONSTRAINT "plan_items_source_ck" CHECK ("plan_items"."source" in ('venue', 'custom')),
	CONSTRAINT "plan_items_shape_ck" CHECK ("plan_items"."shape" in ('round', 'rect')),
	CONSTRAINT "plan_items_dims_ck" CHECK (("plan_items"."diameter_mm" is null or "plan_items"."diameter_mm" > 0) and ("plan_items"."width_mm" is null or "plan_items"."width_mm" > 0) and ("plan_items"."length_mm" is null or "plan_items"."length_mm" > 0) and ("plan_items"."seats" is null or "plan_items"."seats" >= 0))
);
--> statement-breakpoint
CREATE TABLE "seat_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"table_item_id" text NOT NULL,
	"household_id" text NOT NULL,
	"kind" text NOT NULL,
	"guest_id" text,
	"places" integer DEFAULT 1 NOT NULL,
	"seat_no" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_assignments_kind_ck" CHECK ("seat_assignments"."kind" in ('guest', 'extra', 'children')),
	CONSTRAINT "seat_assignments_guest_ck" CHECK (("seat_assignments"."kind" = 'guest') = ("seat_assignments"."guest_id" is not null)),
	CONSTRAINT "seat_assignments_places_ck" CHECK ("seat_assignments"."places" >= 1 and ("seat_assignments"."kind" <> 'guest' or "seat_assignments"."places" = 1)),
	CONSTRAINT "seat_assignments_seat_ck" CHECK ("seat_assignments"."seat_no" is null or ("seat_assignments"."seat_no" >= 1 and "seat_assignments"."kind" = 'guest'))
);
--> statement-breakpoint
CREATE TABLE "seating_plans" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_models" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"source" text NOT NULL,
	"space_id" text,
	"drawing_version_id" text,
	"version_no" integer,
	"effective_at" timestamp with time zone,
	"name" text NOT NULL,
	"own_width_mm" integer,
	"own_length_mm" integer,
	"aisle_mm" integer DEFAULT 600 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_models_source_ck" CHECK ("space_models"."source" in ('venue', 'own')),
	CONSTRAINT "space_models_aisle_ck" CHECK ("space_models"."aisle_mm" between 0 and 5000)
);
--> statement-breakpoint
CREATE TABLE "stage_item_states" (
	"stage_id" text NOT NULL,
	"item_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"x" integer,
	"y" integer,
	"rotation" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_item_states_stage_id_item_id_pk" PRIMARY KEY("stage_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'enquiry' NOT NULL,
	"state" text DEFAULT 'sent' NOT NULL,
	"occasion_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"business_id" text NOT NULL,
	"booking_id" text,
	"sender_account_id" text,
	"shared" jsonb NOT NULL,
	"email_shared" boolean DEFAULT false NOT NULL,
	"shared_email" text,
	"idempotency_key" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"resent_at" timestamp with time zone,
	"first_answered_at" timestamp with time zone,
	"last_message_at" timestamp with time zone NOT NULL,
	"nudged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"reported_at" timestamp with time zone,
	"reported_by" text,
	"stat_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_state_ck" CHECK ("enquiries"."state" in ('sent', 'awaiting', 'answered', 'closed')),
	CONSTRAINT "enquiries_kind_ck" CHECK ("enquiries"."kind" in ('enquiry', 'quote_request')),
	CONSTRAINT "enquiries_email_ck" CHECK ("enquiries"."email_shared" or "enquiries"."shared_email" is null)
);
--> statement-breakpoint
CREATE TABLE "enquiry_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"enquiry_id" text NOT NULL,
	"side" text NOT NULL,
	"author_account_id" text,
	"body" text NOT NULL,
	"quote_asset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiry_messages_side_ck" CHECK ("enquiry_messages"."side" in ('planner', 'business')),
	CONSTRAINT "enquiry_messages_quote_ck" CHECK ("enquiry_messages"."quote_asset_id" is null or "enquiry_messages"."side" = 'business')
);
--> statement-breakpoint
CREATE TABLE "enquiry_stat_events" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"reply_minutes" integer
);
--> statement-breakpoint
CREATE TABLE "quote_links" (
	"id" text PRIMARY KEY NOT NULL,
	"enquiry_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"booking_id" text,
	"version" integer NOT NULL,
	"design_ref" jsonb,
	"arrangement_description" text,
	"quote_asset_id" text NOT NULL,
	"quote_message_id" text NOT NULL,
	"agreed_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"accepted_by_account_id" text
);
--> statement-breakpoint
CREATE TABLE "catalogue_items" (
	"id" text PRIMARY KEY NOT NULL,
	"catalogue_id" text NOT NULL,
	"business_id" text NOT NULL,
	"kind" text DEFAULT 'flower' NOT NULL,
	"variety_name" text NOT NULL,
	"image_asset_id" text,
	"season_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_per_stem_minor" integer,
	"price_per_bunch_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"colours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_items_kind_ck" CHECK ("catalogue_items"."kind" in ('flower', 'foliage')),
	CONSTRAINT "catalogue_items_price_ck" CHECK (("catalogue_items"."price_per_stem_minor" is null or "catalogue_items"."price_per_stem_minor" > 0) and ("catalogue_items"."price_per_bunch_minor" is null or "catalogue_items"."price_per_bunch_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "flower_catalogues" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"name" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"draft" jsonb,
	"live_revision_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flower_catalogues_state_ck" CHECK ("flower_catalogues"."state" in ('draft', 'pending', 'live', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "discovery_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"staff_id" text NOT NULL,
	"draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"run_id" text,
	"name" text NOT NULL,
	"category_guess_id" text,
	"category_guess_text" text,
	"county_code" text,
	"locality_id" text,
	"area_text" text,
	"public_contact_route" text NOT NULL,
	"public_email" text,
	"source_url" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"dedupe_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duplicate_of_listing_id" text,
	"duplicate_of_draft_id" text,
	"batch_id" text,
	"decided_at" timestamp with time zone,
	"listing_id" text,
	"invitation_sent_at" timestamp with time zone,
	"invitation_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_drafts_state_ck" CHECK ("discovery_drafts"."state" in ('pending', 'approved', 'rejected', 'duplicate_review'))
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"drafts_created" integer DEFAULT 0 NOT NULL,
	"duplicates_queued" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_by" text NOT NULL,
	"stopped_reason" text
);
--> statement-breakpoint
CREATE TABLE "discovery_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rate_limit_per_hour" integer DEFAULT 60 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"terms_reference" text NOT NULL,
	"rate_window_start" timestamp with time zone,
	"rate_window_count" integer DEFAULT 0 NOT NULL,
	"created_by_staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_sources_kind_ck" CHECK ("discovery_sources"."kind" in ('onrc_public', 'business_page', 'licensed_dataset')),
	CONSTRAINT "discovery_sources_rate_ck" CHECK ("discovery_sources"."rate_limit_per_hour" between 1 and 3600)
);
--> statement-breakpoint
CREATE TABLE "discovery_suppressions" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"objection_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"claimant_account_id" text NOT NULL,
	"business_id" text,
	"business_name" text,
	"method" text NOT NULL,
	"state" text NOT NULL,
	"statement" text,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"codes_sent" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"check_note" text,
	"checked_by_staff_id" text,
	"checked_at" timestamp with time zone,
	"approval_request_id" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_claims_state_ck" CHECK ("listing_claims"."state" in ('code_sent', 'verified', 'needs_check', 'in_approval', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "objection_records" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"listing_name" text NOT NULL,
	"kind" text NOT NULL,
	"message" text,
	"contact_email" text,
	"via_invitation" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by_staff_id" text,
	"handling_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objection_records_state_ck" CHECK ("objection_records"."state" in ('received', 'honoured', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "business_library_items" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"asset_id" text,
	"created_by_account_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_library_items_kind_ck" CHECK ("business_library_items"."kind" in ('template', 'checklist', 'contact', 'asset'))
);
--> statement-breakpoint
CREATE TABLE "business_library_links" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"title" text NOT NULL,
	"asset_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_occasion_seats" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"business_id" text NOT NULL,
	"business_member_id" text NOT NULL,
	"occasion_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"business_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"logo_asset_id" text,
	"accent_color" text,
	"team_grant_finance" boolean DEFAULT true NOT NULL,
	"team_grant_private_requests" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occasion_handovers" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"business_id" text NOT NULL,
	"occasion_title" text NOT NULL,
	"occasion_starts_at" timestamp with time zone,
	"to_account_id" text,
	"by_account_id" text,
	"team_access_ended" integer DEFAULT 0 NOT NULL,
	"mcp_tokens_revoked" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"recorded_by_staff_id" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"notes" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"business_id" text NOT NULL,
	"number" text,
	"fiscal_ref" text,
	"provider" text,
	"net_minor" integer NOT NULL,
	"tva_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"tva_rate_bp" integer NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pdf_url" text,
	"pdf_asset_id" text,
	"processor_invoice_id" text,
	"processor_payment_id" text,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_sum_ck" CHECK ("invoices"."net_minor" + "invoices"."tva_minor" = "invoices"."gross_minor")
);
--> statement-breakpoint
CREATE TABLE "monetization_history" (
	"id" text PRIMARY KEY NOT NULL,
	"change" text NOT NULL,
	"requested_by_staff_id" text NOT NULL,
	"approver_staff_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_request_id" text,
	"acceptance_id" text,
	"notice_starts_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monetization_reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"days_before" integer NOT NULL,
	"businesses" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monetization_switch" (
	"id" text PRIMARY KEY DEFAULT 'switch' NOT NULL,
	"state" text DEFAULT 'off' NOT NULL,
	"notice_starts_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monetization_switch_single_ck" CHECK ("monetization_switch"."id" = 'switch'),
	CONSTRAINT "monetization_switch_state_ck" CHECK ("monetization_switch"."state" in ('off', 'on'))
);
--> statement-breakpoint
CREATE TABLE "processor_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"invoice_id" text,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"approval_request_id" text,
	"requested_by_staff_id" text NOT NULL,
	"approved_by_staff_id" text,
	"processor_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "refund_requests_amount_ck" CHECK ("refund_requests"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_until" timestamp with time zone,
	"listing_id" text,
	"category_id" text,
	"county_code" text,
	"sandbox" boolean DEFAULT false NOT NULL,
	"processor_customer_id" text,
	"processor_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_ck" CHECK ("subscriptions"."status" in ('active', 'past_due', 'grace', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "featured_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"category_id" text NOT NULL,
	"county_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_notice_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"notice_id" text NOT NULL,
	"business_id" text NOT NULL,
	"emails_queued" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"audience" text NOT NULL,
	"category_id" text,
	"county_code" text,
	"created_by_staff_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"business_count" integer DEFAULT 0 NOT NULL,
	"email_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stationery_sets" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"digital_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stationery_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"version" integer NOT NULL,
	"design_key" text NOT NULL,
	"colourway_key" text NOT NULL,
	"locale" text DEFAULT 'ro' NOT NULL,
	"texts" jsonb NOT NULL,
	"qr_on_invitation" boolean DEFAULT false NOT NULL,
	"created_by_account_id" text,
	"proofed_at" timestamp with time zone,
	"proofed_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text,
	"label" text NOT NULL,
	"relationship" text NOT NULL,
	"distance" text NOT NULL,
	"venue" text NOT NULL,
	"adults" integer DEFAULT 2 NOT NULL,
	"low_minor" integer NOT NULL,
	"high_minor" integer NOT NULL,
	"currency" text DEFAULT 'RON' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_guide_settings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"guide" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_copies" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"texts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arrangement_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"created_by_account_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arrangement_quote_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"design_id" text NOT NULL,
	"version" integer NOT NULL,
	"enquiry_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arrangement_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"design_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"version" integer NOT NULL,
	"form" text NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text,
	"source" text DEFAULT 'planner' NOT NULL,
	"created_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_text_results" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"month" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_text_usage" (
	"account_id" text NOT NULL,
	"month" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_text_usage_account_id_month_pk" PRIMARY KEY("account_id","month")
);
--> statement-breakpoint
CREATE TABLE "plan_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"body" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_category_id" text,
	"source" text DEFAULT 'planner' NOT NULL,
	"preview_id" text,
	"created_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programme_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"item_id" text NOT NULL,
	"item_title" text NOT NULL,
	"concerns_all" boolean NOT NULL,
	"household_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programme_cue_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"version" integer NOT NULL,
	"cues" jsonb NOT NULL,
	"created_by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programme_items" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'moment' NOT NULL,
	"day_offset" integer DEFAULT 0 NOT NULL,
	"start_minute" integer NOT NULL,
	"duration_min" integer,
	"place" text,
	"visible_to_guests" boolean DEFAULT false NOT NULL,
	"concerns_all" boolean DEFAULT true NOT NULL,
	"concerns_household_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_id" text,
	"notes" text,
	"cue_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programme_state" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"revision_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_choices" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_choices_count_ck" CHECK ("meal_choices"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"course" text DEFAULT 'main' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"diet_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_choice" boolean DEFAULT false NOT NULL,
	"audience" text DEFAULT 'adults' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_settings" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"safety_margin_pct" integer DEFAULT 5 NOT NULL,
	"service_hours" integer DEFAULT 6 NOT NULL,
	"drink_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"meal_stage_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"slug" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"title_ro" text NOT NULL,
	"title_en" text,
	"description_ro" text,
	"description_en" text,
	"show_date" boolean DEFAULT true NOT NULL,
	"show_venue" boolean DEFAULT true NOT NULL,
	"show_programme" boolean DEFAULT false NOT NULL,
	"show_menu" boolean DEFAULT false NOT NULL,
	"registration_enabled" boolean DEFAULT false NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"shares_capacity" boolean DEFAULT true NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privacy_url" text,
	"registration_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"queue_no" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"party_adults" integer NOT NULL,
	"party_juniors" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"language" text DEFAULT 'ro' NOT NULL,
	"status" text NOT NULL,
	"manage_token_hash" text NOT NULL,
	"idempotency_key" text,
	"consent_at" timestamp with time zone NOT NULL,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_registrations_counts_ck" CHECK ("public_registrations"."party_adults" >= 1 AND "public_registrations"."party_juniors" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_journeys" (
	"occasion_id" text PRIMARY KEY NOT NULL,
	"published_at" timestamp with time zone,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_name" text,
	"contact_route" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text,
	"registration_id" text,
	"kind" text NOT NULL,
	"diet_tag" text,
	"body" text,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"handled_by_account_id" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"subgroup_id" text,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"tz" text DEFAULT 'Europe/Bucharest' NOT NULL,
	"place" text,
	"cost_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"capacity" integer,
	"taken" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_optins" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"person_key" text NOT NULL,
	"places" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"currency" text NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"start_tz" text NOT NULL,
	"end_tz" text NOT NULL,
	"place_from" text,
	"place_to" text,
	"reference" text,
	"import_key" text,
	"notes" text,
	"subgroup_id" text,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packing_lists" (
	"task_id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"scope" text DEFAULT 'occasion' NOT NULL,
	"subgroup_id" text,
	"member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"person_key" text NOT NULL,
	"places" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"occupants" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"price_minor" integer,
	"currency" text DEFAULT 'RON' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subgroup_members" (
	"id" text PRIMARY KEY NOT NULL,
	"subgroup_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"person_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subgroups" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"name" text NOT NULL,
	"lead_member_id" text,
	"lead_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"label" text NOT NULL,
	"departs_at" timestamp with time zone,
	"arrives_at" timestamp with time zone,
	"tz" text DEFAULT 'Europe/Bucharest' NOT NULL,
	"place_from" text,
	"place_to" text,
	"seats" integer,
	"taken" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_seats" (
	"id" text PRIMARY KEY NOT NULL,
	"transport_leg_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"person_key" text NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"household_id" text NOT NULL,
	"adults_arrived" integer NOT NULL,
	"children_arrived" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'search' NOT NULL,
	"by_member_id" text,
	"by_account_id" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_item_revisions" (
	"item_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_items" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"account_id" text NOT NULL,
	"client_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"result_detail" jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sustainability_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"occasion_id" text NOT NULL,
	"metric" text NOT NULL,
	"label" text,
	"target_value" double precision,
	"unit" text NOT NULL,
	"direction" text DEFAULT 'at_most' NOT NULL,
	"aggregate" text DEFAULT 'sum' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sustainability_measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"occasion_id" text NOT NULL,
	"value" double precision,
	"note" text,
	"measured_at" timestamp with time zone NOT NULL,
	"by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_sign_in_code_id_sign_in_codes_id_fk" FOREIGN KEY ("sign_in_code_id") REFERENCES "public"."sign_in_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_secrets" ADD CONSTRAINT "totp_secrets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_members" ADD CONSTRAINT "occasion_members_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_members" ADD CONSTRAINT "occasion_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_claims" ADD CONSTRAINT "capacity_claims_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_claims" ADD CONSTRAINT "contribution_claims_need_id_contribution_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."contribution_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_claims" ADD CONSTRAINT "contribution_claims_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_claims" ADD CONSTRAINT "contribution_claims_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_claims" ADD CONSTRAINT "contribution_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_needs" ADD CONSTRAINT "contribution_needs_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_poll_options" ADD CONSTRAINT "date_poll_options_poll_id_date_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."date_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_poll_options" ADD CONSTRAINT "date_poll_options_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_poll_votes" ADD CONSTRAINT "date_poll_votes_poll_id_date_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."date_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_poll_votes" ADD CONSTRAINT "date_poll_votes_option_id_date_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."date_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_poll_votes" ADD CONSTRAINT "date_poll_votes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_polls" ADD CONSTRAINT "date_polls_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_capacity" ADD CONSTRAINT "occasion_capacity_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_guest_settings" ADD CONSTRAINT "occasion_guest_settings_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_answers" ADD CONSTRAINT "rsvp_answers_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_answers" ADD CONSTRAINT "rsvp_answers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_answers" ADD CONSTRAINT "rsvp_answers_question_id_rsvp_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."rsvp_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_questions" ADD CONSTRAINT "rsvp_questions_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_responses" ADD CONSTRAINT "rsvp_responses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_staff_id_staff_members_id_fk" FOREIGN KEY ("requester_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_staff_id_staff_members_id_fk" FOREIGN KEY ("approver_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_call_log" ADD CONSTRAINT "mcp_call_log_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_digests" ADD CONSTRAINT "reminder_digests_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_check_items" ADD CONSTRAINT "task_check_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_member_id_occasion_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."occasion_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paid_by_participant_id_ledger_participants_id_fk" FOREIGN KEY ("paid_by_participant_id") REFERENCES "public"."ledger_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_participants" ADD CONSTRAINT "ledger_participants_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_shares" ADD CONSTRAINT "ledger_shares_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_shares" ADD CONSTRAINT "ledger_shares_participant_id_ledger_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."ledger_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_acks" ADD CONSTRAINT "briefing_acks_briefing_version_id_briefing_versions_id_fk" FOREIGN KEY ("briefing_version_id") REFERENCES "public"."briefing_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_acks" ADD CONSTRAINT "briefing_acks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefing_versions" ADD CONSTRAINT "briefing_versions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_deltas" ADD CONSTRAINT "order_deltas_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_snapshots" ADD CONSTRAINT "order_snapshots_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deadlines" ADD CONSTRAINT "payment_deadlines_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_deadlines" ADD CONSTRAINT "payment_deadlines_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_links" ADD CONSTRAINT "supplier_links_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_decisions" ADD CONSTRAINT "readiness_decisions_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_day_state" ADD CONSTRAINT "task_day_state_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_day_state" ADD CONSTRAINT "task_day_state_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_link_prefs" ADD CONSTRAINT "directory_link_prefs_set_by_account_id_accounts_id_fk" FOREIGN KEY ("set_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "localities" ADD CONSTRAINT "localities_county_code_counties_code_fk" FOREIGN KEY ("county_code") REFERENCES "public"."counties"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_fact_checks" ADD CONSTRAINT "business_fact_checks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_fact_checks" ADD CONSTRAINT "business_fact_checks_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_notices" ADD CONSTRAINT "business_notices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_categories" ADD CONSTRAINT "listing_categories_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_categories" ADD CONSTRAINT "listing_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_localities" ADD CONSTRAINT "listing_localities_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_localities" ADD CONSTRAINT "listing_localities_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_localities" ADD CONSTRAINT "listing_localities_county_code_counties_code_fk" FOREIGN KEY ("county_code") REFERENCES "public"."counties"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_submitted_by_account_id_accounts_id_fk" FOREIGN KEY ("submitted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_submitted_by_staff_id_staff_members_id_fk" FOREIGN KEY ("submitted_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_revisions" ADD CONSTRAINT "listing_revisions_moderator_staff_id_staff_members_id_fk" FOREIGN KEY ("moderator_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_stats" ADD CONSTRAINT "listing_stats_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_requested_by_staff_id_staff_members_id_fk" FOREIGN KEY ("requested_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_approved_by_staff_id_staff_members_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_access_grants" ADD CONSTRAINT "compliance_access_grants_requester_staff_id_staff_members_id_fk" FOREIGN KEY ("requester_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_access_grants" ADD CONSTRAINT "compliance_access_grants_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_versions" ADD CONSTRAINT "drawing_versions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawing_versions" ADD CONSTRAINT "drawing_versions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_parking" ADD CONSTRAINT "listing_parking_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_parking" ADD CONSTRAINT "listing_parking_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_stages" ADD CONSTRAINT "meal_stages_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_space_model_id_space_models_id_fk" FOREIGN KEY ("space_model_id") REFERENCES "public"."space_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_table_item_id_plan_items_id_fk" FOREIGN KEY ("table_item_id") REFERENCES "public"."plan_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_published_by_account_id_accounts_id_fk" FOREIGN KEY ("published_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_models" ADD CONSTRAINT "space_models_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_models" ADD CONSTRAINT "space_models_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_models" ADD CONSTRAINT "space_models_drawing_version_id_drawing_versions_id_fk" FOREIGN KEY ("drawing_version_id") REFERENCES "public"."drawing_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_item_states" ADD CONSTRAINT "stage_item_states_stage_id_meal_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."meal_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_item_states" ADD CONSTRAINT "stage_item_states_item_id_plan_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."plan_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_item_states" ADD CONSTRAINT "stage_item_states_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_sender_account_id_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_messages" ADD CONSTRAINT "enquiry_messages_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_messages" ADD CONSTRAINT "enquiry_messages_author_account_id_accounts_id_fk" FOREIGN KEY ("author_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_stat_events" ADD CONSTRAINT "enquiry_stat_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_links" ADD CONSTRAINT "quote_links_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_links" ADD CONSTRAINT "quote_links_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_links" ADD CONSTRAINT "quote_links_accepted_by_account_id_accounts_id_fk" FOREIGN KEY ("accepted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_items" ADD CONSTRAINT "catalogue_items_catalogue_id_flower_catalogues_id_fk" FOREIGN KEY ("catalogue_id") REFERENCES "public"."flower_catalogues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_items" ADD CONSTRAINT "catalogue_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flower_catalogues" ADD CONSTRAINT "flower_catalogues_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flower_catalogues" ADD CONSTRAINT "flower_catalogues_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_batches" ADD CONSTRAINT "discovery_batches_staff_id_staff_members_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_drafts" ADD CONSTRAINT "discovery_drafts_source_id_discovery_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_drafts" ADD CONSTRAINT "discovery_drafts_run_id_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_drafts" ADD CONSTRAINT "discovery_drafts_batch_id_discovery_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."discovery_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_drafts" ADD CONSTRAINT "discovery_drafts_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_source_id_discovery_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sources" ADD CONSTRAINT "discovery_sources_created_by_staff_id_staff_members_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD CONSTRAINT "listing_claims_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD CONSTRAINT "listing_claims_claimant_account_id_accounts_id_fk" FOREIGN KEY ("claimant_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD CONSTRAINT "listing_claims_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD CONSTRAINT "listing_claims_checked_by_staff_id_staff_members_id_fk" FOREIGN KEY ("checked_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_records" ADD CONSTRAINT "objection_records_handled_by_staff_id_staff_members_id_fk" FOREIGN KEY ("handled_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_library_items" ADD CONSTRAINT "business_library_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_library_items" ADD CONSTRAINT "business_library_items_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_library_links" ADD CONSTRAINT "business_library_links_item_id_business_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."business_library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_library_links" ADD CONSTRAINT "business_library_links_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_occasion_seats" ADD CONSTRAINT "business_occasion_seats_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_occasion_seats" ADD CONSTRAINT "business_occasion_seats_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_occasion_seats" ADD CONSTRAINT "business_occasion_seats_business_member_id_business_members_id_fk" FOREIGN KEY ("business_member_id") REFERENCES "public"."business_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_occasion_seats" ADD CONSTRAINT "business_occasion_seats_occasion_member_id_occasion_members_id_fk" FOREIGN KEY ("occasion_member_id") REFERENCES "public"."occasion_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_handovers" ADD CONSTRAINT "occasion_handovers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_handovers" ADD CONSTRAINT "occasion_handovers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_handovers" ADD CONSTRAINT "occasion_handovers_by_account_id_accounts_id_fk" FOREIGN KEY ("by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_acceptances" ADD CONSTRAINT "billing_acceptances_recorded_by_staff_id_staff_members_id_fk" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monetization_history" ADD CONSTRAINT "monetization_history_requested_by_staff_id_staff_members_id_fk" FOREIGN KEY ("requested_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_staff_id_staff_members_id_fk" FOREIGN KEY ("requested_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_slots" ADD CONSTRAINT "featured_slots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_notice_sends" ADD CONSTRAINT "platform_notice_sends_notice_id_platform_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."platform_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_notice_sends" ADD CONSTRAINT "platform_notice_sends_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_notices" ADD CONSTRAINT "platform_notices_created_by_staff_id_staff_members_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stationery_sets" ADD CONSTRAINT "stationery_sets_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stationery_versions" ADD CONSTRAINT "stationery_versions_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stationery_versions" ADD CONSTRAINT "stationery_versions_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stationery_versions" ADD CONSTRAINT "stationery_versions_proofed_by_account_id_accounts_id_fk" FOREIGN KEY ("proofed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_estimates" ADD CONSTRAINT "gift_estimates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_estimates" ADD CONSTRAINT "gift_estimates_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_guide_settings" ADD CONSTRAINT "gift_guide_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_copies" ADD CONSTRAINT "promotion_copies_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_designs" ADD CONSTRAINT "arrangement_designs_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_designs" ADD CONSTRAINT "arrangement_designs_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_quote_requests" ADD CONSTRAINT "arrangement_quote_requests_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_quote_requests" ADD CONSTRAINT "arrangement_quote_requests_design_id_arrangement_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."arrangement_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_versions" ADD CONSTRAINT "arrangement_versions_design_id_arrangement_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."arrangement_designs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_versions" ADD CONSTRAINT "arrangement_versions_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_versions" ADD CONSTRAINT "arrangement_versions_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_text_results" ADD CONSTRAINT "ai_text_results_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_text_usage" ADD CONSTRAINT "ai_text_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_notes" ADD CONSTRAINT "plan_notes_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_changes" ADD CONSTRAINT "programme_changes_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_cue_versions" ADD CONSTRAINT "programme_cue_versions_item_id_programme_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."programme_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_items" ADD CONSTRAINT "programme_items_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_items" ADD CONSTRAINT "programme_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_state" ADD CONSTRAINT "programme_state_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_choices" ADD CONSTRAINT "meal_choices_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_choices" ADD CONSTRAINT "meal_choices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_choices" ADD CONSTRAINT "meal_choices_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_settings" ADD CONSTRAINT "menu_settings_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_registrations" ADD CONSTRAINT "public_registrations_page_id_public_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."public_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_registrations" ADD CONSTRAINT "public_registrations_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_journeys" ADD CONSTRAINT "guest_journeys_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_requests" ADD CONSTRAINT "private_requests_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_requests" ADD CONSTRAINT "private_requests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_requests" ADD CONSTRAINT "private_requests_registration_id_public_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."public_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_subgroup_id_subgroups_id_fk" FOREIGN KEY ("subgroup_id") REFERENCES "public"."subgroups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_optins" ADD CONSTRAINT "activity_optins_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_notes" ADD CONSTRAINT "exchange_notes_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_legs" ADD CONSTRAINT "itinerary_legs_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_legs" ADD CONSTRAINT "itinerary_legs_subgroup_id_subgroups_id_fk" FOREIGN KEY ("subgroup_id") REFERENCES "public"."subgroups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_subgroup_id_subgroups_id_fk" FOREIGN KEY ("subgroup_id") REFERENCES "public"."subgroups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subgroup_members" ADD CONSTRAINT "subgroup_members_subgroup_id_subgroups_id_fk" FOREIGN KEY ("subgroup_id") REFERENCES "public"."subgroups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subgroups" ADD CONSTRAINT "subgroups_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_seats" ADD CONSTRAINT "transport_seats_transport_leg_id_transport_legs_id_fk" FOREIGN KEY ("transport_leg_id") REFERENCES "public"."transport_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_item_revisions" ADD CONSTRAINT "check_item_revisions_item_id_task_check_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."task_check_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_items" ADD CONSTRAINT "offline_items_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sustainability_goals" ADD CONSTRAINT "sustainability_goals_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sustainability_measurements" ADD CONSTRAINT "sustainability_measurements_goal_id_sustainability_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."sustainability_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_object_idx" ON "audit_log" USING btree ("object_type","object_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_kind","actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key_uq" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_runs_name_idx" ON "job_runs" USING btree ("name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_unique_key_uq" ON "jobs" USING btree ("unique_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("done_at","failed_at","run_at");--> statement-breakpoint
CREATE INDEX "jobs_name_idx" ON "jobs" USING btree ("name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stats_daily_uq" ON "stats_daily" USING btree ("day","metric","dimension_key");--> statement-breakpoint
CREATE INDEX "stats_daily_metric_idx" ON "stats_daily" USING btree ("metric","day");--> statement-breakpoint
CREATE INDEX "whatif_previews_occasion_idx" ON "whatif_previews" USING btree ("occasion_id","state");--> statement-breakpoint
CREATE INDEX "whatif_previews_account_idx" ON "whatif_previews" USING btree ("account_id","state");--> statement-breakpoint
CREATE INDEX "whatif_previews_expires_idx" ON "whatif_previews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_type","owner_id","deleted_at");--> statement-breakpoint
CREATE INDEX "assets_deleted_idx" ON "assets" USING btree ("deleted_at","purged_at");--> statement-breakpoint
CREATE INDEX "incidents_active_idx" ON "incidents" USING btree ("resolved_at","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_uq" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username_uq" ON "accounts" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_requests_open_uq" ON "deletion_requests" USING btree ("target_type","target_id") WHERE "deletion_requests"."undone_at" IS NULL AND "deletion_requests"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "deletion_requests_due_idx" ON "deletion_requests" USING btree ("undo_until");--> statement-breakpoint
CREATE UNIQUE INDEX "email_daily_counters_uq" ON "email_daily_counters" USING btree ("occasion_id","day");--> statement-breakpoint
CREATE INDEX "email_outbox_to_idx" ON "email_outbox" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_created_idx" ON "email_outbox" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_uq" ON "email_suppressions" USING btree ("email_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_links_token_hash_uq" ON "magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_credential_uq" ON "passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_credentials_account_idx" ON "passkey_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_backoffs_uq" ON "rate_limit_backoffs" USING btree ("scope","key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_buckets_uq" ON "rate_limit_buckets" USING btree ("scope","axis","key_hash","window_seconds","window_start");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_window_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_codes_hash_uq" ON "recovery_codes" USING btree ("account_id","code_hash");--> statement-breakpoint
CREATE INDEX "recovery_codes_account_idx" ON "recovery_codes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "security_log_at_idx" ON "security_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "security_log_event_idx" ON "security_log" USING btree ("event","at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sign_in_codes_lookup_idx" ON "sign_in_codes" USING btree ("email_hash","purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "totp_secrets_account_uq" ON "totp_secrets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occasion_members_occasion_account_uq" ON "occasion_members" USING btree ("occasion_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occasion_members_invite_token_uq" ON "occasion_members" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "occasion_members_account_idx" ON "occasion_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "occasions_owner_idx" ON "occasions" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "occasions_business_idx" ON "occasions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "occasions_starts_idx" ON "occasions" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capacity_claims_occasion_key_uq" ON "capacity_claims" USING btree ("occasion_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_claims_need_household_uq" ON "contribution_claims" USING btree ("need_id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_claims_need_account_uq" ON "contribution_claims" USING btree ("need_id","account_id");--> statement-breakpoint
CREATE INDEX "contribution_needs_occasion_idx" ON "contribution_needs" USING btree ("occasion_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "date_poll_options_poll_starts_uq" ON "date_poll_options" USING btree ("poll_id","starts_at");--> statement-breakpoint
CREATE INDEX "date_poll_options_poll_idx" ON "date_poll_options" USING btree ("poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "date_poll_votes_option_household_uq" ON "date_poll_votes" USING btree ("option_id","household_id");--> statement-breakpoint
CREATE INDEX "date_polls_occasion_idx" ON "date_polls" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "guests_household_idx" ON "guests" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "guests_occasion_idx" ON "guests" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "households_occasion_idx" ON "households" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_household_uq" ON "invitations" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_qr_uq" ON "invitations" USING btree ("qr_id");--> statement-breakpoint
CREATE INDEX "invitations_occasion_idx" ON "invitations" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_answers_household_question_uq" ON "rsvp_answers" USING btree ("household_id","question_id");--> statement-breakpoint
CREATE INDEX "rsvp_questions_occasion_idx" ON "rsvp_questions" USING btree ("occasion_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvp_responses_household_uq" ON "rsvp_responses" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "rsvp_responses_occasion_idx" ON "rsvp_responses" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_uq" ON "approval_decisions" USING btree ("request_id","staff_id");--> statement-breakpoint
CREATE INDEX "approval_requests_state_idx" ON "approval_requests" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("requester_staff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "console_sessions_session_uq" ON "console_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "console_sessions_staff_idx" ON "console_sessions" USING btree ("staff_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_account_uq" ON "staff_members" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "mcp_call_log_token_idx" ON "mcp_call_log" USING btree ("token_id","at");--> statement-breakpoint
CREATE INDEX "mcp_call_log_at_idx" ON "mcp_call_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_hash_uq" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_account_idx" ON "mcp_tokens" USING btree ("account_id","revoked_at");--> statement-breakpoint
CREATE INDEX "content_reports_state_idx" ON "content_reports" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "content_reports_reference_idx" ON "content_reports" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "delegations_occasion_state_idx" ON "delegations" USING btree ("occasion_id","state");--> statement-breakpoint
CREATE INDEX "delegations_to_idx" ON "delegations" USING btree ("to_member_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_open_task_uq" ON "delegations" USING btree ("task_id") WHERE "delegations"."state" = 'offered';--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_digests_member_day_uq" ON "reminder_digests" USING btree ("member_id","date_key");--> statement-breakpoint
CREATE INDEX "task_check_items_task_idx" ON "task_check_items" USING btree ("task_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_pair_uq" ON "task_dependencies" USING btree ("task_id","depends_on_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_on_idx" ON "task_dependencies" USING btree ("depends_on_task_id");--> statement-breakpoint
CREATE INDEX "tasks_occasion_status_idx" ON "tasks" USING btree ("occasion_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_occasion_due_idx" ON "tasks" USING btree ("occasion_id","due_at");--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "tasks" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_template_key_uq" ON "tasks" USING btree ("occasion_id","template_task_key") WHERE "tasks"."template_task_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "template_tasks_key_uq" ON "template_tasks" USING btree ("template_id","key");--> statement-breakpoint
CREATE INDEX "template_tasks_template_idx" ON "template_tasks" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_kind_uq" ON "templates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "corrections_target_idx" ON "corrections" USING btree ("target_table","target_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_occasion_idx" ON "corrections" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_occasion_name_uq" ON "budget_categories" USING btree ("occasion_id",lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_occasion_idx" ON "expenses" USING btree ("occasion_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "expenses_booking_idx" ON "expenses" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "expenses_retained_idx" ON "expenses" USING btree ("retained_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_idempotency_uq" ON "expenses" USING btree ("occasion_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_occasion_idx" ON "ledger_entries" USING btree ("occasion_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_uq" ON "ledger_entries" USING btree ("occasion_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_participants_occasion_idx" ON "ledger_participants" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_participants_member_uq" ON "ledger_participants" USING btree ("occasion_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_participants_household_uq" ON "ledger_participants" USING btree ("occasion_id","household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_shares_entry_participant_uq" ON "ledger_shares" USING btree ("entry_id","participant_id");--> statement-breakpoint
CREATE INDEX "ledger_shares_participant_idx" ON "ledger_shares" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_account_occasion_uq" ON "lessons" USING btree ("account_id","occasion_id");--> statement-breakpoint
CREATE INDEX "lessons_account_kind_idx" ON "lessons" USING btree ("account_id","occasion_kind");--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_supplier_uq" ON "bookings" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "bookings_occasion_idx" ON "bookings" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefing_acks_version_uq" ON "briefing_acks" USING btree ("briefing_version_id");--> statement-breakpoint
CREATE INDEX "briefing_acks_booking_idx" ON "briefing_acks" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefing_versions_booking_version_uq" ON "briefing_versions" USING btree ("booking_id","version");--> statement-breakpoint
CREATE INDEX "order_deltas_booking_idx" ON "order_deltas" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_snapshots_booking_version_uq" ON "order_snapshots" USING btree ("booking_id","version");--> statement-breakpoint
CREATE INDEX "payment_deadlines_occasion_due_idx" ON "payment_deadlines" USING btree ("occasion_id","due_on");--> statement-breakpoint
CREATE INDEX "payment_deadlines_booking_idx" ON "payment_deadlines" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_links_booking_uq" ON "supplier_links" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_links_token_uq" ON "supplier_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "suppliers_occasion_idx" ON "suppliers" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_occasion_listing_uq" ON "suppliers" USING btree ("occasion_id","listing_id") WHERE "suppliers"."listing_id" is not null;--> statement-breakpoint
CREATE INDEX "deliveries_occasion_idx" ON "deliveries" USING btree ("occasion_id","expected_from");--> statement-breakpoint
CREATE INDEX "deliveries_supplier_idx" ON "deliveries" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "delivery_items_delivery_idx" ON "delivery_items" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "readiness_decisions_occasion_idx" ON "readiness_decisions" USING btree ("occasion_id","decided_at");--> statement-breakpoint
CREATE INDEX "task_day_state_occasion_idx" ON "task_day_state" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_sort_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "counties_slug_uq" ON "counties" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_link_prefs_uq" ON "directory_link_prefs" USING btree ("scope","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "localities_county_slug_uq" ON "localities" USING btree ("county_code","slug");--> statement-breakpoint
CREATE INDEX "localities_county_idx" ON "localities" USING btree ("county_code","sort_order");--> statement-breakpoint
CREATE INDEX "business_fact_checks_business_idx" ON "business_fact_checks" USING btree ("business_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_business_account_uq" ON "business_members" USING btree ("business_id","account_id") WHERE "business_members"."account_id" is not null and "business_members"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_invite_token_uq" ON "business_members" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "business_members_account_idx" ON "business_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_one_owner_uq" ON "business_members" USING btree ("business_id") WHERE "business_members"."role" = 'owner' and "business_members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "business_notices_business_idx" ON "business_notices" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "listing_categories_category_idx" ON "listing_categories" USING btree ("category_id","listing_id");--> statement-breakpoint
CREATE INDEX "listing_localities_county_idx" ON "listing_localities" USING btree ("county_code","listing_id");--> statement-breakpoint
CREATE INDEX "listing_localities_locality_idx" ON "listing_localities" USING btree ("locality_id","listing_id");--> statement-breakpoint
CREATE INDEX "listing_revisions_queue_idx" ON "listing_revisions" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "listing_revisions_subject_idx" ON "listing_revisions" USING btree ("kind","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "listing_revisions_business_idx" ON "listing_revisions" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_revisions_one_pending_uq" ON "listing_revisions" USING btree ("kind","subject_id") WHERE "listing_revisions"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "listings_business_idx" ON "listings" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deploys_active_lock_uq" ON "deploys" USING btree ("active_lock");--> statement-breakpoint
CREATE INDEX "deploys_state_idx" ON "deploys" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "deploys_created_idx" ON "deploys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "compliance_access_grants_subject_idx" ON "compliance_access_grants" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "compliance_access_grants_requester_idx" ON "compliance_access_grants" USING btree ("requester_staff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drawing_versions_space_no_uq" ON "drawing_versions" USING btree ("space_id","version_no");--> statement-breakpoint
CREATE INDEX "drawing_versions_listing_idx" ON "drawing_versions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "spaces_listing_idx" ON "spaces" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "spaces_business_idx" ON "spaces" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "meal_stages_occasion_idx" ON "meal_stages" USING btree ("occasion_id","position");--> statement-breakpoint
CREATE INDEX "plan_items_occasion_idx" ON "plan_items" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "plan_items_model_idx" ON "plan_items" USING btree ("space_model_id");--> statement-breakpoint
CREATE INDEX "seat_assignments_occasion_idx" ON "seat_assignments" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "seat_assignments_table_idx" ON "seat_assignments" USING btree ("table_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_guest_uq" ON "seat_assignments" USING btree ("guest_id") WHERE "seat_assignments"."guest_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_group_uq" ON "seat_assignments" USING btree ("household_id","kind") WHERE "seat_assignments"."kind" <> 'guest';--> statement-breakpoint
CREATE UNIQUE INDEX "seat_assignments_seat_uq" ON "seat_assignments" USING btree ("table_item_id","seat_no") WHERE "seat_assignments"."seat_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "space_models_occasion_uq" ON "space_models" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "space_models_space_idx" ON "space_models" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "stage_item_states_occasion_idx" ON "stage_item_states" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "enquiries_occasion_idx" ON "enquiries" USING btree ("occasion_id","sent_at");--> statement-breakpoint
CREATE INDEX "enquiries_business_idx" ON "enquiries" USING btree ("business_id","state","last_message_at");--> statement-breakpoint
CREATE INDEX "enquiries_booking_idx" ON "enquiries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "enquiries_sender_idx" ON "enquiries" USING btree ("sender_account_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_idempotency_uq" ON "enquiries" USING btree ("occasion_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_open_uq" ON "enquiries" USING btree ("occasion_id","listing_id") WHERE "enquiries"."kind" = 'enquiry' and "enquiries"."state" <> 'closed';--> statement-breakpoint
CREATE INDEX "enquiry_messages_enquiry_idx" ON "enquiry_messages" USING btree ("enquiry_id","created_at");--> statement-breakpoint
CREATE INDEX "enquiry_stat_events_listing_idx" ON "enquiry_stat_events" USING btree ("listing_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_links_version_uq" ON "quote_links" USING btree ("enquiry_id","version");--> statement-breakpoint
CREATE INDEX "quote_links_booking_idx" ON "quote_links" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "catalogue_items_catalogue_idx" ON "catalogue_items" USING btree ("catalogue_id","sort_order");--> statement-breakpoint
CREATE INDEX "flower_catalogues_business_idx" ON "flower_catalogues" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "flower_catalogues_listing_idx" ON "flower_catalogues" USING btree ("listing_id","state");--> statement-breakpoint
CREATE INDEX "discovery_drafts_state_idx" ON "discovery_drafts" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "discovery_drafts_source_idx" ON "discovery_drafts" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "discovery_drafts_listing_idx" ON "discovery_drafts" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_drafts_invite_token_uq" ON "discovery_drafts" USING btree ("invitation_token_hash");--> statement-breakpoint
CREATE INDEX "discovery_runs_source_idx" ON "discovery_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "discovery_runs_started_idx" ON "discovery_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_sources_name_uq" ON "discovery_sources" USING btree ("name");--> statement-breakpoint
CREATE INDEX "listing_claims_listing_idx" ON "listing_claims" USING btree ("listing_id","state");--> statement-breakpoint
CREATE INDEX "listing_claims_state_idx" ON "listing_claims" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_claims_open_uq" ON "listing_claims" USING btree ("listing_id","claimant_account_id") WHERE "listing_claims"."state" in ('code_sent', 'verified', 'needs_check', 'in_approval');--> statement-breakpoint
CREATE INDEX "objection_records_state_idx" ON "objection_records" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "objection_records_listing_idx" ON "objection_records" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "business_library_items_business_idx" ON "business_library_items" USING btree ("business_id","kind","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_library_links_uq" ON "business_library_links" USING btree ("item_id","occasion_id");--> statement-breakpoint
CREATE INDEX "business_library_links_occasion_idx" ON "business_library_links" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_occasion_seats_member_uq" ON "business_occasion_seats" USING btree ("occasion_member_id");--> statement-breakpoint
CREATE INDEX "business_occasion_seats_occasion_idx" ON "business_occasion_seats" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occasion_handovers_occasion_uq" ON "occasion_handovers" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "occasion_handovers_business_idx" ON "occasion_handovers" USING btree ("business_id","at");--> statement-breakpoint
CREATE INDEX "invoices_subscription_idx" ON "invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_processor_uq" ON "invoices" USING btree ("processor_invoice_id");--> statement-breakpoint
CREATE INDEX "monetization_history_at_idx" ON "monetization_history" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "monetization_reminders_uq" ON "monetization_reminders" USING btree ("effective_at","days_before");--> statement-breakpoint
CREATE INDEX "refund_requests_state_idx" ON "refund_requests" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_business_idx" ON "subscriptions" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_processor_uq" ON "subscriptions" USING btree ("processor_subscription_id");--> statement-breakpoint
CREATE INDEX "featured_slots_search_idx" ON "featured_slots" USING btree ("category_id","county_code","active");--> statement-breakpoint
CREATE INDEX "featured_slots_listing_idx" ON "featured_slots" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_notice_sends_uq" ON "platform_notice_sends" USING btree ("notice_id","business_id");--> statement-breakpoint
CREATE INDEX "platform_notices_sent_idx" ON "platform_notices" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stationery_versions_occasion_version_uq" ON "stationery_versions" USING btree ("occasion_id","version");--> statement-breakpoint
CREATE INDEX "stationery_versions_occasion_idx" ON "stationery_versions" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "gift_estimates_account_occasion_idx" ON "gift_estimates" USING btree ("account_id","occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_estimates_household_uq" ON "gift_estimates" USING btree ("account_id","occasion_id","household_id");--> statement-breakpoint
CREATE INDEX "arrangement_designs_occasion_idx" ON "arrangement_designs" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arrangement_quote_requests_enquiry_uq" ON "arrangement_quote_requests" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "arrangement_quote_requests_design_idx" ON "arrangement_quote_requests" USING btree ("design_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arrangement_versions_design_version_uq" ON "arrangement_versions" USING btree ("design_id","version");--> statement-breakpoint
CREATE INDEX "arrangement_versions_occasion_idx" ON "arrangement_versions" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "ai_text_results_account_month_idx" ON "ai_text_results" USING btree ("account_id","month");--> statement-breakpoint
CREATE INDEX "plan_notes_occasion_idx" ON "plan_notes" USING btree ("occasion_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "programme_changes_occasion_revision_uq" ON "programme_changes" USING btree ("occasion_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "programme_cue_versions_item_version_uq" ON "programme_cue_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "programme_cue_versions_occasion_idx" ON "programme_cue_versions" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "programme_items_occasion_idx" ON "programme_items" USING btree ("occasion_id","day_offset","start_minute");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_choices_household_item_uq" ON "meal_choices" USING btree ("household_id","menu_item_id");--> statement-breakpoint
CREATE INDEX "meal_choices_occasion_idx" ON "meal_choices" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "menu_items_menu_idx" ON "menu_items" USING btree ("menu_id","position");--> statement-breakpoint
CREATE INDEX "menu_items_occasion_idx" ON "menu_items" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "menus_occasion_idx" ON "menus" USING btree ("occasion_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "public_pages_occasion_uq" ON "public_pages" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_pages_slug_uq" ON "public_pages" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "public_registrations_token_uq" ON "public_registrations" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "public_registrations_idem_uq" ON "public_registrations" USING btree ("page_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "public_registrations_email_uq" ON "public_registrations" USING btree ("page_id","email") WHERE "public_registrations"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "public_registrations_page_idx" ON "public_registrations" USING btree ("page_id","status","queue_no");--> statement-breakpoint
CREATE INDEX "public_registrations_occasion_idx" ON "public_registrations" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "private_requests_occasion_idx" ON "private_requests" USING btree ("occasion_id","status");--> statement-breakpoint
CREATE INDEX "private_requests_household_idx" ON "private_requests" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "activities_occasion_idx" ON "activities" USING btree ("occasion_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_optins_person_uq" ON "activity_optins" USING btree ("activity_id","person_key");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_notes_occasion_currency_uq" ON "exchange_notes" USING btree ("occasion_id","currency");--> statement-breakpoint
CREATE INDEX "itinerary_legs_occasion_idx" ON "itinerary_legs" USING btree ("occasion_id","starts_at");--> statement-breakpoint
CREATE INDEX "itinerary_legs_reference_idx" ON "itinerary_legs" USING btree ("occasion_id","reference");--> statement-breakpoint
CREATE INDEX "packing_lists_occasion_idx" ON "packing_lists" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_assignments_person_uq" ON "room_assignments" USING btree ("occasion_id","person_key");--> statement-breakpoint
CREATE INDEX "room_assignments_room_idx" ON "room_assignments" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "rooms_occasion_idx" ON "rooms" USING btree ("occasion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subgroup_members_person_uq" ON "subgroup_members" USING btree ("subgroup_id","person_key");--> statement-breakpoint
CREATE INDEX "subgroup_members_occasion_person_idx" ON "subgroup_members" USING btree ("occasion_id","person_key");--> statement-breakpoint
CREATE INDEX "subgroups_occasion_idx" ON "subgroups" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "transport_legs_occasion_idx" ON "transport_legs" USING btree ("occasion_id","departs_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_seats_person_uq" ON "transport_seats" USING btree ("transport_leg_id","person_key");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_household_uq" ON "check_ins" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "check_ins_occasion_arrived_idx" ON "check_ins" USING btree ("occasion_id","arrived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "offline_items_client_key_uq" ON "offline_items" USING btree ("occasion_id","client_key");--> statement-breakpoint
CREATE INDEX "offline_items_state_idx" ON "offline_items" USING btree ("occasion_id","account_id","state");--> statement-breakpoint
CREATE INDEX "sustainability_goals_occasion_idx" ON "sustainability_goals" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "sustainability_measurements_goal_idx" ON "sustainability_measurements" USING btree ("goal_id","measured_at");