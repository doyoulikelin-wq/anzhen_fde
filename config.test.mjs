import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.mjs';

// Isolated temporary directories and explicit environment objects ensure these
// checks never read the project's .env or process credentials.
async function isolatedRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anzhen-config-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('PUBLIC_ORIGIN is optional and leaves local defaults unchanged', async t => {
  const root = await isolatedRoot(t);
  for (const environment of [{}, { PUBLIC_ORIGIN: '' }]) {
    const config = await loadConfig(root, environment);
    assert.equal(config.publicOrigin, '');
    assert.equal(config.port, 4173);
    assert.equal(config.apiKey, '');
  }
});

test('PUBLIC_ORIGIN accepts and normalizes one explicit HTTP or HTTPS origin', async t => {
  const root = await isolatedRoot(t);
  for (const [input, expected] of [
    ['http://8.147.71.90', 'http://8.147.71.90'],
    ['https://Referral.Example:443', 'https://referral.example'],
    ['https://referral.example:8443', 'https://referral.example:8443'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
  ]) assert.equal((await loadConfig(root, { PUBLIC_ORIGIN: input })).publicOrigin, expected);
});

test('PUBLIC_ORIGIN rejects wildcard, credentials, null, paths and malformed origins', async t => {
  const root = await isolatedRoot(t);
  for (const input of [
    '*', 'null', null, 'https://*.example', 'https://%2a.example',
    'https://user:pass@example.com', 'https://@example.com',
    'https://example.com/', 'https://example.com/path', 'https://example.com?query=1',
    'https://example.com#fragment', 'https://example.com?', 'https://example.com#',
    'file://example.com', 'ftp://example.com', 'example.com', '//example.com',
    'http://', 'http://example.com:99999', 'https://example.com,https://other.example',
    ' https://example.com', 'https://exam\nple.com', 'https://example.com\\path',
  ]) await assert.rejects(loadConfig(root, { PUBLIC_ORIGIN: input }), /PUBLIC_ORIGIN/, String(input));
});

test('deployment environment can set its own origin without editing a bundled env file', async t => {
  const root = await isolatedRoot(t);
  await fs.writeFile(path.join(root, '.env'), 'PUBLIC_ORIGIN=http://old.example\nPORT=4173\n');
  assert.equal((await loadConfig(root, { PUBLIC_ORIGIN: 'https://referral.example' })).publicOrigin, 'https://referral.example');
  assert.equal((await loadConfig(root, { PUBLIC_ORIGIN: '' })).publicOrigin, '');
});

test('shared records use a configurable durable directory independent of releases', async t=>{
  const root=await isolatedRoot(t);
  assert.equal((await loadConfig(root,{})).dataDir,path.join(root,'var'));
  assert.equal((await loadConfig(root,{DATA_DIR:'/var/lib/anzhen-fde'})).dataDir,'/var/lib/anzhen-fde');
  assert.equal((await loadConfig(root,{DATA_DIR:'custom-data'})).dataDir,path.join(root,'custom-data'));
  await assert.rejects(loadConfig(root,{DATA_DIR:null}),/DATA_DIR/);
});
