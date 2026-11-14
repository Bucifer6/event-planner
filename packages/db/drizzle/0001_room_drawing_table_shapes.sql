ALTER TABLE "plan_items" DROP CONSTRAINT "plan_items_shape_ck";--> statement-breakpoint
ALTER TABLE "space_models" ADD COLUMN "own_areas" jsonb;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_shape_ck" CHECK ("plan_items"."shape" in ('round', 'rect', 'oval', 'halfmoon'));