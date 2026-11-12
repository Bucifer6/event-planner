-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "OccasionMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
