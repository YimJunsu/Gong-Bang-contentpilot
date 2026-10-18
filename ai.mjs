// AI CLI(codex exec / claude -p)를 백그라운드로 돌린다. 프롬프트는 stdin으로 넘긴다 —
// Windows 명령줄 따옴표 문제를 피하고, 대화형 채팅 기록에도 남지 않는다.
//
// 돌려주는 값은 **AI의 최종 답변만**이다. 진행 기록(파일 읽기·명령 출력)은 log로만 흘린다.
// 2026-10-16: 둘을 섞어 받았더니 lastJson이 codex가 읽던 AGENTS.md 속 예시 JSON을 추천 결과로 집어 '추천 0개'가 됐다.
//   codex는 -o(--output-last-message) 파일로 최종 답변을 받고, claude -p는 stdout이 곧 최종 답변이다.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Windows PowerShell 5.1은 BOM 없는 UTF-8 파일을 CP949로 읽어 한글이 깨진다(같은 날 AGENTS.md 실측).
// 규칙 파일을 깨진 채 읽지 않도록 매번 알려 준다.
const ENCODING_NOTE = '\n\n(실행 환경: Windows. 파일은 항상 UTF-8로 읽고 쓴다. PowerShell의 Get-Content·Set-Content에는 -Encoding UTF8을 붙인다.)';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

export function runAI(config, engine, prompt, { cwd, log = () => {}, signal } = {}) {
  const template = config.engines?.[engine];
  if (!template) return Promise.reject(new Error(`엔진 설정 없음: ${engine}`));
  const [cmd, ...args] = template.map((part) => part.replaceAll('{cwd}', cwd));
  const lastFile = path.join(os.tmpdir(), `bh-last-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`);
  const isCodex = /(^|[\\/])codex(\.cmd|\.exe)?$/i.test(cmd);
  if (isCodex && !args.includes('-o') && !args.includes('--output-last-message')) {
    const stdinAt = args.lastIndexOf('-');
    args.splice(stdinAt >= 0 ? stdinAt : args.length, 0, '-o', `"${lastFile}"`);
  }
  // 생각 깊이(설정 → AI). 비우면 codex 자체 설정(~/.codex/config.toml)을 따른다. 깊을수록 꼼꼼하지만 오래 걸린다
  if (isCodex && EFFORTS.includes(config.codexEffort)) args.unshift('-c', `model_reasoning_effort=${config.codexEffort}`);
  return new Promise((resolve, reject) => {
    // shell: npm 전역 설치(codex.cmd)를 찾으려면 필요하다. 인자는 설정에 고정된 플래그와 우리가 만든 임시 파일 경로뿐이다.
    const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }; // AI가 돌리는 파이썬 출력이 깨지지 않게
    const child = spawn(cmd, args, { cwd, shell: true, windowsHide: true, signal, env });
    let stdout = '';
    const toLog = (text) => text.split(/\r?\n/).filter(Boolean).forEach((line) => log(line));
    child.stdout.on('data', (chunk) => { const text = chunk.toString('utf8'); stdout += text; toLog(text); });
    child.stderr.on('data', (chunk) => toLog(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', async (code) => {
      const last = isCodex ? await fs.readFile(lastFile, 'utf8').catch(() => null) : null;
      await fs.rm(lastFile, { force: true });
      if (code !== 0) return reject(new Error(`${engine} 종료 코드 ${code}`));
      resolve(last ?? stdout);
    });
    child.stdin.end(prompt + ENCODING_NOTE, 'utf8');
  });
}

// AI 출력 맨 뒤쪽의 JSON 블록 하나를 꺼낸다 (```json ... ``` 또는 맨 마지막 {...}/[...])
export function lastJson(text) {
  const fenced = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)].pop();
  const candidates = fenced ? [fenced[1]] : [];
  const tail = String(text).match(/(\[[\s\S]*\]|\{[\s\S]*\})\s*$/);
  if (tail) candidates.push(tail[1]);
  for (const raw of candidates) { try { return JSON.parse(raw); } catch { /* 다음 후보 */ } }
  return null;
}
