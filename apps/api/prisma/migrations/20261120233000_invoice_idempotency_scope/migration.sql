-- Organization-scoped replay keys and one issue receipt per physical source.
CREATE UNIQUE INDEX "invoice_issue_commands_organizationId_key_key" ON "invoice_issue_commands"("organizationId", "key");
CREATE UNIQUE INDEX "invoice_issue_commands_organizationId_fulfilmentId_key" ON "invoice_issue_commands"("organizationId", "fulfilmentId");