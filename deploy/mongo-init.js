// Runs once, on the first start of an empty data volume.
// Creates a least-privilege user that can only read/write the app database.
const dbName = process.env.MONGO_APP_DB || 'ledger';
const user = process.env.MONGO_APP_USER;
const pwd = process.env.MONGO_APP_PASSWORD;

if (!user || !pwd) {
  throw new Error('MONGO_APP_USER and MONGO_APP_PASSWORD must be set');
}

db.getSiblingDB(dbName).createUser({
  user,
  pwd,
  roles: [{ role: 'readWrite', db: dbName }],
});
print(`Created app user '${user}' with readWrite on '${dbName}'`);
