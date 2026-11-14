import { isIP } from 'node:net';

// LAN 접속은 명시한 IPv4 한 주소만 허용한다. 다른 PC의 기본값은 로컬 전용이다.
export function networkSettings({ port, lanHost = '' }) {
  const address = String(lanHost).trim();
  if (address && isIP(address) !== 4) throw new Error('lanHost에는 이 PC의 IPv4 주소를 입력하세요');
  const names = ['localhost', '127.0.0.1', ...(address ? [address] : [])];
  const hosts = new Set(names.map(name => `${name}:${port}`));
  return {
    listenHost: address ? '0.0.0.0' : '127.0.0.1',
    hostname: address || 'localhost',
    allowedDevOrigins: names,
    accepts(headers) {
      return hosts.has(headers.host) && (headers.origin === undefined || headers.origin === `http://${headers.host}`);
    }
  };
}
