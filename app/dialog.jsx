'use client';
// 브라우저 기본 alert·confirm 대신 쓰는 대화상자. 둘 다 Promise를 돌려준다.
//   const dialog = useDialog();
//   if (await dialog.confirm({ title, message, ok: '삭제', danger: true })) ...
//   await dialog.alert('메시지', '제목');
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogContext = createContext(null);
export const useDialog = () => useContext(DialogContext);

export function DialogProvider({ children }) {
  const [req, setReq] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const api = useRef({
    confirm: (opts) => ask(opts),
    alert: (message, title = '알림') => ask({ title, message, alertOnly: true })
  }).current;
  const close = (value) => { req?.resolve(value); setReq(null); };
  return (
    <DialogContext.Provider value={api}>
      {children}
      {req && <Box req={req} onClose={close} />}
    </DialogContext.Provider>
  );
}

function Box({ req, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector(req.alertOnly || !req.danger ? '.btn.primary, .btn.danger-fill' : '.btn.cancel')?.focus();
  }, [req]);
  return (
    // ESC = 취소 (cancel 이벤트), 바깥 배경 클릭 = 취소
    <dialog ref={ref} className="ask" onCancel={(e) => { e.preventDefault(); onClose(false); }}
      onClick={(e) => { if (e.target === ref.current) onClose(false); }} aria-labelledby="ask-title">
      <div className="ask-body">
        <b id="ask-title">{req.title}</b>
        {req.message && <p>{req.message}</p>}
        <div className="ask-foot">
          {!req.alertOnly && <button className="btn cancel" onClick={() => onClose(false)}>{req.cancel || '취소'}</button>}
          <button className={`btn ${req.danger ? 'danger-fill' : 'primary'}`} onClick={() => onClose(true)}>{req.ok || '확인'}</button>
        </div>
      </div>
    </dialog>
  );
}
