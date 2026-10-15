-- CreateTable
CREATE TABLE "print_files" (
    "id" SERIAL NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "fileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printedBy" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_files_docType_docId_key" ON "print_files"("docType", "docId");


-- CHECK: URL bản in phải là https
ALTER TABLE "print_files" ADD CONSTRAINT "print_files_url_chk" CHECK ("url" LIKE 'https://%');
