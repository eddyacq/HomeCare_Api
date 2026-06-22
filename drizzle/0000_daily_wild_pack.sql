DO $$ BEGIN
 CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'on_the_way', 'in_progress', 'completed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cancelled_by" AS ENUM('client', 'worker', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."complaint_category" AS ENUM('no_show', 'quality', 'behavior', 'safety', 'payment', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."complaint_status" AS ENUM('open', 'investigating', 'resolved', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."role" AS ENUM('client', 'worker', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."service_type" AS ENUM('cleaning', 'laundry', 'housekeeping', 'nanny', 'babysitter');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admins" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"client_id" integer NOT NULL,
	"worker_id" integer,
	"service_type" "service_type" NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"address" varchar(500),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"notes" text,
	"cancelled_by" "cancelled_by",
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "complaints" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "complaints_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"booking_id" integer NOT NULL,
	"raised_by" integer NOT NULL,
	"category" "complaint_category" NOT NULL,
	"description" text NOT NULL,
	"attachment_url" varchar(500),
	"status" "complaint_status" DEFAULT 'open' NOT NULL,
	"admin_notes" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reviews_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"booking_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"firebase_uid" varchar(128) NOT NULL,
	"role" "role" NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"skills" varchar(500),
	"languages" varchar(255),
	"bio" text,
	"profile_photo_url" varchar(500),
	"is_available" boolean DEFAULT true NOT NULL,
	"is_childcare_verified" boolean DEFAULT false NOT NULL,
	"rating_average" numeric(3, 2) DEFAULT '0.00',
	"rating_count" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"admin_remark" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workers_user_id_unique" UNIQUE("user_id")
);
