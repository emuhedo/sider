const commander = require('commander');
const CliTable = require('cli-table');
const moment = require('moment');
const path = require('path');

const fileDb = require('./file-db');
const runDb = require('./start-engine');
const notFoundCommand = require('./not-found-command');
const snapshots = require('./snapshots');

let commandFound = false;

function cloneSnapshotToDb(dbName, snapshotName, port) {
  const snapshot = fileDb.getSnapshot(snapshotName);

  if (!snapshot) {
    console.error('Snapshot does not exist');
    process.exit(1);
  }

  const db = fileDb.getDb(dbName);

  if (db) {
    console.error('Error: db already exists');
    process.exit(1);
  }

  fileDb.cloneSnapshotToDb(dbName, snapshotName, port);

  return true;
}

function startDbInternal(dbName, port) {
  let dbPort = port;
  const dbDirectory = fileDb.getDb(dbName);

  if (!dbDirectory) {
    console.error('Error: db not found');
    process.exit(1);
  }

  if (!port) {
    dbPort = dbDirectory.port;
  }

  // This should probably be handled by fileDb
  const dbPortPath = path.join(path.dirname(dbDirectory.path), path.sep);

  runDb.runSingleDb(
    dbPortPath,
    dbName,
    dbPort
  );
}

function startDb(dbName, snapshotName, options) {
  commandFound = true;

  const { port } = options;

  if (snapshotName) {
    if (!cloneSnapshotToDb(dbName, snapshotName, port || '6379')) {
      return;
    }
  }

  startDbInternal(dbName, port);
}

function removeDb(dbName) {
  commandFound = true;

  const db = fileDb.getDb(dbName);

  if (!db) {
    console.error(
      `Error: cannot remove db ${dbName} - not found`
    );
    process.exit(1);
  }

  fileDb.removeDb(dbName);
}

function listDbs() {
  commandFound = true;

  const table = new CliTable({
    head: ['name', 'snapshot', 'port', 'created', 'last used']
  });

  const tableData = fileDb.getDbsAsArray().map(db => {
    const {
      dbName,
      snapshotName,
      port,
      stats: { birthtime, mtime }
    } = db;

    // TODO Factor out birthtime and mtime to common formatting util. Methinks the folder is a better option
    // when it comes to creation time
    return [
      dbName,
      snapshotName,
      port,
      moment(birthtime).fromNow(),
      moment(mtime).fromNow()
    ];
  });

  // TODO Take command-line parameters for sorting
  tableData.sort((a, b) => (a.dbName < b.dbName ? 1 : -1));

  tableData.forEach(tableRow => table.push(tableRow));

  console.log(table.toString());
}

function promoteToSnapshot(dbName, snapshotName) {
  commandFound = true;

  const db = fileDb.getDb(dbName);

  snapshots.addSnapshot(snapshotName, db.path);
}

function resetDb(dbName) {
  commandFound = true;

  const db = fileDb.getDb(dbName);

  if (!db) {
    console.error(`Error: cannot reset db ${dbName} - not found`);

    process.exit(1);
  }

  fileDb.removeDb(dbName);

  fileDb.cloneSnapshotToDb(
    dbName,
    db.snapshotName,
    db.port
  );
}

function setupCommanderArguments() {
  commander
    .command('start <name> [snapshot]')
    .option('-p, --port <port>', 'Start on other than default port')
    .description('starts the named db')
    .action(startDb);

  commander
    .command('remove <name>')
    .description('removes the named db')
    .action(removeDb);

  commander
    .command('list')
    .description('lists all dbs')
    .action(listDbs);

  commander
    .command('promote <name> <newSnapshotName>')
    .description('promotes a db to a snapshot')
    .action(promoteToSnapshot);

  commander
    .command('reset <name>')
    .description("resets a db to it's cloned snapshot state")
    .action(resetDb);

  commander
    .name('sider db')
    .description('controls dbs')
    .usage('<command> [arguments]');
}

// I need this but it can be empty.
// This causes any child-processes to receive SIGINT on ctrl+c and shut down before we do
// Without this redis is killed hard without a chance to save background data
process.on('SIGINT', () => {});

setupCommanderArguments();
commander.parse(process.argv);

if (!commander.args.length) {
  commander.help();
  process.exit(1);
}

const knownSubCommands = ['start', 'remove', 'list', 'promote', 'reset'];

if (!commandFound) {
  notFoundCommand.printCommandHelp(knownSubCommands, commander);
}
