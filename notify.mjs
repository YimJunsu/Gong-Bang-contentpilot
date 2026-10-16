// 작업이 끝나면 Windows 알림(화면 오른쪽 아래 토스트)을 띄운다. 브라우저를 닫아 둬도 뜬다.
// 추가 설치 없이 PowerShell 5.1의 WinRT 알림 API를 쓴다. 누르면 관리 페이지(작업 로그)가 열린다.
// 제목·내용은 환경 변수로 넘긴다 — 명령줄에 끼워 넣지 않아 따옴표·특수문자가 있어도 안전하다.
import { spawn } from 'node:child_process';

const xmlEscape = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
// PowerShell이 쓰는 알림 앱 ID — 따로 앱을 등록하지 않아도 알림이 뜬다
const APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
  '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$xml.LoadXml($env:BH_TOAST)',
  `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`
].join('; ');

export function toastXml(title, body, url) {
  return `<toast activationType="protocol" launch="${xmlEscape(url)}"><visual><binding template="ToastGeneric">`
    + `<text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual></toast>`;
}

export function notify(title, body, url) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { env: { ...process.env, BH_TOAST: toastXml(title, body, url) }, windowsHide: true });
    ps.on('error', () => resolve(false));
    ps.on('close', (code) => resolve(code === 0)); // 알림 실패가 작업 결과를 바꾸지는 않는다
  });
}
