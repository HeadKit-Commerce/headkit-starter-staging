"use client";

import { useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import React, { useEffect, useState } from "react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGravityFormById,
  submitGravityForm,
  type GravityFormData,
} from "@/lib/gravity-form-actions";
import {
  snakeCase,
  buildFieldIdByName,
  buildFieldValues,
} from "@/lib/gravity-form-utils";
import { subscribeEmailAction } from "@/lib/email-marketing-actions";
import { reportSubscribeOutcome } from "@/lib/subscribe-outcome";
import {
  extractEmailFromFormValues,
  hasMarketingOptIn,
} from "@/lib/email-marketing-utils";

interface GravityFormProps {
  id?: string;
  formId: string;
  initialValues?: { fieldName: string; value: string }[];
  onSubmit?: (values: Record<string, string>) => Promise<void>;
  extraFields?: React.ReactNode;
  buttonClassName?: string;
  disabled?: boolean;
  /**
   * Rendered when the form can't load — Gravity Forms not installed, form id
   * missing, or a fetch error. Lets the storefront degrade gracefully instead
   * of showing a broken/empty form when the plugin is absent.
   */
  fallback?: React.ReactNode;
}

type FieldType =
  | "text"
  | "name"
  | "email"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox";

interface FormFieldConfig {
  type: FieldType;
  label: string;
  isRequired: boolean;
  placeholder?: string | undefined;
  defaultValue: string;
  choices?: { text: string; value: string }[] | undefined;
  databaseId: number;
}

const generateValidationSchema = (fields: FormFieldConfig[]) => {
  const schemaFields: Record<string, z.ZodString> = {};

  fields.forEach((field) => {
    const fieldName = snakeCase(field.label);
    let schema = z.string();

    if (field.isRequired) {
      schema = schema.min(1, `${field.label} is required`);
    }

    if (field.type === "email") {
      schema = schema.email("Invalid email address");
    }

    schemaFields[fieldName] = schema;
  });

  return z.object(schemaFields);
};

interface RenderFieldProps {
  field: FormFieldConfig;
  control: Control<z.infer<ReturnType<typeof generateValidationSchema>>>;
}

