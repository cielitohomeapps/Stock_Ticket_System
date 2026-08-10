/**
 * Migration script: Copy ticket-related collections from inventory DB to ticket DB.
 *
 * Run: node scripts/migrate-to-ticket-db.js
 *
 * Collections migrated:
 *   - tickets
 *   - ticketAudits
 *   - stockMovements
 *   - stockSyncErrors
 *   - ubicaciones
 *   - config (emails)
 *
 * The usuarios collection stays on the inventory DB (shared with inventory system).
 */

require("dotenv").config({path: require("path").resolve(__dirname, "../.env")});

const {db, ticketDb} = require("../src/config/firebase");

const COLLECTIONS_TO_MIGRATE = [
  "tickets",
  "ticketAudits",
  "stockMovements",
  "stockSyncErrors",
  "ubicaciones",
  "config",
];

const BATCH_SIZE = 500; // Firestore batch limit

async function migrateCollection(collectionName) {
  console.log(`\n[Migrate] Starting migration of "${collectionName}"...`);

  const sourceRef = db.collection(collectionName);
  const snapshot = await sourceRef.get();

  if (snapshot.empty) {
    console.log(`[Migrate] "${collectionName}" is empty, skipping.`);
    return {migrated: 0, errors: 0};
  }

  const docs = snapshot.docs;
  console.log(`[Migrate] Found ${docs.length} documents in "${collectionName}".`);

  let migrated = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const firestoreBatch = ticketDb.batch();

    for (const doc of batch) {
      try {
        const targetRef = ticketDb.collection(collectionName).doc(doc.id);
        firestoreBatch.set(targetRef, doc.data());
      } catch (err) {
        console.error(`[Migrate] Error preparing doc ${doc.id}:`, err.message);
        errors++;
      }
    }

    try {
      await firestoreBatch.commit();
      migrated += batch.length;
      console.log(`[Migrate] Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${migrated}/${docs.length})`);
    } catch (err) {
      console.error(`[Migrate] Batch commit failed for "${collectionName}":`, err.message);
      errors += batch.length;
    }
  }

  console.log(`[Migrate] "${collectionName}" done: ${migrated} migrated, ${errors} errors.`);
  return {migrated, errors};
}

async function main() {
  console.log("=== Ticket DB Migration ===");
  console.log("Source: inventory DB (default)");
  console.log("Target: ticket DB (ticketApp)\n");

  const results = {};

  for (const collection of COLLECTIONS_TO_MIGRATE) {
    results[collection] = await migrateCollection(collection);
  }

  console.log("\n=== Migration Summary ===");
  let totalMigrated = 0;
  let totalErrors = 0;
  for (const [name, result] of Object.entries(results)) {
    console.log(`  ${name}: ${result.migrated} migrated, ${result.errors} errors`);
    totalMigrated += result.migrated;
    totalErrors += result.errors;
  }
  console.log(`\nTotal: ${totalMigrated} documents migrated, ${totalErrors} errors.`);

  if (totalErrors > 0) {
    console.log("\n⚠️  Some documents failed to migrate. Check logs above.");
    process.exit(1);
  } else {
    console.log("\n✅ Migration completed successfully.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
