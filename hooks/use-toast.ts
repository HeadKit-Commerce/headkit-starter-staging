"use client";

import * as React from "react";
import { Toast } from "@base-ui/react/toast";

const toastManager = Toast.createToastManager();

type ToastInput = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive";
};

function toToastOptions(
  input: ToastInput,
  fallbackVariant: "default" | "destructive",
): {
  title?: React.ReactNode;
  description?: React.ReactNode;
  type: "default" | "destructive";
  priority: "high" | "low";
} {
  const variant = input.variant ?? fallbackVariant;
  const priority = variant === "destructive" ? "high" : "low";
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    type: variant,
    priority,
  };
}

function toast(input: ToastInput): {
  id: string;
  dismiss: () => void;
  update: (next: ToastInput) => void;
} {
  const id = toastManager.add(
    toToastOptions(input, input.variant ?? "default"),
  );

  return {
    id,
    dismiss: () => {
      toastManager.close(id);
    },
    update: (next: ToastInput) => {
      toastManager.update(id, toToastOptions(next, input.variant ?? "default"));
    },
  };
}

function useToast(): {
  toast: typeof toast;
  dismiss: (toastId?: string) => void;
} {
  return {
    toast,
    dismiss: (toastId?: string) => {
      toastManager.close(toastId);
    },
  };
}

export { toastManager, useToast, toast };
