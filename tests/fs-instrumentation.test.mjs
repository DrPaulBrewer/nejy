import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import ResourceMonitor from '../monitor/index.js';
import path from 'node:path';

test('instrumentFs tracks and blocks writes correctly', async (t) => {
  const quotas = { maxFsBytes: 10 };
  const monitor = new ResourceMonitor(quotas);

  // Create a minimal fake fs module
  const fakeFs = {
    writeFileSync: (path, data) => {},
    appendFileSync: (path, data) => {},
    copyFileSync: (src, dest) => {},
    statSync: (src) => ({ size: 5 }),
    stat: (src, cb) => { cb(null, { size: 5 }); },
    writeFile: (path, data, cb) => { if (cb) cb(null); },
    appendFile: (path, data, cb) => { if (cb) cb(null); },
    copyFile: (src, dest, cb) => { if (cb) cb(null); },
    promises: {
      writeFile: async (path, data) => {},
      appendFile: async (path, data) => {},
      copyFile: async (src, dest) => {},
      stat: async (src) => ({ size: 5 })
    }
  };

  monitor.instrumentFs(fakeFs);

  // Write 4 bytes
  fakeFs.writeFileSync('test.txt', '1234');
  assert.strictEqual(monitor.usage.fsBytes, 4);

  // Append 4 bytes
  fakeFs.appendFileSync('test.txt', '1234');
  assert.strictEqual(monitor.usage.fsBytes, 8);

  // Attempt to write 3 bytes (would total 11 > 10 quota)
  assert.throws(() => {
    fakeFs.writeFileSync('test.txt', '123');
  }, /FS_QUOTA_EXCEEDED/);

  // Still 8
  assert.strictEqual(monitor.usage.fsBytes, 8);

  // Copy a file of size 5 (would total 13 > 10)
  assert.throws(() => {
    fakeFs.copyFileSync('src.txt', 'dest.txt');
  }, /FS_QUOTA_EXCEEDED/);

  // Async promise write 3 bytes
  await assert.rejects(async () => {
    await fakeFs.promises.writeFile('test.txt', '123');
  }, /FS_QUOTA_EXCEEDED/);

  // Async cb write 3 bytes
  await new Promise((resolve, reject) => {
    fakeFs.writeFile('test.txt', '123', (err) => {
      if (err) {
        if (err.message === 'FS_QUOTA_EXCEEDED') resolve();
        else reject(err);
      } else {
        reject(new Error("Should have thrown"));
      }
    });
  });
});

test('instrumentFs copyFile async tracks and blocks properly', async (t) => {
  const quotas = { maxFsBytes: 10 };
  const monitor = new ResourceMonitor(quotas);

  const fakeFs = {
    copyFileSync: (src, dest) => {},
    statSync: (src) => ({ size: 5 }),
    stat: (src, cb) => { cb(null, { size: 5 }); },
    copyFile: (src, dest, cb) => { if (cb) cb(null); },
  };

  monitor.instrumentFs(fakeFs);

  // Do a successful async copy
  await new Promise((resolve, reject) => {
    fakeFs.copyFile('src.txt', 'dest.txt', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  assert.strictEqual(monitor.usage.fsBytes, 5);

  // Do a second async copy, should be blocked (5 + 5 > 10? Wait 10 is max. 5+5 is 10. OK.)
  await new Promise((resolve, reject) => {
    fakeFs.copyFile('src.txt', 'dest.txt', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  assert.strictEqual(monitor.usage.fsBytes, 10);

  // Third async copy, should exceed quota (10 + 5 > 10)
  await assert.rejects(async () => {
    await new Promise((resolve, reject) => {
      fakeFs.copyFile('src.txt', 'dest.txt', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }, /FS_QUOTA_EXCEEDED/);
});
