-- Grant the UI builder permissions to the system roles of existing installations.
UPDATE "Role" SET "permissions" = array_append("permissions", 'app:read')
WHERE "workspaceId" IS NULL AND "key" IN ('owner', 'admin', 'editor', 'operator', 'viewer') AND NOT ('app:read' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'app:manage')
WHERE "workspaceId" IS NULL AND "key" IN ('owner', 'admin', 'editor') AND NOT ('app:manage' = ANY("permissions"));
