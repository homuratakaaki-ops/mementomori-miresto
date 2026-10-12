import assert from 'node:assert/strict';
import {SyncError} from '../js/holy-angel-cloud-client.mjs';
assert.equal(new SyncError('conflict','競合').code,'conflict');
console.log('PASS 1 cloud client class smoke check');
