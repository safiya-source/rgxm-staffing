-- RGXM decided not to store Social Insurance Numbers (the accountant collects them directly).
ALTER TABLE "staff_sensitive" DROP COLUMN "sin_encrypted";--> statement-breakpoint
ALTER TABLE "staff_sensitive" DROP COLUMN "sin_last3";