const RenderField = ({ field, control }: RenderFieldProps) => {
  const fieldName = snakeCase(field.label);

  switch (field.type) {
    case "text":
    case "name":
    case "email":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{field.label}</FormLabel>
              <FormControl>
                <Input
                  type={field.type === "email" ? "email" : "text"}
                  placeholder={field.placeholder}
                  {...formField}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case "textarea":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{field.label}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={field.placeholder}
                  className="min-h-[120px]"
                  {...formField}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case "select":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem>
              <FormLabel>{field.label}</FormLabel>
              <Select
                onValueChange={formField.onChange}
                defaultValue={formField.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={field.placeholder} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {field.choices?.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case "radio":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className="space-y-3">
              <FormLabel>{field.label}</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={formField.onChange}
                  defaultValue={formField.value}
                  className="space-y-1"
                >
                  {field.choices?.map((choice) => (
                    <FormItem
                      key={choice.value}
                      className="flex items-center space-x-3 space-y-0"
                    >
                      <FormControl>
                        <RadioGroupItem value={choice.value} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {choice.text}
                      </FormLabel>
                    </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    case "checkbox":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={formField.value === "true"}
                  onCheckedChange={(checked) => {
                    formField.onChange(checked ? "true" : "false");
                  }}
                />
              </FormControl>
              <FormLabel className="font-normal">{field.label}</FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />
      );

    default:
      return null;
  }
};

const SuccessBox = ({ message }: { message: string }) => (
  <div className="rounded-2xl border-2 border-green-500 p-8">
    <div className="text-center font-medium">{message}</div>
  </div>
);

const GravityFormSkeleton = () => (
  <div className="flex w-full flex-col gap-2">
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-24" />
    <Skeleton className="h-10" />
  </div>
);

export const GravityForm = ({
  id,
  formId,
  initialValues,
  onSubmit,
  extraFields,
  buttonClassName,
  disabled = false,
  fallback,
}: GravityFormProps) => {
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<GravityFormData | null>(null);

  useEffect(() => {
    const fetchForm = async () => {
      setIsLoading(true);
      try {
        const response = await getGravityFormById(formId);
        setFormData(response);
      } catch (error) {
        setFormData(null);
        console.error("Failed to fetch form:", error);
      }
      setIsLoading(false);
    };
    void fetchForm();
  }, [formId]);

  const injectedFieldNames = new Set(
    (initialValues ?? []).map((v) => v.fieldName),
  );

  // When the host injects product context (enquiry PDP), also suppress common
  // product-attribute field labels even before commerce returns `visibility`.
  // GF Visibility→Hidden still leaves type=text in older API responses.
  const suppressProductContextLabels = injectedFieldNames.size > 0;
  const productContextLabels = new Set([
    "product_name",
    "product_url",
    "product_size",
    "product_colour",
    "product_color",
    "product_options",
    "selected_variations",
    "size",
    "colour",
    "color",
  ]);

  const formFields = (formData?.gfForm?.formFields?.nodes ?? [])
    .map((node) => {
      if (!node?.type || !node?.label) return null;

      // Respect GF Field Visibility (visible|hidden|administrative). This is
      // independent of field type — a Text field with Visibility→Hidden stays
      // type=text in the API and must not render as an input.
      const visibility = (node.visibility ?? "visible").toLowerCase();
      if (visibility === "hidden" || visibility === "administrative") {
        return null;
      }

      const type = node.type.toLowerCase();
      if (
        ![
          "text",
          "name",
          "email",
          "textarea",
          "select",
          "radio",
          "checkbox",
        ].includes(type)
      ) {
        return null;
      }

      const config: FormFieldConfig = {
        type: type as FieldType,
        label: node.label,
        isRequired: Boolean(node.isRequired),
        defaultValue: node.defaultValue ?? "",
        databaseId: node.databaseId,
      };
      if (node.placeholder) config.placeholder = node.placeholder;
      if (node.choices?.nodes?.length) {
        config.choices = node.choices.nodes.map((choice) => ({
          text: choice?.text ?? "",
          value: choice?.value ?? "",
        }));
      }
      return config;
    })
    .filter((field): field is NonNullable<typeof field> => {
      if (field === null) return false;
      const name = snakeCase(field.label);
      if (injectedFieldNames.has(name)) return false;
      if (suppressProductContextLabels && productContextLabels.has(name)) {
        return false;
      }
      return true;
    });

  // Resolve every field's databaseId by snakeCased label across ALL fields —
  // including hidden/injected ones filtered out of the rendered `formFields` —
  // so injected product context submits with its numeric id (ENG-794).
  const fieldIdByName = buildFieldIdByName(formData?.gfForm?.formFields?.nodes);

  const validationSchema = generateValidationSchema(formFields ?? []);

  const form = useForm<z.infer<typeof validationSchema>>({
    resolver: zodResolver(validationSchema),
    defaultValues:
      formFields?.reduce<Record<string, string>>(
        (acc, field) => ({
          ...acc,
          [snakeCase(field.label)]: field.defaultValue,
        }),
        {},
      ) ?? {},
  });

  // No form available (Gravity Forms not installed, form id missing, or fetch
  // failed) — render the caller's fallback, or a neutral default.
  if (!isLoading && !formData?.gfForm) {
    return (
      <>
        {fallback ?? (
          <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-600">
            This form is currently unavailable.
          </div>
        )}
      </>
    );
  }

  if (isLoading) return <GravityFormSkeleton />;

  if (successMessage) {
    return <SuccessBox message={successMessage} />;
  }

  const handleSubmit = async (values: z.infer<typeof validationSchema>) => {
    try {
      setIsSubmitting(true);
      setMessage(null);

      const formattedInitialValues = initialValues
        ?.map((item) => ({ [item.fieldName]: item.value }))
        ?.reduce<
          Record<string, string>
        >((acc, curr) => ({ ...acc, ...curr }), {});
      const allValues = { ...values, ...formattedInitialValues };

      const response = await submitGravityForm({
        id: formId,
        saveAsDraft: false,
        fieldValues: buildFieldValues(allValues, fieldIdByName),
      });

      // Opt-in mailing list: when a marketing checkbox is checked and an email
      // is present, best-effort subscribe (no-ops if email marketing is off).
      const stringValues = allValues as Record<string, string>;
      if (
        formFields &&
        hasMarketingOptIn(formFields, stringValues, snakeCase)
      ) {
        const email = extractEmailFromFormValues(stringValues);
        if (email) {
          // Non-blocking by design; the handler only records the outcome.
          void reportSubscribeOutcome(
            subscribeEmailAction({ email, source: "form" }),
            { source: "form" },
          );
        }
      }

      if (onSubmit) {
        await onSubmit(values);
      }

      // The confirmation message is stripped to plain text server-side in
      // submitGravityForm (lib/gravity-form-actions.ts) so sanitize-html
      // (~70 KB gz of htmlparser2) stays out of the client bundle (RC-1).
      setSuccessMessage(
        response.submitGfForm?.confirmation?.message ??
          "Form submitted successfully",
      );

      if (typeof window !== "undefined") {
        const dl = (
          window as unknown as { dataLayer?: Array<Record<string, unknown>> }
        ).dataLayer;
        if (dl) {
          dl.push({
            event: "enquire_form",
            ecommerce: {
              item_list_name:
                (values as Record<string, string>).product_name ?? "",
            },
          });
        }
      }

      form.reset();
    } catch (error) {
      const apiError = error as {
        response?: { errors?: { message: string }[] };
      };
      if (apiError.response?.errors?.length) {
        setMessage(
          apiError.response.errors[0]?.message ?? "Something went wrong",
        );
      } else {
        setMessage("Something went wrong");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        id={id ?? "gravityForm"}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-[20px]"
      >
        {formFields?.map((field) => (
          <RenderField
            key={field.databaseId}
            field={field}
            control={form.control}
          />
        ))}

        {extraFields}

        <Button
          type="submit"
          disabled={disabled || isSubmitting}
          className={buttonClassName}
        >
          {formData?.gfForm?.submitButton?.text ?? "Submit Form"}
        </Button>

        {message && <div className="mt-0.5 flex flex-wrap">{message}</div>}
      </form>
    </Form>
  );
};
