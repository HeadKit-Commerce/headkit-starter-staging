"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { toastManager } from "@/hooks/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

function ToastList(): React.ReactElement {
  const { toasts } = ToastPrimitive.useToastManager();

  return (
    <>
      {toasts.map((item) => (
        <Toast key={item.id} toast={item}>
          <div className="grid gap-1">
            {item.title ? <ToastTitle /> : null}
            {item.description ? <ToastDescription /> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
    </>
  );
}

export function Toaster(): React.ReactElement {
  return (
    <ToastProvider toastManager={toastManager} limit={3} timeout={5000}>
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}
