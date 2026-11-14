import assert from 'node:assert/strict';
import { networkSettings } from './network.mjs';

const local = networkSettings({ port: 5999 });
assert.equal(local.listenHost, '127.0.0.1');
assert.equal(local.accepts({ host: '192.168.10.122:5999' }), false);
const lan = networkSettings({ port: 5999, lanHost: '192.168.10.122' });
assert.equal(lan.listenHost, '0.0.0.0');
for (const host of ['localhost:5999', '127.0.0.1:5999', '192.168.10.122:5999']) {
  assert.equal(lan.accepts({ host }), true);
  assert.equal(lan.accepts({ host, origin: `http://${host}` }), true);
  assert.equal(lan.accepts({ host, origin: 'http://evil.example' }), false);
}
for (const host of ['evil.example:5999', '192.168.10.123:5999', '192.168.10.122.evil.example:5999', '192.168.10.122:6000', undefined]) assert.equal(lan.accepts({ host }), false);
assert.equal(lan.accepts({ host: '192.168.10.122:5999', origin: 'null' }), false);
assert.throws(() => networkSettings({ port: 5999, lanHost: '*' }), /IPv4/);
assert.ok(lan.allowedDevOrigins.includes('192.168.10.122'));
console.log('network.check ok');
