"use client";
import { useEffect, useRef, useCallback } from "react";

// グローバルなモーダルスタック — 最後に開いたモーダルだけがブラウザバックに反応
const modalStack: Array<() => void> = [];

export function Modal({ open, onClose, onBack, title, children }: { open: boolean; onClose: () => void; onBack?: () => void; title: string; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(false);
  const stackEntryRef = useRef<(() => void) | null>(null);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      // 最外側モーダル: ブラウザバックでは閉じない。historyを元に戻す
      history.pushState({ modal: true }, "");
    }
  }, [onBack]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !openRef.current) {
      dialog.showModal();
      history.pushState({ modal: true }, "");
      openRef.current = true;

      // スタックに追加
      stackEntryRef.current = handleBack;
      modalStack.push(handleBack);
    } else if (!open && openRef.current) {
      if (dialog.open) dialog.close();
      openRef.current = false;

      // スタックから除去
      const idx = modalStack.indexOf(stackEntryRef.current!);
      if (idx !== -1) modalStack.splice(idx, 1);
      stackEntryRef.current = null;
    }
  }, [open, handleBack]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (stackEntryRef.current) {
        const idx = modalStack.indexOf(stackEntryRef.current);
        if (idx !== -1) modalStack.splice(idx, 1);
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        if (openRef.current) {
          openRef.current = false;
          const idx = modalStack.indexOf(stackEntryRef.current!);
          if (idx !== -1) modalStack.splice(idx, 1);
          stackEntryRef.current = null;
          onClose();
        }
      }}
      style={{ margin: "auto" }}
      className="backdrop:bg-black/50 rounded-lg p-0 w-full max-w-2xl max-h-[85vh] overflow-hidden"
    >
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-border shrink-0 bg-white">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="text-muted-foreground hover:text-foreground p-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            )}
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </dialog>
  );
}

// ページレベルでpopstateを1回だけ登録
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (modalStack.length > 0) {
      const topHandler = modalStack[modalStack.length - 1];
      topHandler();
    }
  });
}
