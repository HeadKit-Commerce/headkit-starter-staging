"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export type LazyGravityFormProps = {
  id?: string;
  formId: string;
  initialValues?: { fieldName: string; value: string }[];
  onSubmit?: (values: Record<string, string>) => Promise<void>;
  extraFields?: ReactNode;
  buttonClassName?: string;
  disabled?: boolean;
  fallback?: ReactNode;
};

/**
 * Skeleton mirroring GravityForm's own loading state so the lazy chunk swap is
 * visually seamless. Kept local — importing it from gravity-form.tsx would pull
 * the full chunk back into the static graph and defeat the split.
 */
function GravityFormSkeleton() {
  return (
    <div className="flex w-full flex-col gap-2">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
      <Skeleton className="h-10" />
    </div>
  );
}

/**
 * Loads the Gravity Form module when this component mounts.
 *
 * `next/dynamic` preloads its chunk for every page that imports this file.
 * Editorial content imports it on the homepage, which does not render a form,
 * so that preload put the form on the home graph. A mount-time import()
 * fetches the module only when a form is actually shown.
 */
export function GravityForm(props: LazyGravityFormProps) {
  const [Form, setForm] = useState<ComponentType<LazyGravityFormProps> | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void import("@/components/gravity-form").then((mod) => {
      if (!cancelled) setForm(() => mod.GravityForm);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Form) return <GravityFormSkeleton />;
  return <Form {...props} />;
}
