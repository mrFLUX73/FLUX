import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppMetadata } from './appMetadata.ts';

test('creates published metadata only from complete CI identifiers', () => {
  assert.deepEqual(createAppMetadata({
    appVersion: '0.2.0',
    buildNumber: '136',
    commitSha: 'ad44737',
    buildDate: '2026-10-16T11:36:15Z',
  }), {
    appVersion: '0.2.0',
    buildNumber: '136',
    commitSha: 'ad44737',
    buildDate: '2026-10-16T11:36:15Z',
    isPublished: true,
  });
});

test('keeps local and malformed builds free of production identifiers', () => {
  assert.deepEqual(createAppMetadata({
    appVersion: '0.2.0',
    buildNumber: '136',
    commitSha: 'not-a-sha',
    buildDate: 'not-a-date',
  }), {
    appVersion: '0.2.0',
    buildNumber: null,
    commitSha: null,
    buildDate: null,
    isPublished: false,
  });
});

test('uses a valid semantic-version fallback when a build input is malformed', () => {
  assert.equal(createAppMetadata({ appVersion: 'build-136' }).appVersion, '0.0.0');
});
