module.exports = async function globalTeardown() {
  if (!globalThis.__QRA_PG__) return;
  try {
    await globalThis.__QRA_PG__.stop();
  } catch (e) {
    // Windows can keep the throw-away data folder locked for a moment (EBUSY); the tests themselves already finished.
    console.warn(`Test database stopped, but its temporary folder could not be removed: ${e.message}`);
  }
};
