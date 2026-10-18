import localFont from 'next/font/local';
import './globals.css';

// SUIT (OFL) — 한글 UI용. 굵기 대비(800 제목 / 500 본문)로 위계를 만든다
const suit = localFont({ src: './fonts/SUIT-Variable.woff2', weight: '100 900', variable: '--font-suit', display: 'swap' });

export const metadata = { title: '공방-콘텐츠파일럿' }; // 파비콘은 app/icon.svg (Next가 자동 연결)
// 다크 모드 없음: 운영체제 설정과 관계없이 항상 밝은 화면
export const viewport = { colorScheme: 'light', themeColor: '#ffffff' };

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className={suit.variable}>
      <body>{children}</body>
    </html>
  );
}
